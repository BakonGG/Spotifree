// js/accounts/config.js
import { createAuthClient } from 'better-auth/client';

const getBaseURL = () => {
    const local = localStorage.getItem('spotyfree-auth-url');
    if (local) return local;

    if (window.__AUTH_URL__) return window.__AUTH_URL__;

    // Use VITE env var if available (set at build time), otherwise same origin
    if (import.meta.env.VITE_AUTH_BASE_URL) return import.meta.env.VITE_AUTH_BASE_URL;

    return window.location.origin;
};

export const AUTH_BASE_URL = getBaseURL();

export const authClient = createAuthClient({
    baseURL: AUTH_BASE_URL,
});

export { authClient as auth };
