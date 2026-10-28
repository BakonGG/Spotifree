// /api/spotify-token
// Devolve um token do Spotify (Client Credentials) ao front. O segredo fica só no servidor.
import { jsonResponse as json } from '../server/config.js';

export async function GET() {
    const clientId = process.env.SPOTIFY_CLIENT_ID || process.env.VITE_SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!clientId || !clientSecret) return json(500, { error: 'Spotify não configurado' });

    try {
        const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                Authorization: `Basic ${credentials}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: 'grant_type=client_credentials',
            signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) return json(response.status, { error: 'Spotify token request failed' });

        const data = await response.json();
        return json(
            200,
            { access_token: data.access_token, expires_in: data.expires_in },
            // Guarda um pouco menos que a validade, para nunca entregar um token vencido
            { 'Cache-Control': `public, max-age=${Math.max((data.expires_in || 3600) - 60, 0)}` }
        );
    } catch (err) {
        console.error('[spotify-token]', err.message);
        return json(502, { error: 'Falha ao obter o token' });
    }
}
