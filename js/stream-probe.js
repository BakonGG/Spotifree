// Confere se uma URL de áudio realmente entrega áudio (e não um 429/JSON de erro do catálogo).
const cache = new Map(); // url -> { ok, at }
const TTL_MS = 60 * 1000;

export async function isStreamPlayable(url) {
    const hit = cache.get(url);
    // Resultado ruim quase não fica em cache: o limite do catálogo passa em segundos e a nova tentativa precisa checar de verdade
    if (hit && Date.now() - hit.at < (hit.ok ? TTL_MS : 1000)) return hit.ok;
    let ok = true; // erro de rede não bloqueia: deixa o player tentar
    try {
        const res = await fetch(url, { headers: { Range: 'bytes=0-1' }, cache: 'no-store' });
        const type = res.headers.get('content-type') || '';
        ok = (res.status === 200 || res.status === 206) && !type.includes('json') && !type.includes('text/');
    } catch {
        ok = true;
    }
    cache.set(url, { ok, at: Date.now() });
    return ok;
}
