// js/ytmusic-api.js
// Fallback de áudio: pede à nossa API (yt-dlp, hospedada na ShardCloud) para achar a música
// no YouTube e entregar só o áudio. Usado quando o catálogo principal não tem a faixa.
// As instâncias públicas do Invidious/Piped foram removidas: estão fora do ar ou bloqueadas.

export const YT_AUDIO_API = 'https://spotifreeyt.shardweb.app';

const RESOLVE_CACHE = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * Monta a URL de áudio para uma faixa e confirma que o servidor consegue entregá-la.
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
    const url = `${YT_AUDIO_API}/audio?${params}`;

    const cached = RESOLVE_CACHE.get(url);
    if (cached && Date.now() < cached.expiry) return cached.value;

    try {
        const res = await fetch(url, { headers: { Range: 'bytes=0-1' } });
        const value = res.ok || res.status === 206 ? url : null;
        RESOLVE_CACHE.set(url, { value, expiry: Date.now() + (value ? CACHE_TTL_MS : 60 * 1000) });
        return value;
    } catch {
        return null;
    }
}
