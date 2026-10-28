// js/accounts/config.js
import { createAuthClient } from 'better-auth/client';

// Sempre a própria origem do site: endereços vindos de localStorage ou da janela poderiam desviar o login.
const getBaseURL = () => window.location.origin;

export const AUTH_BASE_URL = getBaseURL();

export const authClient = createAuthClient({
    baseURL: AUTH_BASE_URL,
});

export { authClient as auth };
