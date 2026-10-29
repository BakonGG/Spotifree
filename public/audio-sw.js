// public/audio-sw.js
// Carregador de áudio do catálogo (importado pelo service worker principal).
// As músicas do catálogo são FLAC de ~45 MB e o servidor entrega só ~200 KB/s por conexão, quase a velocidade
// mínima para tocar: o buffer esvaziava (travava por volta de 1:30) e o início demorava. Medimos que várias
// conexões LONGAS em paralelo somam ~3x mais velocidade. Aqui a música é dividida em segmentos de 4 MB; cada um
// é baixado em uma conexão própria (lida em fluxo, sem esperar terminar), vários ao mesmo tempo e à frente do
// ponto de reprodução. O player recebe os bytes como de um servidor normal. O começo (2 MB) das faixas tocadas
// fica guardado no computador, para elas começarem mais rápido da próxima vez.
const SEG = 4 * 1024 * 1024; // tamanho de cada segmento
const PARALLEL = 4; // segmentos baixando ao mesmo tempo
const AHEAD = 5; // segmentos à frente do ponto de reprodução
const KEEP_BEHIND = 1;
const SEND = 512 * 1024; // máximo entregue ao player por vez
const INTRO_BYTES = 2 * 1024 * 1024;
const INTRO_CACHE = 'audio-intro-v3'; // v3: um arquivo de 2 MB por faixa (versões anteriores são apagadas abaixo)
const INTRO_MAX = 50; // ≈ 100 MB no máximo

const tracks = new Map(); // endereço (sem query) -> estado

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const segIndex = (pos) => Math.floor(pos / SEG);
const segStart = (i) => i * SEG;

function trackState(path) {
    let st = tracks.get(path);
    if (!st) {
        st = { path, total: 0, type: 'application/octet-stream', segs: new Map(), noRange: false, touched: 0, active: 0 };
        tracks.set(path, st);
        if (tracks.size > 3) {
            const oldest = [...tracks.values()].sort((a, b) => a.touched - b.touched)[0];
            for (const seg of oldest.segs.values()) {
                seg.cancelled = true;
                seg.abort?.abort();
                notify(seg);
            }
            tracks.delete(oldest.path);
        }
    }
    st.touched = Date.now();
    return st;
}

// ── começo das faixas guardado no computador (Cache Storage) ──
const introKey = (path) => new Request(`${self.location.origin}/__audio_intro__${new URL(path).pathname}`);

async function introGet(path) {
    try {
        const cache = await caches.open(INTRO_CACHE);
        const hit = await cache.match(introKey(path));
        if (!hit) return null;
        return {
            data: new Uint8Array(await hit.arrayBuffer()),
            total: Number(hit.headers.get('x-total')) || 0,
            type: hit.headers.get('content-type') || '',
        };
    } catch {
        return null;
    }
}

async function introPut(path, data, total, type) {
    try {
        const cache = await caches.open(INTRO_CACHE);
        await cache.put(
            introKey(path),
            new Response(data, { headers: { 'x-total': String(total || 0), 'content-type': type || 'application/octet-stream' } })
        );
        const keys = await cache.keys();
        for (let n = 0; n < keys.length - INTRO_MAX; n++) await cache.delete(keys[n]); // apaga as mais antigas
    } catch {
        // sem espaço ou sem Cache Storage: segue sem guardar
    }
}

// ── segmentos ──
function notify(seg) {
    seg.waiters.splice(0).forEach((resolve) => resolve());
}
const waitSeg = (seg) => new Promise((resolve) => seg.waiters.push(resolve));

function segLength(st, seg) {
    const base = segStart(seg.i);
    const last = st.total ? Math.min(base + SEG, st.total) : base + SEG;
    return Math.max(0, last - base);
}

async function runSeg(st, seg) {
    const base = segStart(seg.i);
    let attempt = 0;
    while (!seg.cancelled) {
        try {
            const length = segLength(st, seg);
            if (st.total && seg.received >= length) break; // completo
            const from = base + seg.received;
            const to = base + (st.total ? length : SEG) - 1;
            seg.abort = new AbortController();
            const res = await fetch(st.path, { headers: { Range: `bytes=${from}-${to}` }, cache: 'no-store', signal: seg.abort.signal });
            const type = res.headers.get('content-type') || '';
            if (res.status === 200) {
                st.noRange = true; // o servidor ignorou o Range: não dá para segmentar
                throw Object.assign(new Error('sem suporte a Range'), { fatal: true });
            }
            if (res.status !== 206 || type.includes('json') || type.startsWith('text/')) throw new Error(`resposta ${res.status}`);
            const range = res.headers.get('content-range');
            const match = range && /\/(\d+)$/.exec(range);
            if (match) st.total = Number(match[1]);
            if (type) st.type = type;
            const reader = res.body.getReader();
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                seg.buf.set(value.subarray(0, Math.max(0, SEG - seg.received)), seg.received);
                seg.received += value.length;
                if (seg.i === 0 && !seg.introSaved && seg.received >= INTRO_BYTES) {
                    seg.introSaved = true;
                    void introPut(st.path, seg.buf.slice(0, INTRO_BYTES), st.total, st.type);
                }
                notify(seg);
            }
            if (!st.total || seg.received >= segLength(st, seg)) break;
            throw new Error('segmento incompleto'); // volta a baixar o que faltou
        } catch (err) {
            if (seg.cancelled || err.name === 'AbortError') return;
            if (err.fatal || ++attempt > 4) {
                seg.error = err;
                notify(seg);
                return;
            }
            await sleep(500 * 2 ** attempt);
        }
    }
    seg.done = true;
    notify(seg);
}

