// netlify/functions/spotify-playlist.js
// Lê uma playlist pública do Spotify pela página de incorporação (embed) e devolve as faixas em JSON.
// A API oficial não deixa ler playlists sem login do usuário, e o embed é público.
// Segurança: só aceita um ID de 22 caracteres alfanuméricos e só acessa open.spotify.com (sem SSRF).

const ID_RE = /^[A-Za-z0-9]{22}$/;
const ALLOWED_ORIGINS = new Set(['https://spotifree2.netlify.app', 'http://localhost:5173', 'http://localhost:4173']);

function parsePlaylistId(input) {
    const raw = String(input || '').trim();
    if (ID_RE.test(raw)) return raw;
    const uri = raw.match(/^spotify:playlist:([A-Za-z0-9]{22})$/);
    if (uri) return uri[1];
    try {
        const url = new URL(raw);
        if (url.hostname !== 'open.spotify.com' && url.hostname !== 'spotify.link') return null;
        const m = url.pathname.match(/\/playlist\/([A-Za-z0-9]{22})(?:\/|$)/);
        return m ? m[1] : null;
    } catch {
        return null;
    }
}

export async function handler(event) {
    const origin = event.headers?.origin || event.headers?.Origin || '';
    const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=300',
    };
    if (ALLOWED_ORIGINS.has(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers.Vary = 'Origin';
    }

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, OPTIONS' }, body: '' };
    }
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido' }) };
    }

    const id = parsePlaylistId(event.queryStringParameters?.id || event.queryStringParameters?.url);
    if (!id) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Link inválido. Use o link de uma playlist do Spotify.' }),
        };
    }

    try {
        const res = await fetch(`https://open.spotify.com/embed/playlist/${id}`, {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
                'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
            },
            signal: AbortSignal.timeout(10000),
        });
        if (res.status === 404) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: 'Playlist não encontrada ou privada.' }) };
        }
        if (!res.ok) throw new Error(`Spotify respondeu ${res.status}`);

        const html = await res.text();
        const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        if (!match) throw new Error('Formato inesperado da página do Spotify');
        const entity = JSON.parse(match[1])?.props?.pageProps?.state?.data?.entity;
        const list = Array.isArray(entity?.trackList) ? entity.trackList : [];
        if (!entity || list.length === 0) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'Não encontrei faixas. A playlist precisa ser pública.' }),
            };
        }

        const cover = entity.coverArt?.sources?.slice(-1)[0]?.url || '';
        const tracks = list
            .filter((t) => t?.title)
            .map((t) => ({
                id: String(t.uri || '').split(':')[2] || '',
                title: String(t.title),
                artist: String(t.subtitle || ''),
                duration: Math.round((Number(t.duration) || 0) / 1000),
            }));

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ name: entity.name || entity.title || 'Playlist do Spotify', cover, tracks }),
        };
    } catch (err) {
        console.error('[spotify-playlist]', err.message);
        return {
            statusCode: 502,
            headers,
            body: JSON.stringify({ error: 'Não foi possível ler a playlist agora. Tente de novo em instantes.' }),
        };
    }
}
