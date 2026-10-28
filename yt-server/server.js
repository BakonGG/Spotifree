// yt-server/server.js
// Servidor de áudio do Spotifree (roda na ShardCloud). Acha a música em fontes públicas e entrega SÓ o áudio.
//   GET /audio?q=artista título[&duration=segundos]  -> stream de áudio (aceita Range)
//   GET /search?q=...[&duration=...]                 -> JSON com o vídeo escolhido no YouTube (legado)
//   GET /health
// Fontes, em ordem: 1) SoundCloud (não exige login nem cookies)  2) YouTube (só funciona com cookies válidos).
import http from 'node:http';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, chmodSync, copyFileSync, createWriteStream, createReadStream, statSync, readdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const PORT = Number(process.env.PORT || 3000);
const ORIGINS = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
// No PC, YTDLP_BIN aponta para o yt-dlp.exe já instalado; na ShardCloud ele é baixado para a pasta temporária.
const BIN_DIR = process.env.YTDLP_DIR || join(tmpdir(), 'ytdlp');
const BIN = process.env.YTDLP_BIN || join(BIN_DIR, 'yt-dlp');
// O yt-dlp reescreve o arquivo de cookies, então usamos uma cópia gravável em /tmp.
const COOKIES_SRC = new URL('./cookies.txt', import.meta.url);
const COOKIES = existsSync(COOKIES_SRC) ? join(tmpdir(), 'yt-cookies.txt') : '';
// YouTube funciona sem cookies quando o servidor roda em IP residencial (YT_ENABLED=1); em datacenter só com cookies.
const YT_ENABLED = process.env.YT_ENABLED === '1' || !!COOKIES;
const SOURCE_ORDER = (process.env.SOURCE_ORDER || 'soundcloud,youtube').split(',').map((x) => x.trim());
if (COOKIES) copyFileSync(COOKIES_SRC, COOKIES);

const URL_TTL_MS = 25 * 60 * 1000;
const urlCache = new Map(); // chave da fonte -> { url, mime, exp }
const resolveCache = new Map(); // consulta -> { source, exp }
const searchCache = new Map();

