// js/ytmusic-api.js
// Provides audio stream URLs via public Invidious instances as a fallback
// when the primary streaming provider (Tidal/HiFi) is unavailable.
// No API keys required — uses public Invidious instances.

const INVIDIOUS_INSTANCES = [
    'https://invidious.io.projj.eu',
    'https://inv.nadeko.net',
    'https://invidious.nerdvpn.de',
    'https://invidious.privacyredirect.com',
];

const YT_MUSIC_SEARCH_INSTANCES = [
    'https://invidious.io.projj.eu',
    'https://inv.nadeko.net',
];

const STREAM_CACHE = new Map();
const SEARCH_CACHE = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function cacheGet(cache, key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
        cache.delete(key);
        return null;
    }
    return entry.value;
}

function cacheSet(cache, key, value) {
    cache.set(key, { value, expiry: Date.now() + CACHE_TTL_MS });
}

/**
 * Try each Invidious instance until one responds successfully.
 */
async function invidiousFetch(path, params = {}, { preferAudio = false } = {}) {
    const instances = preferAudio ? INVIDIOUS_INSTANCES : YT_MUSIC_SEARCH_INSTANCES;
    let lastError;

    for (const base of instances) {
        try {
            const url = new URL(`${base}${path}`);
            url.searchParams.set('fields', params.fields || '');
            for (const [k, v] of Object.entries(params)) {
                if (k !== 'fields') url.searchParams.set(k, String(v));
            }

            const res = await fetch(url.toString(), {
                signal: AbortSignal.timeout(8000),
            });

            if (!res.ok) continue;
            return await res.json();
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError || new Error('All Invidious instances failed');
}

/**
 * Search YouTube Music for the best matching video ID for a track.
 * @param {string} query  e.g. "Artist - Title"
 * @returns {Promise<string|null>}  YouTube video ID or null
 */
export async function searchYTMusic(query) {
    if (!query) return null;

    const cached = cacheGet(SEARCH_CACHE, query);
    if (cached !== null) return cached;

    try {
        const results = await invidiousFetch('/api/v1/search', {
            q: `${query} official audio`,
            type: 'video',
            page: 1,
        });

        if (!Array.isArray(results) || results.length === 0) return null;

        // Prefer music/official results; filter out playlists and channels
        const videos = results.filter((r) => r.type === 'video' || !r.type);
        if (videos.length === 0) return null;

        const videoId = videos[0].videoId;
        cacheSet(SEARCH_CACHE, query, videoId);
        return videoId;
    } catch {
        return null;
    }
}

/**
 * Get audio stream URLs for a YouTube video ID via Invidious.
 * Returns the highest quality audio-only stream URL available.
 * @param {string} videoId
 * @returns {Promise<string|null>}
 */
export async function getYTStreamUrl(videoId) {
    if (!videoId) return null;

    const cached = cacheGet(STREAM_CACHE, videoId);
    if (cached !== null) return cached;

    try {
        const data = await invidiousFetch(
            `/api/v1/videos/${videoId}`,
            { fields: 'adaptiveFormats,formatStreams' },
            { preferAudio: true }
        );

        // Prefer adaptive audio-only formats
        const audioFormats = (data.adaptiveFormats || []).filter(
            (f) => f.type && f.type.startsWith('audio/')
        );

        // Sort by bitrate descending
        audioFormats.sort((a, b) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));

        let streamUrl = audioFormats[0]?.url || null;

        // Fallback to combined format streams
        if (!streamUrl && data.formatStreams && data.formatStreams.length > 0) {
            streamUrl = data.formatStreams[data.formatStreams.length - 1]?.url || null;
        }

        if (streamUrl) cacheSet(STREAM_CACHE, videoId, streamUrl);
        return streamUrl;
    } catch {
        return null;
    }
}

/**
 * Find and return an audio stream URL for a track object.
 * Searches YouTube Music by "artist - title" and returns the stream URL.
 * @param {{ title: string, artist?: string, artists?: Array<{name:string}> }} track
 * @returns {Promise<string|null>}
 */
export async function findAudioForTrack(track) {
    const artist = track.artist || track.artists?.[0]?.name || '';
    const title = track.title || track.name || '';

    if (!title) return null;

    const query = artist ? `${artist} - ${title}` : title;
    const videoId = await searchYTMusic(query);
    if (!videoId) return null;

    return getYTStreamUrl(videoId);
}
