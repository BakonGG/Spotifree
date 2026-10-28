// Rotas de login (better-auth): /api/auth/*
import { getAuth } from '../server/auth-instance.js';

const handle = (request) => {
    try {
        return getAuth().handler(request);
    } catch (err) {
        console.error('[auth]', err.message);
        return new Response(JSON.stringify({ error: 'Serviço de login indisponível' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};

export const GET = handle;
export const POST = handle;
