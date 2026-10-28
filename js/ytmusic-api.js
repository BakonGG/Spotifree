// js/ytmusic-api.js
// Fallback de áudio para faixas fora do catálogo. Pede a um servidor nosso (yt-dlp) para achar a música e
// entregar SÓ o áudio. O servidor preferido roda no PC do dono (IP residencial, que o YouTube aceita) e se
// registra em /api/yt-endpoint; a ShardCloud fica como reserva.

export const YT_AUDIO_API = 'https://spotifreeyt.shardweb.app';

const BASES_TTL_MS = 45 * 1000;
let basesCache = { at: 0, bases: [YT_AUDIO_API] };

/** Lista de servidores de áudio em ordem de preferência (PC primeiro, se estiver ligado). */
async function getAudioBases() {
    if (Date.now() - basesCache.at < BASES_TTL_MS) return basesCache.bases;
    const bases = [];
    try {
        const res = await fetch('/api/yt-endpoint', { signal: AbortSignal.timeout(4000), cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            if (data?.url) bases.push(data.url);
        }
    } catch {
        // sem registro: usa só a reserva
    }
    bases.push(YT_AUDIO_API);
    basesCache = { at: Date.now(), bases };
    return bases;
}

const RESOLVE_CACHE = new Map();
const CACHE_TTL_MS = 20 * 60 * 1000;

/**
 * Monta a URL de áudio para uma faixa e confirma que algum servidor consegue entregá-la.
 * @param {{ title?: string, name?: string, artist?: any, artists?: Array<{name:string}>, artistNames?: string[], duration?: number }} track
 * @returns {Promise<string|null>}
 */
export async function findAudioForTrack(track) {
    if (!track) return null;

    let artist = '';
    if (typeof track.artist === 'string') {
        artist = track.artist;
    } else if (track.artist && typeof track.artist.name === 'string') {
        artist = track.artist.name;
    } else if (Array.isArray(track.artists) && track.artists.length > 0) {
        artist = track.artists[0]?.name || '';
    } else if (Array.isArray(track.artistNames) && track.artistNames.length > 0) {
        artist = track.artistNames[0] || '';
    }

    const title = track.title || track.name || '';
    if (!title) return null;

    const query = artist ? `${artist} ${title}` : title;
    const params = new URLSearchParams({ q: query });
    // A duração (ms ou s) ajuda o servidor a escolher a versão certa, e não um remix ou ao vivo.
    const rawDuration = Number(track.duration) || 0;
    const seconds = rawDuration > 10000 ? Math.round(rawDuration / 1000) : Math.round(rawDuration);
    if (seconds > 0) params.set('duration', String(seconds));

    const cacheKey = params.toString();
    const cached = RESOLVE_CACHE.get(cacheKey);
    if (cached && Date.now() < cached.expiry) return cached.value;

    for (const base of await getAudioBases()) {
        const url = `${base}/audio?${params}`;
        try {
            const res = await fetch(url, { headers: { Range: 'bytes=0-1' }, signal: AbortSignal.timeout(40000) });
            if (res.ok || res.status === 206) {
                RESOLVE_CACHE.set(cacheKey, { value: url, expiry: Date.now() + CACHE_TTL_MS });
                return url;
            }
        } catch {
            // servidor fora do ar: tenta o próximo. Se era o PC, pergunta de novo na próxima vez.
            if (base !== YT_AUDIO_API) basesCache.at = 0;
        }
    }
    return null;
}
