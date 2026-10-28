// netlify/functions/auth.js
// Auth backend for Spotyfree using better-auth with Discord + GitHub OAuth.
// Handles all /api/auth/* routes via Netlify redirect.

import { SITE_URL, TRUSTED_ORIGINS, getAuth } from '../lib/auth-instance.js';

export async function handler(event, _context) {
    const requestOrigin = event.headers.origin || event.headers.Origin || '';
    const origin = TRUSTED_ORIGINS.includes(requestOrigin) ? requestOrigin : SITE_URL;
    const corsHeaders = {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie',
    };

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: corsHeaders,
            body: '',
        };
    }

    // Safely reconstruct the request path:
    // If Netlify forwarded /.netlify/functions/auth/:splat or preserved /api/auth/:splat
    let authPath = event.path;
    if (authPath.startsWith('/.netlify/functions/auth')) {
        authPath = authPath.replace(/^\/.netlify\/functions\/auth\/?/, '');
    }
    if (!authPath.startsWith('/api/auth')) {
        authPath = `/api/auth/${authPath.replace(/^\//, '')}`;
    }
    authPath = authPath.replace(/\/+/g, '/');

    const auth = getAuth();

    // Build a Web Request compatible with better-auth's handler
    const url = new URL(authPath, SITE_URL);
    if (event.queryStringParameters) {
        for (const [k, v] of Object.entries(event.queryStringParameters)) {
            url.searchParams.set(k, v);
        }
    }

    const headers = new Headers(event.headers || {});
    const body = event.body
        ? event.isBase64Encoded
            ? Buffer.from(event.body, 'base64').toString('utf-8')
            : event.body
        : undefined;

    const request = new Request(url.toString(), {
        method: event.httpMethod,
        headers,
        body: ['GET', 'HEAD'].includes(event.httpMethod) ? undefined : body,
    });

    try {
        const response = await auth.handler(request);

        const responseBody = await response.text();
        const responseHeaders = { ...corsHeaders };
        response.headers.forEach((value, key) => {
            if (key.toLowerCase() !== 'set-cookie') {
                responseHeaders[key] = value;
            }
        });

        const multiValueHeaders = {};
        if (typeof response.headers.getSetCookie === 'function') {
            const cookies = response.headers.getSetCookie();
            if (cookies && cookies.length > 0) {
                multiValueHeaders['Set-Cookie'] = cookies;
            }
        }

        return {
            statusCode: response.status,
            headers: responseHeaders,
            multiValueHeaders: Object.keys(multiValueHeaders).length > 0 ? multiValueHeaders : undefined,
            body: responseBody,
        };
    } catch (err) {
        console.error('[Spotyfree Auth] Error:', err);
        return {
            statusCode: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Auth service error', message: err.message }),
        };
    }
}
