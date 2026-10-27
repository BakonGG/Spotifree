// netlify/functions/auth.js
// Auth backend for Spotyfree using better-auth with Discord + GitHub OAuth.
// Handles all /api/auth/* routes via Netlify redirect.

import { betterAuth } from 'better-auth';

const SITE_URL = process.env.URL || 'https://spotifree2.netlify.app';

// In-memory session store (resets on cold starts — acceptable for MVP)
// For persistence, replace with a KV or D1 database adapter.
const sessionStore = new Map();

let authInstance = null;

function getAuth() {
    if (authInstance) return authInstance;

    authInstance = betterAuth({
        secret: process.env.AUTH_SECRET || 'spotyfree-dev-secret-change-in-production',
        baseURL: SITE_URL,
        basePath: '/api/auth',
        trustedOrigins: [SITE_URL, 'http://localhost:5173', 'http://localhost:8888'],
        socialProviders: {
            github: {
                clientId: process.env.GITHUB_CLIENT_ID || '',
                clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
                redirectURI: `${SITE_URL}/api/auth/callback/github`,
            },
            discord: {
                clientId: process.env.DISCORD_CLIENT_ID || '',
                clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
                redirectURI: `${SITE_URL}/api/auth/callback/discord`,
            },
        },
        session: {
            expiresIn: 60 * 60 * 24 * 30, // 30 days
            updateAge: 60 * 60 * 24,       // refresh daily
            cookieCache: {
                enabled: true,
                maxAge: 60 * 5,
            },
        },
        user: {
            additionalFields: {
                provider: { type: 'string', required: false },
            },
        },
    });

    return authInstance;
}

export async function handler(event, context) {
    // Reconstruct the request path: event.path starts with /.netlify/functions/auth
    // but better-auth expects /api/auth/...
    // The netlify.toml redirect maps /api/auth/* → /.netlify/functions/auth/:splat
    const splat = event.path.replace(/^\/.netlify\/functions\/auth\/?/, '');
    const authPath = `/api/auth/${splat}`.replace(/\/+/g, '/');

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

        // Convert Web Response to Netlify response format
        const responseBody = await response.text();
        const responseHeaders = {};
        response.headers.forEach((value, key) => {
            responseHeaders[key] = value;
        });

        // Allow the frontend origin
        responseHeaders['Access-Control-Allow-Origin'] = SITE_URL;
        responseHeaders['Access-Control-Allow-Credentials'] = 'true';
        responseHeaders['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
        responseHeaders['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, Cookie';

        return {
            statusCode: response.status,
            headers: responseHeaders,
            body: responseBody,
        };
    } catch (err) {
        console.error('[Spotyfree Auth] Error:', err);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Auth service error', message: err.message }),
        };
    }
}
