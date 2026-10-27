// netlify/functions/tracks-proxy.js
// Serverless proxy for TracksStreamerAPI (tracks.monochrome.st)
// Runs on Netlify backend to completely bypass browser CORS limitations.

const UPSTREAM_HOST = 'https://tracks.monochrome.st';

export async function handler(event, _context) {
    const origin = event.headers?.origin || event.headers?.Origin || '*';
    const corsHeaders = {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Range, Authorization',
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    // Extract subpath: e.g. from /api/tracks/search/tracks or /.netlify/functions/tracks-proxy/search/tracks
    let path = event.path || '';
    path = path.replace(/^\/\.netlify\/functions\/tracks-proxy/, '');
    path = path.replace(/^\/api\/tracks/, '');
    if (!path.startsWith('/')) {
        path = `/${path}`;
    }

    // Build target upstream URL
    const queryString = event.rawQuery || (
        event.queryStringParameters
            ? Object.entries(event.queryStringParameters)
                  .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
                  .join('&')
            : ''
    );

    const targetUrl = `${UPSTREAM_HOST}${path}${queryString ? `?${queryString}` : ''}`;

    // For direct track audio playback, redirect 302 to upstream so browser audio element streams directly
    if (path.startsWith('/track/')) {
        return {
            statusCode: 302,
            headers: {
                ...corsHeaders,
                Location: targetUrl,
                'Cache-Control': 'public, max-age=86400',
            },
            body: '',
        };
    }

    try {
        const upstreamResponse = await fetch(targetUrl, {
            method: event.httpMethod,
            headers: {
                Accept: 'application/json',
                'User-Agent': 'Spotyfree/1.0',
            },
        });

        const contentType = upstreamResponse.headers.get('content-type') || 'application/json';
        const bodyText = await upstreamResponse.text();

        return {
            statusCode: upstreamResponse.status,
            headers: {
                ...corsHeaders,
                'Content-Type': contentType,
                'Cache-Control': upstreamResponse.headers.get('cache-control') || 'public, max-age=300',
            },
            body: bodyText,
        };
    } catch (err) {
        console.error('[tracks-proxy] Error fetching upstream:', err);
        return {
            statusCode: 502,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                error: 'Failed to proxy request to tracks.monochrome.st',
                message: err.message,
            }),
        };
    }
}