// ─── yt-dlp ────────────────────────────────────────────────────────────────
async function installYtDlp() {
    if (existsSync(BIN) || process.env.YTDLP_BIN) return;
    mkdirSync(BIN_DIR, { recursive: true });
    const res = await fetch('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux', {
        redirect: 'follow',
    });
    if (!res.ok) throw new Error(`download yt-dlp: ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(BIN));
    chmodSync(BIN, 0o755);
}

function ytdlp(args, { timeout = 45000, cookies = false } = {}) {
    const full = [
        '--no-warnings',
        '--no-playlist',
        '--socket-timeout',
        '15',
        // O YouTube exige rodar JS para decifrar os links de áudio; usamos o Node do container.
        '--js-runtimes',
        'node',
        '--remote-components',
        'ejs:github',
        ...(cookies && COOKIES ? ['--cookies', COOKIES] : []),
        ...args,
    ];
    return new Promise((resolve, reject) => {
        execFile(BIN, full, { timeout, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                const msg = (stderr || err.message).split('\n').filter(Boolean).slice(-2).join(' | ');
                reject(new Error(msg));
            } else resolve(stdout);
        });
    });
}

// ─── Pontuação de candidatos ───────────────────────────────────────────────
const norm = (s) =>
    String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9 ]+/g, ' ');

const BAD = [
    'live', 'ao vivo', 'cover', 'karaoke', 'slowed', 'sped up', 'speed', 'acelerad', 'reverb', 'nightcore', '8d',
    'instrumental', 'remix', 'mashup', 'tutorial', 'reaction', 'bass boosted', 'tiktok', 'beat', 'mix',
];

function score(v, query, wantDur) {
    const title = norm(v.title);
    const channel = norm(v.channel || v.uploader);
    const q = norm(query);
    let s = 0;
    for (const w of q.split(' ').filter((w) => w.length > 2)) {
        if (title.includes(w) || channel.includes(w)) s += 8;
    }
    if (/ topic$/.test(channel)) s += 30;
    if (title.includes('official audio') || title.includes('audio oficial') || title.includes('oficial')) s += 12;
    for (const b of BAD) if (title.includes(b) && !q.includes(b)) s -= 25;
    if (wantDur && v.duration) {
        const d = Math.abs(v.duration - wantDur);
        s += d <= 3 ? 40 : d <= 8 ? 20 : d <= 20 ? 0 : -40;
    }
    if (v.duration && v.duration > 900) s -= 60;
    return s;
}

// ─── SoundCloud (fonte principal) ──────────────────────────────────────────
async function soundcloudCandidates(q, wantDur) {
    const out = await ytdlp(['--flat-playlist', '--dump-json', `scsearch10:${q}`], { timeout: 40000 });
    const items = out
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .filter((v) => v.url && v.duration > 30); // trechos de 30s são só prévia
    return items.map((v) => ({ v, s: score(v, q, wantDur) })).sort((a, b) => b.s - a.s).map((x) => x.v);
}

async function soundcloudStream(trackUrl) {
    // Prefere MP3 progressivo (toca em qualquer navegador); HLS não é aceito aqui
    const out = await ytdlp(['-f', 'http_mp3_128/bestaudio[protocol^=http][protocol!*=m3u8]', '--print', '%(urls)s\n%(ext)s', trackUrl], {
        timeout: 40000,
    });
    const [url, ext] = out.trim().split('\n');
    if (!url?.startsWith('http')) throw new Error('sem url progressiva');
    return { url, mime: ext === 'm4a' ? 'audio/mp4' : ext === 'opus' || ext === 'webm' ? 'audio/webm' : 'audio/mpeg' };
}

// Só aceita um candidato se o título/artista realmente batem e a duração é próxima: melhor não tocar do que tocar outra música.
function matchesQuery(v, q, wantDur) {
    const words = norm(q).split(' ').filter((w) => w.length > 2);
    if (words.length === 0) return false;
    const haystack = norm(`${v.title} ${v.uploader || ''}`);
    const hits = words.filter((w) => haystack.includes(w)).length;
    if (hits / words.length < 0.75) return false;
    if (wantDur && v.duration && Math.abs(v.duration - wantDur) > 12) return false;
    return true;
}

async function resolveSoundCloud(q, wantDur) {
    const candidates = (await soundcloudCandidates(q, wantDur)).filter((v) => matchesQuery(v, q, wantDur)).slice(0, 4);
    for (const v of candidates) {
        try {
            const stream = await soundcloudStream(v.url);
            return { ...stream, title: v.title, source: 'soundcloud' };
        } catch {
            // DRM / Go+ / sem versão progressiva: tenta o próximo
        }
    }
    return null;
}

// ─── YouTube (reserva; precisa de cookies válidos) ─────────────────────────
async function searchYouTube(q, wantDur) {
    const key = `${norm(q)}|${wantDur || ''}`;
    const hit = searchCache.get(key);
    if (hit && hit.exp > Date.now()) return hit.video;
    const out = await ytdlp(['--flat-playlist', '--dump-json', `ytsearch8:${q}`], { cookies: true });
    const items = out
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    if (!items.length) return null;
    const best = items.map((v) => ({ v, s: score(v, q, wantDur) })).sort((a, b) => b.s - a.s)[0].v;
    const video = { id: best.id, title: best.title, duration: best.duration, channel: best.channel || best.uploader };
    searchCache.set(key, { video, exp: Date.now() + 6 * 3600 * 1000 });
    return video;
}

// O YouTube não entrega mais a URL do áudio de forma simples (protocolo SABR): quem consegue baixar é o próprio
// yt-dlp. Então baixamos para um cache em disco e servimos dali (com suporte a Range, para avançar/voltar).
const CACHE_DIR = join(tmpdir(), 'spotifree-audio');
mkdirSync(CACHE_DIR, { recursive: true });
const downloads = new Map(); // id do vídeo -> Promise do download em andamento

const MIME = { m4a: 'audio/mp4', mp4: 'audio/mp4', webm: 'audio/webm', opus: 'audio/ogg', mp3: 'audio/mpeg' };

function cachedFile(id) {
    const name = readdirSync(CACHE_DIR).find((n) => n.startsWith(id + '.') && !n.endsWith('.part'));
    return name ? join(CACHE_DIR, name) : null;
}

async function downloadYouTube(id) {
    const hit = cachedFile(id);
    if (hit) return hit;
    if (downloads.has(id)) return downloads.get(id);
    const job = (async () => {
        const out = await ytdlp(
            [
                '-f',
                'bestaudio[ext=m4a]/bestaudio/best',
                '-o',
                join(CACHE_DIR, id + '.%(ext)s'),
                '--no-part',
                '--print',
                'after_move:filepath',
                `https://www.youtube.com/watch?v=${id}`,
            ],
            { cookies: true, timeout: 120000 }
        );
        const file = out.trim().split(/\r?\n/).pop();
        if (!file || !existsSync(file)) throw new Error('download falhou');
        return file;
    })().finally(() => downloads.delete(id));
    downloads.set(id, job);
    return job;
}

