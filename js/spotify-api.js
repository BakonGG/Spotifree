// js/spotify-api.js
// Spotify Web API client for metadata, search, and recommendations.
// Audio streaming is fetched via high-quality YouTube Music / Invidious fallback (ytmusic-api.js).

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const TOKEN_CACHE_KEY = 'spotyfree-spotify-token';
const TOKEN_EXPIRY_KEY = 'spotyfree-spotify-token-expiry';

function getTokenEndpoint() {
    if (typeof window !== 'undefined') {
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        if (isLocal) {
            const remoteBase = import.meta.env?.VITE_AUTH_BASE_URL || 'https://spotifree2.netlify.app';
            return `${remoteBase}/.netlify/functions/spotify-token`;
        }
    }
    return '/.netlify/functions/spotify-token';
}

async function getAccessToken() {
    const cached = sessionStorage.getItem(TOKEN_CACHE_KEY);
    const expiry = parseInt(sessionStorage.getItem(TOKEN_EXPIRY_KEY) || '0', 10);

    if (cached && Date.now() < expiry) return cached;

    const endpoint = getTokenEndpoint();
    const res = await fetch(endpoint);
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
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
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
    // Prefer highest resolution
    return images.slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || null;
}

function normalizeArtistRef(artists) {
    if (!artists || artists.length === 0) return [];
    return artists.map((a) => ({
        id: `spotify:${a.id}`,
        name: a.name,
        _href: `/artist/spotify:${a.id}`,
    }));
}

export function normalizeSpotifyTrack(track) {
    if (!track) return null;
    const albumCover = normalizeImage(track.album?.images);
    const artists = normalizeArtistRef(track.artists);
    const primaryArtist = artists[0] || { id: '', name: 'Unknown Artist' };

    return {
        id: `spotify:${track.id}`,
        title: track.name,
        name: track.name,
        duration: Math.round((track.duration_ms || 0) / 1000),
        artists: artists,
        artist: primaryArtist,
        album: {
            id: track.album?.id ? `spotify:${track.album.id}` : '',
            title: track.album?.name || '',
            name: track.album?.name || '',
            cover: albumCover,
            coverUrl: albumCover,
        },
        cover: albumCover,
        coverUrl: albumCover,
        isrc: track.external_ids?.isrc || null,
        explicit: track.explicit || false,
        popularity: track.popularity || 0,
        previewUrl: track.preview_url || null,
        provider: 'spotify',
        spotifyId: track.id,
        trackNumber: track.track_number || 1,
        type: 'track',
        allowStreaming: true,
    };
}

export function normalizeSpotifyAlbum(album) {
    if (!album) return null;
    const coverUrl = normalizeImage(album.images);
    const artists = normalizeArtistRef(album.artists);

    return {
        id: `spotify:${album.id}`,
        title: album.name,
        name: album.name,
        cover: coverUrl,
        coverUrl: coverUrl,
        artists: artists,
        artist: artists[0] || { id: '', name: 'Unknown Artist' },
        releaseDate: album.release_date || null,
        year: album.release_date ? album.release_date.split('-')[0] : '',
        totalTracks: album.total_tracks || 0,
        numberOfTracks: album.total_tracks || 0,
        tracks: (album.tracks?.items || []).map((t) =>
            normalizeSpotifyTrack({
                ...t,
                album: { id: album.id, name: album.name, images: album.images },
            })
        ),
        provider: 'spotify',
        spotifyId: album.id,
        type: 'album',
    };
}

export function normalizeSpotifyArtist(artist) {
    if (!artist) return null;
    const picture = normalizeImage(artist.images);

    return {
        id: `spotify:${artist.id}`,
        name: artist.name,
        picture: picture,
        cover: picture,
        coverUrl: picture,
        genres: artist.genres || [],
        popularity: artist.popularity || 0,
        provider: 'spotify',
        spotifyId: artist.id,
        type: 'artist',
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
        market: 'BR',
    });

    return {
        tracks: (data.tracks?.items || []).map(normalizeSpotifyTrack).filter(Boolean),
        albums: (data.albums?.items || []).map(normalizeSpotifyAlbum).filter(Boolean),
        artists: (data.artists?.items || []).map(normalizeSpotifyArtist).filter(Boolean),
    };
}

/**
 * Get a single track by its raw Spotify ID (or spotify:xxx).
 */
export async function getSpotifyTrack(id) {
    const rawId = String(id).replace('spotify:', '');
    const data = await spotifyFetch(`/tracks/${rawId}`, { market: 'BR' });
    return normalizeSpotifyTrack(data);
}

/**
 * Get an album with its track list by Spotify ID.
 */
export async function getSpotifyAlbum(id) {
    const rawId = String(id).replace('spotify:', '');
    const data = await spotifyFetch(`/albums/${rawId}`, { market: 'BR' });
    return normalizeSpotifyAlbum(data);
}

/**
 * Get an artist by Spotify ID.
 */
export async function getSpotifyArtist(id) {
    const rawId = String(id).replace('spotify:', '');
    const data = await spotifyFetch(`/artists/${rawId}`);
    return normalizeSpotifyArtist(data);
}

/**
 * Get an artist's top tracks.
 */
export async function getSpotifyArtistTopTracks(id, market = 'BR') {
    const rawId = String(id).replace('spotify:', '');
    const data = await spotifyFetch(`/artists/${rawId}/top-tracks`, { market });
    return (data.tracks || []).map(normalizeSpotifyTrack).filter(Boolean);
}

/**
 * Get track recommendations based on seed tracks.
 * @param {string[]} seedTrackIds  Up to 5 Spotify track IDs
 */
export async function getSpotifyRecommendations(seedTrackIds, { limit = 20 } = {}) {
    if (!seedTrackIds || seedTrackIds.length === 0) return [];
    const seeds = seedTrackIds.map((id) => String(id).replace('spotify:', '')).slice(0, 5);
    const data = await spotifyFetch('/recommendations', {
        seed_tracks: seeds.join(','),
        limit,
        market: 'BR',
    });
    return (data.tracks || []).map(normalizeSpotifyTrack).filter(Boolean);
}
