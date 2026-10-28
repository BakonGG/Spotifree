// server/config.js
// Configuração compartilhada pelas funções serverless (pasta api/) na Vercel.

// URL pública do site. Defina SITE_URL para usar um domínio próprio; senão usa o domínio de produção da Vercel.
export const SITE_URL =
    process.env.SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : 'http://localhost:3000');

// Origens autorizadas a fazer escritas (defesa extra contra CSRF).
export const TRUSTED_ORIGINS = [
    SITE_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:4173',
].filter(Boolean);

export const jsonResponse = (status, body, extra = {}) =>
    new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            ...extra,
        },
    });