// Limpa arquivos com mais de 1 hora (o cache não cresce sem limite)
setInterval(() => {
    const limit = Date.now() - 60 * 60 * 1000;
    try {
        for (const n of readdirSync(CACHE_DIR)) {
            const p = join(CACHE_DIR, n);
            if (statSync(p).mtimeMs < limit) unlinkSync(p);
        }
    } catch {
        // pasta em uso: tenta na próxima
    }
}, 10 * 60 * 1000).unref();

async function resolveYouTube(q, wantDur) {
    const video = await searchYouTube(q, wantDur);
    if (!video) return null;
    const file = await downloadYouTube(video.id);
    const ext = extname(file).slice(1).toLowerCase();
    return { file, size: statSync(file).size, mime: MIME[ext] || 'application/octet-stream', title: video.title, source: 'youtube' };
}

/** Serve um arquivo do cache respeitando o cabeçalho Range. */
function serveFile(req, res, source) {
    const size = source.size;
    const m = /^bytes=([0-9]*)-([0-9]*)$/.exec(req.headers.range || '');
    let start = 0;
    let end = size - 1;
    if (m) {
        if (m[1] !== '') {
            start = Number(m[1]);
            if (m[2] !== '') end = Math.min(Number(m[2]), size - 1);
        } else if (m[2] !== '') {
            start = Math.max(0, size - Number(m[2]));
        }
    }
    if (start > end || start >= size) return res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
    res.writeHead(m ? 206 : 200, {
        'Content-Type': source.mime,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        ...(m ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
        'Cache-Control': 'public, max-age=3600',
        'X-Audio-Source': source.source,
        'X-Audio-Title': encodeURIComponent(source.title || ''),
    });
    if (req.method === 'HEAD') return res.end();
    const stream = createReadStream(source.file, { start, end });
    req.on('close', () => stream.destroy());
    stream.on('error', () => res.destroy());
    stream.pipe(res);
}

// ─── Resolução com cache ───────────────────────────────────────────────────
async function resolveAudio(q, wantDur) {
    const key = `${norm(q)}|${wantDur || ''}`;
    const hit = resolveCache.get(key);
    if (hit && hit.exp > Date.now()) return hit.source;

    let source = null;
    for (const name of SOURCE_ORDER) {
        if (source) break;
        try {
            if (name === 'soundcloud') source = await resolveSoundCloud(q, wantDur);
            else if (name === 'youtube' && YT_ENABLED) source = await resolveYouTube(q, wantDur);
        } catch (err) {
            console.error(`[${name}]`, q, err.message);
        }
    }
    if (source) resolveCache.set(key, { source, exp: Date.now() + URL_TTL_MS });
    return source;
}

// ─── HTTP ──────────────────────────────────────────────────────────────────
function cors(req, res) {
    // O valor enviado vem sempre da lista permitida (nunca é o texto cru do cabeçalho Origin)
    const allowed = ORIGINS.includes('*') ? '*' : ORIGINS.find((x) => x === req.headers.origin);
    if (allowed) res.setHeader('Access-Control-Allow-Origin', allowed);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.setHeader(
        'Access-Control-Expose-Headers',
        'Content-Length, Content-Range, Accept-Ranges, X-Audio-Source, X-Audio-Title'
    );
}

const json = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
};

