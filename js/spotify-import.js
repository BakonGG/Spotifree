// Importação de playlists do Spotify: busca as faixas pelo nosso servidor e acha cada uma no catálogo.
// Faixas que o catálogo não tem ficam na playlist como faixas do Spotify e tocam via YouTube na hora.
import { parseCSV } from './playlist-importer.js';
import { getSpotifyTrack } from './spotify-api.js';

export function isSpotifyPlaylistInput(value) {
    const v = String(value || '').trim();
    return (
        /open\.spotify\.com\/(?:intl-[a-z]+\/)?playlist\/[A-Za-z0-9]{22}/.test(v) ||
        /^spotify:playlist:[A-Za-z0-9]{22}$/.test(v)
    );
}

/**
 * @param {string} urlOrUri link ou URI da playlist
 * @returns {Promise<{ name: string, cover: string, tracks: Array<{id: string, title: string, artist: string, duration: number}> }>}
 */
export async function fetchSpotifyPlaylist(urlOrUri) {
    const res = await fetch(`/api/spotify-playlist?url=${encodeURIComponent(String(urlOrUri).trim())}`);
    let data = null;
    try {
        data = await res.json();
    } catch {
        // resposta sem JSON: cai no erro genérico abaixo
    }
    if (!res.ok || !data?.tracks) {
        throw new Error(data?.error || 'Não foi possível ler a playlist do Spotify.');
    }
    return data;
}

const csvCell = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;

/** CSV no formato que o parseCSV entende (Title, Artist). */
function toCsv(tracks) {
    return `Title,Artist\n${tracks.map((t) => `${csvCell(t.title)},${csvCell(t.artist)}`).join('\n')}`;
}

/** Faixa mínima caso a API do Spotify não responda para aquele ID. */
function minimalSpotifyTrack(t) {
    const names = String(t.artist || '')
        .split(', ')
        .filter(Boolean);
    const artists = names.map((name) => ({ id: '', name }));
    return {
        id: `spotify:${t.id}`,
        spotifyId: t.id,
        title: t.title,
        name: t.title,
        duration: t.duration || 0,
        artists,
        artist: artists[0] || { id: '', name: 'Artista desconhecido' },
        album: { id: '', title: '', name: '', cover: null, coverUrl: null },
        cover: null,
        coverUrl: null,
        provider: 'spotify',
        type: 'track',
        allowStreaming: true,
    };
}

/**
 * Acha cada faixa no catálogo, mantendo a ordem da playlist original.
 * @returns {Promise<{ tracks: Array, fromCatalog: number, viaYoutube: number }>}
 */
export async function importSpotifyTracks(spotifyTracks, api, importOptions, onProgress) {
    const total = spotifyTracks.length;
    const result = new Array(total).fill(null);

    // 1) Catálogo, uma faixa por vez (o parseCSV já espaça as requisições para não estourar o limite)
    for (let i = 0; i < total; i++) {
        const t = spotifyTracks[i];
        onProgress?.({ current: i, total, currentTrack: t.title, currentArtist: t.artist });
        try {
            const r = await parseCSV(toCsv([t]), api, null, importOptions);
            if (r.tracks[0]) result[i] = r.tracks[0];
        } catch {
            // segue para o fallback
        }
    }
    const fromCatalog = result.filter(Boolean).length;

    // 2) O que o catálogo não tem vira faixa do Spotify (capa, álbum, ISRC), tocada via YouTube
    const missing = result.map((r, i) => (r ? -1 : i)).filter((i) => i >= 0);
    let cursor = 0;
    const worker = async () => {
        while (cursor < missing.length) {
            const i = missing[cursor++];
            const t = spotifyTracks[i];
            try {
                result[i] = t.id ? await getSpotifyTrack(t.id) : minimalSpotifyTrack(t);
            } catch {
                result[i] = minimalSpotifyTrack(t);
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(4, missing.length) }, worker));
    onProgress?.({ current: total, total, currentTrack: 'Pronto', currentArtist: '' });

    return { tracks: result.filter(Boolean), fromCatalog, viaYoutube: missing.length };
}
