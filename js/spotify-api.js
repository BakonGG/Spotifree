// js/spotify-api.js
// Spotify Web API client for metadata, search, and recommendations.
// Audio streaming is NOT available via Spotify API — use ytmusic-api.js for that.

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const TOKEN_ENDPOINT = '/.netlify/functions/spotify-token';
const TOKEN_CACHE_KEY = 'spotyfree-spotify-token';
const TOKEN_EXPIRY_KEY = 'spotyfree-spotify-token-expiry';

async function getAccessToken() {
    const cached = sessionStorage.getItem(TOKEN_CACHE_KEY);
    const expiry = parseInt(sessionStorage.getItem(TOKEN_EXPIRY_KEY) || '0', 10);

    if (cached && Date.now() < expiry) return cached;

    const res = await fetch(TOKEN_ENDPOINT);
    if (!res.ok) throw new Error(`Failed to get Spotify token: ${res.status}`);

    const data = await res.json();
    if (!data.access_token) throw new Error('No access token in Spotify response');

    sessionStorage.setItem(TOKEN_CACHE_KEY, data.access_token);
    sessionStorage.setItem(TOKEN_EXPIRY_KEY, String(Date.now() + (data.expires_in - 60) * 1000));

    return data.access_token;
}

async function spotifyFetch(path, params = {}) {
    const token = await getAccessToken();
    const url = new URL(`${SPOTIFY_API_BASE}${path}`);
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Spotify API error ${res.status}: ${text}`);
    }
    return res.json();
}

// ─── Normalizers ────────────────────────────────────────────────────────────

function normalizeImage(images) {
    if (!images || images.length === 0) return null;
    // Prefer the largest image
    return images.sort((a, b) => (b.width || 0) - (a.width || 0))[0].url;
}

function normalizeArtistRef(artists) {
    if (!artists || artists.length === 0) return [];
    return artists.map((a) => ({ id: `spotify:${a.id}`, name: a.name }));
}

export function normalizeSpotifyTrack(track) {
    if (!track) return null;
    return {
        id: `spotify:${track.id}`,
        title: track.name,
        duration: Math.round((track.duration_ms || 0) / 1000),
        artists: normalizeArtistRef(track.artists),
        artist: track.artists?.[0]?.name || '',
        album: {
            id: `spotify:${track.album?.id}`,
            title: track.album?.name || '',
            cover: normalizeImage(track.album?.images),
        },
        cover: normalizeImage(track.album?.images),
        isrc: track.external_ids?.isrc || null,
        explicit: track.explicit || false,
        popularity: track.popularity || 0,
        previewUrl: track.preview_url || null,
        provider: 'spotify',
        spotifyId: track.id,
    };
}

export function normalizeSpotifyAlbum(album) {
    if (!album) return null;
    return {
        id: `spotify:${album.id}`,
        title: album.name,
        cover: normalizeImage(album.images),
        artists: normalizeArtistRef(album.artists),
        artist: album.artists?.[0]?.name || '',
        releaseDate: album.release_date || null,
        totalTracks: album.total_tracks || 0,
        tracks: (album.tracks?.items || []).map(normalizeSpotifyTrack),
        provider: 'spotify',
        spotifyId: album.id,
    };
}

export function normalizeSpotifyArtist(artist) {
    if (!artist) return null;
    return {
        id: `spotify:${artist.id}`,
        name: artist.name,
        cover: normalizeImage(artist.images),
        genres: artist.genres || [],
        popularity: artist.popularity || 0,
        provider: 'spotify',
        spotifyId: artist.id,
    };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Search Spotify for tracks, albums, and artists.
 * @param {string} query
 * @param {{ limit?: number, offset?: number, types?: string[] }} options
 */
export async function searchSpotify(query, { limit = 20, offset = 0, types = ['track', 'album', 'artist'] } = {}) {
    if (!query) return { tracks: [], albums: [], artists: [] };

    const data = await spotifyFetch('/search', {
        q: query,
        type: types.join(','),
        limit,
        offset,
        market: 'from_token',
    });

    return {
        tracks: (data.tracks?.items || []).map(normalizeSpotifyTrack).filter(Boolean),
        albums: (data.albums?.items || []).map(normalizeSpotifyAlbum).filter(Boolean),
        artists: (data.artists?.items || []).map(normalizeSpotifyArtist).filter(Boolean),
    };
}

/**
 * Get a single track by its raw Spotify ID (without "spotify:" prefix).
 */
export async function getSpotifyTrack(id) {
    const rawId = id.replace('spotify:', '');
    const data = await spotifyFetch(`/tracks/${rawId}`);
    return normalizeSpotifyTrack(data);
}

/**
 * Get an album with its track list by raw Spotify ID.
 */
export async function getSpotifyAlbum(id) {
    const rawId = id.replace('spotify:', '');
    const data = await spotifyFetch(`/albums/${rawId}`);
    return normalizeSpotifyAlbum(data);
}

/**
 * Get an artist by raw Spotify ID.
 */
export async function getSpotifyArtist(id) {
    const rawId = id.replace('spotify:', '');
    const data = await spotifyFetch(`/artists/${rawId}`);
    return normalizeSpotifyArtist(data);
}

/**
 * Get an artist's top tracks.
 */
export async function getSpotifyArtistTopTracks(id, market = 'US') {
    const rawId = id.replace('spotify:', '');
    const data = await spotifyFetch(`/artists/${rawId}/top-tracks`, { market });
    return (data.tracks || []).map(normalizeSpotifyTrack).filter(Boolean);
}

/**
 * Get track recommendations based on seed tracks.
 * @param {string[]} seedTrackIds  Up to 5 raw Spotify track IDs
 */
export async function getSpotifyRecommendations(seedTrackIds, { limit = 20 } = {}) {
    if (!seedTrackIds || seedTrackIds.length === 0) return [];
    const seeds = seedTrackIds.map((id) => id.replace('spotify:', '')).slice(0, 5);
    const data = await spotifyFetch('/recommendations', {
        seed_tracks: seeds.join(','),
        limit,
    });
    return (data.tracks || []).map(normalizeSpotifyTrack).filter(Boolean);
}
