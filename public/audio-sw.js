// public/audio-sw.js
// Carregador de áudio do catálogo (importado pelo service worker principal).
// As músicas do catálogo são FLAC de ~45 MB e o servidor entrega só ~200 KB/s por conexão, quase a velocidade
// mínima para tocar: o buffer esvaziava (travava por volta de 1:30) e o início demorava. Aqui o arquivo é baixado
// em pedaços, VÁRIOS AO MESMO TEMPO e à frente do ponto de reprodução (medimos ~3x mais velocidade), e o player
// recebe os bytes como se fosse um servidor normal. Também guardamos o começo (~2 MB) das faixas tocadas, para
// elas começarem na hora da próxima vez.
const SMALL = 256 * 1024; // pedaços do começo: pequenos e em paralelo, para o som começar rápido
const SMALL_COUNT = 8; // os 8 primeiros pedaços (= 2 MB) são pequenos
const INTRO_BYTES = SMALL * SMALL_COUNT;
const CHUNK = 1024 * 1024; // demais pedaços
const PARALLEL = 5; // conexões ao mesmo tempo
const AHEAD = 24; // quantos pedaços buscar à frente (~24 MB)
const INTRO_CHUNKS = SMALL_COUNT; // o começo (2 MB) de cada faixa fica guardado
const INTRO_CACHE = 'audio-intro-v2'; // v2: divisão de pedaços nova; o v1 é apagado abaixo
const INTRO_MAX = 400; // ~50 faixas de 2 MB (≈ 100 MB no máximo)
const KEEP_BEHIND = 2;

const tracks = new Map(); // endereço (sem query) -> estado do download

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const indexOf = (pos) => (pos < INTRO_BYTES ? Math.floor(pos / SMALL) : SMALL_COUNT + Math.floor((pos - INTRO_BYTES) / CHUNK));
const startOf = (i) => (i < SMALL_COUNT ? i * SMALL : INTRO_BYTES + (i - SMALL_COUNT) * CHUNK);
function rangeOf(i, total) {
    const start = startOf(i);
    const end = start + (i < SMALL_COUNT ? SMALL : CHUNK) - 1;
    return [start, total ? Math.min(end, total - 1) : end];
}

function trackState(path) {
    let st = tracks.get(path);
    if (!st) {
        st = { path, total: 0, type: 'application/octet-stream', chunks: new Map(), active: 0, queue: [], touched: 0 };
        tracks.set(path, st);
        if (tracks.size > 3) {
            const oldest = [...tracks.values()].sort((a, b) => a.touched - b.touched)[0];
            tracks.delete(oldest.path);
        }
    }
    st.touched = Date.now();
    return st;
}

// ── começo das faixas guardado no computador (Cache Storage) ──
const introKey = (path, i) => new Request(`${self.location.origin}/__audio_intro__${new URL(path).pathname}/${i}`);

async function introGet(path, i) {
    try {
        const cache = await caches.open(INTRO_CACHE);
        const hit = await cache.match(introKey(path, i));
        if (!hit) return null;
        return {
            data: await hit.arrayBuffer(),
            total: Number(hit.headers.get('x-total')) || 0,
            type: hit.headers.get('content-type') || '',
        };
    } catch {
        return null;
    }
}

async function introPut(path, i, data, total, type) {
    try {
        const cache = await caches.open(INTRO_CACHE);
        await cache.put(
            introKey(path, i),
            new Response(data, { headers: { 'x-total': String(total || 0), 'content-type': type || 'application/octet-stream' } })
        );
        const keys = await cache.keys();
        for (let n = 0; n < keys.length - INTRO_MAX; n++) await cache.delete(keys[n]); // apaga as mais antigas
    } catch {
        // sem espaço ou sem Cache Storage: segue sem guardar
    }
}

