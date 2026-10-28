// netlify/lib/auth-instance.js
// Instância única do better-auth (GitHub + Discord) compartilhada pelas funções do Netlify.
// Modo sem banco de dados ("stateless"): a sessão vive num cookie criptografado (JWE).
import { betterAuth } from 'better-auth';

export const SITE_URL = process.env.URL || 'https://spotifree2.netlify.app';

export const TRUSTED_ORIGINS = [
    SITE_URL,
    'https://spotifree2.netlify.app',
    'http://localhost:5173',
    'http://localhost:8888',
    'http://localhost:4173',
];

let authInstance = null;

export function getAuth() {
    if (authInstance) return authInstance;

    // Sem segredo não há como assinar sessões com segurança: falha em vez de usar um valor padrão público.
    const secret = process.env.AUTH_SECRET;
    if (!secret || secret.length < 32) {
        throw new Error('AUTH_SECRET ausente ou curto demais (mínimo 32 caracteres).');
    }

    const SESSION_SECONDS = 60 * 60 * 24 * 30; // 30 dias

    authInstance = betterAuth({
        secret,
        baseURL: SITE_URL,
        basePath: '/api/auth',
        trustedOrigins: TRUSTED_ORIGINS,
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
            expiresIn: SESSION_SECONDS,
            updateAge: 60 * 60 * 24, // renova uma vez por dia
            // Sem banco, o cookie É a sessão: o cache precisa durar tanto quanto ela
            // (antes estava em 5 minutos e a pessoa era deslogada logo depois de entrar).
            cookieCache: { enabled: true, strategy: 'jwe', refreshCache: true, maxAge: SESSION_SECONDS },
        },
        account: { storeStateStrategy: 'cookie', storeAccountCookie: true },
        advanced: {
            useSecureCookies: true,
            defaultCookieAttributes: { sameSite: 'lax', secure: true, httpOnly: true },
        },
    });

    return authInstance;
}

/** Lê a sessão a partir dos headers da requisição (cookie). Devolve o usuário ou null. */
export async function getSessionUser(event) {
    const headers = new Headers();
    for (const [k, v] of Object.entries(event.headers || {})) if (v != null) headers.set(k, String(v));
    const session = await getAuth().api.getSession({ headers });
    const user = session?.user;
    if (!user?.id) return null;
    return { id: String(user.id), name: user.name || '', image: user.image || '' };
}