function startSeg(st, seg) {
    if (seg.started) return;
    seg.started = true;
    st.active++;
    (async () => {
        if (seg.i === 0) {
            const hit = await introGet(st.path);
            if (hit && hit.data.length > 0) {
                seg.buf.set(hit.data.subarray(0, SEG));
                seg.received = Math.min(hit.data.length, SEG);
                seg.introSaved = true;
                if (hit.total) st.total = hit.total;
                if (hit.type) st.type = hit.type;
                notify(seg);
            }
        }
        await runSeg(st, seg);
    })()
        .catch(() => {})
        .finally(() => {
            st.active--;
            pumpSegs(st);
        });
}

function getSeg(st, i) {
    let seg = st.segs.get(i);
    if (!seg) {
        seg = { i, buf: new Uint8Array(SEG), received: 0, started: false, done: false, cancelled: false, error: null, waiters: [], abort: null, introSaved: false };
        st.segs.set(i, seg);
    }
    return seg;
}

/** Segmentos de prefetch respeitam o limite de conexões; o que o player espera AGORA (urgente) começa sempre. */
function pumpSegs(st) {
    const pending = [...st.segs.values()].filter((seg) => !seg.started && !seg.cancelled).sort((a, b) => a.i - b.i);
    for (const seg of pending) {
        if (st.active >= PARALLEL) break;
        startSeg(st, seg);
    }
}

function ensureSegs(st, current, ahead) {
    const urgent = getSeg(st, current);
    if (!urgent.started) startSeg(st, urgent);
    const last = st.total ? segIndex(st.total - 1) : current + ahead;
    for (let i = current + 1; i <= Math.min(current + ahead, last); i++) getSeg(st, i);
    // limpa o que ficou para trás ou longe demais (o ponto de reprodução mudou)
    for (const [i, seg] of st.segs) {
        if (i < current - KEEP_BEHIND || i > current + ahead + 1) {
            seg.cancelled = true;
            seg.abort?.abort();
            notify(seg);
            st.segs.delete(i);
        }
    }
    pumpSegs(st);
    return urgent;
}

// ── atende os pedidos do player (Range) ──
async function serve(request) {
    const url = new URL(request.url);
    const path = url.origin + url.pathname; // sem query
    const st = trackState(path);
    if (st.noRange) return fetch(request);

    const header = request.headers.get('Range');
    let start = 0;
    let end = null; // null = até o fim
    if (header) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(header);
        if (!m) return fetch(request);
        if (m[1] === '') {
            const first = ensureSegs(st, 0, 0);
            while (!st.total && !first.error) await waitSeg(first);
            if (!st.total) return fetch(request);
            start = Math.max(0, st.total - Number(m[2]));
        } else {
            start = Number(m[1]);
            end = m[2] === '' ? null : Number(m[2]);
        }
    }

    const big = end === null || end - start > 64 * 1024; // pedidos minúsculos (testes de 2 bytes) não disparam downloads à frente
    const first = ensureSegs(st, segIndex(start), big ? AHEAD : 0);
    while (!st.total && !first.error) await waitSeg(first); // descobre o tamanho total
    if (!st.total || st.noRange) return fetch(request);
    if (end === null || end >= st.total) end = st.total - 1;
    if (start > end || start >= st.total) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.total}` } });
    }

    let pos = start;
    const body = new ReadableStream({
        async pull(controller) {
            if (pos > end) return controller.close();
            const i = segIndex(pos);
            const offset = pos - segStart(i);
            let seg = big ? ensureSegs(st, i, AHEAD) : getSeg(st, i);
            if (!seg.started) startSeg(st, seg);
            for (;;) {
                if (seg.cancelled) {
                    // outro pedido do player moveu a janela e este segmento foi descartado: pede de novo
                    seg = big ? ensureSegs(st, i, AHEAD) : getSeg(st, i);
                    if (!seg.started) startSeg(st, seg);
                }
                if (seg.received > offset || seg.error || seg.done) break;
                await waitSeg(seg);
            }
            if (seg.received <= offset) return controller.error(seg.error || new Error('segmento incompleto'));
            const stop = Math.min(seg.received, end - segStart(i) + 1, offset + SEND);
            controller.enqueue(seg.buf.slice(offset, stop));
            pos = segStart(i) + stop;
            if (pos > end) controller.close();
        },
    });

    return new Response(body, {
        status: header ? 206 : 200,
        headers: {
            'Content-Type': st.type,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(end - start + 1),
            ...(header ? { 'Content-Range': `bytes ${start}-${end}/${st.total}` } : {}),
            'Cache-Control': 'no-store',
        },
    });
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin || !url.pathname.startsWith('/api/tracks/track/')) return;
    event.respondWith(serve(req).catch(() => fetch(req)));
});

// Apaga os caches de começos de versões anteriores (outra divisão: misturar corromperia o áudio)
self.addEventListener('activate', (event) => {
    event.waitUntil(Promise.all(['audio-intro-v1', 'audio-intro-v2'].map((name) => caches.delete(name))));
});
