// netlify/functions/spotify-token.js
// Returns a Spotify Client Credentials access token to the frontend.
// Keeps SPOTIFY_CLIENT_SECRET server-side only.

const DEFAULT_ORIGIN = process.env.URL || 'https://spotifree2.netlify.app';

export async function handler(event) {
    const origin = event.headers?.origin || event.headers?.Origin || DEFAULT_ORIGIN;
    const corsHeaders = {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    const clientId = process.env.SPOTIFY_CLIENT_ID || process.env.VITE_SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        return {
            statusCode: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Spotify credentials not configured' }),
        };
    }

    try {
        const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                Authorization: `Basic ${credentials}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: 'grant_type=client_credentials',
        });

        if (!response.ok) {
            const text = await response.text();
            return {
                statusCode: response.status,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Spotify token request failed', detail: text }),
            };
        }

        const data = await response.json();
        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json',
                // Cache slightly under expires_in to avoid using expired tokens
                'Cache-Control': `public, max-age=${Math.max((data.expires_in || 3600) - 60, 0)}`,
            },
            body: JSON.stringify({
                access_token: data.access_token,
                expires_in: data.expires_in,
            }),
        };
    } catch (err) {
        return {
            statusCode: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Internal error', message: err.message }),
        };
    }
}