// ── download de um pedaço (com tentativas, porque o catálogo às vezes responde "limite excedido") ──
async function fetchChunk(st, i) {
    if (i < INTRO_CHUNKS) {
        const hit = await introGet(st.path, i);
        if (hit && hit.data.byteLength > 0) {
            if (hit.total) st.total = hit.total;
            if (hit.type) st.type = hit.type;
            return hit.data;
        }
    }
    const [a, b] = rangeOf(i, st.total);
    let lastError = new Error('falha ao baixar o áudio');
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            const res = await fetch(st.path, { headers: { Range: `bytes=${a}-${b}` }, cache: 'no-store' });
            const type = res.headers.get('content-type') || '';
            if ((res.status === 206 || res.status === 200) && !type.includes('json') && !type.startsWith('text/')) {
                const range = res.headers.get('content-range');
                const match = range && /\/(\d+)$/.exec(range);
                if (match) st.total = Number(match[1]);
                else if (res.status === 200) st.total = Number(res.headers.get('content-length')) || st.total;
                if (type) st.type = type;
                const body = await res.arrayBuffer();
                const data = res.status === 200 ? body.slice(a, b + 1) : body; // 200 = servidor ignorou o Range
                if (i < INTRO_CHUNKS) void introPut(st.path, i, data, st.total, st.type);
                return data;
            }
            lastError = new Error(`resposta ${res.status}`);
        } catch (err) {
            lastError = err;
        }
        await sleep(500 * 2 ** attempt);
    }
    throw lastError;
}

function pump(st) {
    while (st.active < PARALLEL && st.queue.length > 0) {
        const job = st.queue.shift();
        st.active++;
        fetchChunk(st, job.i)
            .then(job.resolve, job.reject)
            .finally(() => {
                st.active--;
                pump(st);
            });
    }
}

/** urgent = o player está esperando este pedaço agora: vai para a frente da fila. */
function loadChunk(st, i, urgent) {
    const entry = st.chunks.get(i);
    if (entry) return entry.promise;
    const promise = new Promise((resolve, reject) => {
        const job = { i, resolve, reject };
        if (urgent) st.queue.unshift(job);
        else st.queue.push(job);
        pump(st);
    });
    st.chunks.set(i, { promise });
    promise.catch(() => st.chunks.delete(i)); // permite tentar de novo depois
    return promise;
}

function prefetch(st, from, lastIndex) {
    const limit = st.total ? Math.min(lastIndex, indexOf(st.total - 1)) : lastIndex;
    for (let j = from + 1; j <= Math.min(from + AHEAD, limit); j++) void loadChunk(st, j, false).catch(() => {});
}

function dropBehind(st, current) {
    for (const key of st.chunks.keys()) if (key < current - KEEP_BEHIND) st.chunks.delete(key);
}

// ── atende os pedidos do player (Range) ──
async function serve(request) {
    const url = new URL(request.url);
    const path = url.origin + url.pathname; // sem query
    const st = trackState(path);

    const header = request.headers.get('Range');
    let start = 0;
    let end = null; // null = até o fim
    if (header) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(header);
        if (!m) return fetch(request);
        if (m[1] === '') {
            await loadChunk(st, 0, true);
            if (!st.total) return fetch(request);
            start = Math.max(0, st.total - Number(m[2]));
        } else {
            start = Number(m[1]);
            end = m[2] === '' ? null : Number(m[2]);
        }
    }

    // Pedido grande novo (tocar/pular): descarta o que estava na fila para um ponto que não interessa mais
    if (header && (end === null || end - start > 64 * 1024)) {
        st.queue.splice(0).forEach((job) => job.reject(new Error('cancelado')));
    }

    await loadChunk(st, indexOf(start), true); // descobre o tamanho total e já traz o primeiro pedaço
    if (!st.total) return fetch(request); // servidor sem suporte: deixa passar direto
    if (end === null || end >= st.total) end = st.total - 1;
    if (start > end || start >= st.total) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.total}` } });
    }

    const open = end === st.total - 1; // pedido até o fim: vale buscar à frente
    const lastWanted = indexOf(end);
    const big = end - start + 1 > 64 * 1024; // pedidos minúsculos (testes de 2 bytes) não disparam downloads à frente
    let pos = start;

    const body = new ReadableStream({
        async pull(controller) {
            if (pos > end) return controller.close();
            const i = indexOf(pos);
            if (big) prefetch(st, i, open ? Infinity : lastWanted);
            const chunk = new Uint8Array(await loadChunk(st, i, true));
            const chunkStart = startOf(i);
            const from = pos - chunkStart;
            const to = Math.min(end - chunkStart + 1, chunk.length);
            if (to <= from) return controller.error(new Error('pedaço incompleto'));
            controller.enqueue(chunk.slice(from, to));
            pos = chunkStart + to;
            dropBehind(st, i);
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

// Apaga o cache de começos da versão anterior (outra divisão de pedaços: misturar corromperia o áudio)
self.addEventListener('activate', (event) => {
    event.waitUntil(caches.delete('audio-intro-v1'));
});