let ready = installYtDlp()
    .then(() => console.log('[yt] yt-dlp pronto'))
    .catch((e) => console.error('[yt] falha ao instalar yt-dlp:', e.message));

const hits = new Map(); // ip -> { n, reset }
function tooMany(req) {
    const ip = req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'x';
    const now = Date.now();
    const h = hits.get(ip);
    if (!h || h.reset < now) {
        hits.set(ip, { n: 1, reset: now + 60000 });
        return false;
    }
    h.n++;
    return h.n > 60; // 60 pedidos por minuto por IP
}
setInterval(() => {
    const now = Date.now();
    for (const [ip, h] of hits) if (h.reset < now) hits.delete(ip);
}, 120000).unref();

http.createServer(async (req, res) => {
    cors(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') return res.writeHead(405).end();
    if (req.url !== '/health' && tooMany(req)) return json(res, 429, { error: 'muitos pedidos, tente em instantes' });
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    const u = new URL(req.url, 'http://x');
    const q = (u.searchParams.get('q') || '').slice(0, 200);
    try {
        if (u.pathname === '/health') return json(res, 200, { ok: existsSync(BIN), youtube: YT_ENABLED, order: SOURCE_ORDER });
        await ready;
        if (!existsSync(BIN)) {
            ready = installYtDlp();
            await ready;
        }
        const dur = Number(u.searchParams.get('duration')) || 0;

        if (u.pathname === '/search') {
            const v = await searchYouTube(q, dur);
            return v ? json(res, 200, v) : json(res, 404, { error: 'não encontrado' });
        }
        if (u.pathname !== '/audio') return json(res, 404, { error: 'rota' });
        if (!q) return json(res, 400, { error: 'faltou q' });

        for (let attempt = 0; attempt < 2; attempt++) {
            const source = await resolveAudio(q, dur);
            if (!source) return json(res, 404, { error: 'não encontrei essa música em nenhuma fonte' });

            if (source.file) {
                if (!existsSync(source.file)) {
                    resolveCache.delete(`${norm(q)}|${dur || ''}`);
                    continue; // arquivo foi limpo: baixa de novo
                }
                return serveFile(req, res, source);
            }
            const up = await fetch(source.url, { method: req.method, headers: { Range: req.headers.range || 'bytes=0-' } });
            if (!up.ok && up.status !== 206) {
                // link vencido: esquece e tenta resolver de novo
                resolveCache.delete(`${norm(q)}|${dur || ''}`);
                continue;
            }
            const h = {
                'Content-Type': source.mime,
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'public, max-age=3600',
                'X-Audio-Source': source.source,
                'X-Audio-Title': encodeURIComponent(source.title || ''),
            };
            for (const k of ['content-length', 'content-range']) if (up.headers.get(k)) h[k] = up.headers.get(k);
            res.writeHead(up.status, h);
            if (req.method === 'HEAD' || !up.body) return res.end();
            req.on('close', () => up.body.cancel().catch(() => {}));
            await pipeline(Readable.fromWeb(up.body), res).catch(() => {});
            return;
        }
        json(res, 502, { error: 'a fonte recusou o pedido' });
    } catch (e) {
        console.error('[yt]', u.pathname, q, e.message);
        if (!res.headersSent) json(res, 502, { error: e.message });
        else res.end();
    }
}).listen(PORT, '0.0.0.0', () => console.log(`[yt] ouvindo em ${PORT}`));
