// netlify/functions/sync.js
// Dados da conta: biblioteca, histórico, playlists, pastas, configurações e perfil.
// Rotas (via redirects): GET/PATCH /api/sync, PATCH /api/me/profile, GET /api/users/:username
// Tudo é gravado no Netlify Blobs, separado por usuário, e só é acessível com sessão válida.
import { connectLambda, getStore } from '@netlify/blobs';
import { SITE_URL, TRUSTED_ORIGINS, getSessionUser } from '../lib/auth-instance.js';

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const USERNAME_RE = /^[a-z0-9_]{3,30}$/;
const SETTING_KEY_RE = /^[A-Za-z0-9._:-]{1,80}$/;

const json = (statusCode, body, extra = {}) => ({
    statusCode,
    headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...extra,
    },
    body: JSON.stringify(body),
});

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function emptyRecord() {
    return {
        library: {},
        history: [],
        userPlaylists: {},
        userFolders: {},
        settings: {},
        settingsUpdatedAt: 0,
        profile: {},
        updatedAt: 0,
    };
}

async function loadRecord(store, userId) {
    const rec = await store.get(`u/${userId}`, { type: 'json' });
    return { ...emptyRecord(), ...(isPlainObject(rec) ? rec : {}) };
}

function publicProfile(rec) {
    const p = rec.profile || {};
    return {
        username: p.username || null,
        display_name: p.display_name || '',
        avatar_url: p.avatar_url || '',
        banner_url: p.banner_url || '',
        status: p.status || '',
        about: p.about || '',
        website: p.website || '',
        privacy_playlists: p.privacy_playlists || 'public',
        privacy_lastfm: p.privacy_lastfm || 'public',
        lastfm_username: p.lastfm_username || '',
        favorite_albums: Array.isArray(p.favorite_albums) ? p.favorite_albums : [],
    };
}

const cleanText = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '');
const cleanUrl = (v) => {
    const s = cleanText(v, 500);
    if (!s) return '';
    try {
        const u = new URL(s);
        return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : '';
    } catch {
        return '';
    }
};

async function applySyncPatch(rec, patch) {
    if ('library' in patch) {
        if (!isPlainObject(patch.library)) throw new Error('library inválida');
        rec.library = patch.library;
    }
    if ('history' in patch) {
        if (!Array.isArray(patch.history)) throw new Error('history inválido');
        rec.history = patch.history.slice(0, 500);
    }
    if ('userPlaylists' in patch) {
        if (!isPlainObject(patch.userPlaylists)) throw new Error('userPlaylists inválido');
        rec.userPlaylists = patch.userPlaylists;
    }
    if ('userFolders' in patch) {
        if (!isPlainObject(patch.userFolders)) throw new Error('userFolders inválido');
        rec.userFolders = patch.userFolders;
    }
    if ('settings' in patch) {
        if (!isPlainObject(patch.settings)) throw new Error('settings inválido');
        const next = {};
        for (const [k, v] of Object.entries(patch.settings).slice(0, 300)) {
            if (SETTING_KEY_RE.test(k) && typeof v === 'string' && v.length <= 600000) next[k] = v;
        }
        rec.settings = next;
        rec.settingsUpdatedAt = Date.now();
    }
    rec.updatedAt = Date.now();
}

export async function handler(event) {
    try {
        connectLambda(event);
    } catch {
        // fora do Netlify (dev local) o store pode não existir; o getStore abaixo avisa
    }

    const method = event.httpMethod;
    const path = (event.path || '').replace(/^\/\.netlify\/functions\/sync/, '').replace(/^\/api/, '') || '/sync';
    const origin = event.headers?.origin || event.headers?.Origin || '';

    // Escritas só vêm do próprio site (defesa extra contra CSRF, além do cookie SameSite=Lax)
    if (method !== 'GET' && method !== 'OPTIONS') {
        if (!TRUSTED_ORIGINS.includes(origin) && origin !== SITE_URL) {
            return json(403, { error: 'Origem não permitida' });
        }
    }
    if (method === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };

    let store;
    try {
        store = getStore({ name: 'user-data' });
    } catch (err) {
        console.error('[sync] store indisponível:', err.message);
        return json(503, { error: 'Armazenamento indisponível no momento' });
    }

    // GET /api/users/:username é público (perfil), o resto exige sessão
    const userMatch = path.match(/^\/users\/([A-Za-z0-9_]{1,30})$/);
    if (method === 'GET' && userMatch) {
        const username = userMatch[1].toLowerCase();
        const userId = await store.get(`username/${username}`);
        if (!userId) return json(404, { error: 'Usuário não encontrado' });
        const rec = await loadRecord(store, userId);
        const profile = publicProfile(rec);
        const playlists = {};
        if (profile.privacy_playlists === 'public') {
            for (const [id, p] of Object.entries(rec.userPlaylists || {})) if (p?.isPublic) playlists[id] = p;
        }
        return json(200, { ...profile, user_playlists: playlists });
    }

    let user;
    try {
        user = await getSessionUser(event);
    } catch (err) {
        console.error('[sync] sessão:', err.message);
        return json(500, { error: 'Falha ao validar a sessão' });
    }
    if (!user) return json(401, { error: 'Entre na sua conta para sincronizar' });

    if (event.body && Buffer.byteLength(event.body) > MAX_BODY_BYTES) {
        return json(413, { error: 'Dados grandes demais' });
    }

    let body = {};
    if (method === 'PATCH' || method === 'PUT' || method === 'POST') {
        try {
            body = event.body ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body) : {};
        } catch {
            return json(400, { error: 'JSON inválido' });
        }
        if (!isPlainObject(body)) return json(400, { error: 'Corpo inválido' });
    }

    try {
        if (path === '/sync' && method === 'GET') {
            const rec = await loadRecord(store, user.id);
            return json(200, {
                appUserId: user.id,
                profile: publicProfile(rec),
                library: rec.library,
                history: rec.history,
                userPlaylists: rec.userPlaylists,
                userFolders: rec.userFolders,
                settings: rec.settings,
                settingsUpdatedAt: rec.settingsUpdatedAt,
                updatedAt: rec.updatedAt,
            });
        }

        if (path === '/sync' && method === 'PATCH') {
            const rec = await loadRecord(store, user.id);
            await applySyncPatch(rec, body);
            await store.setJSON(`u/${user.id}`, rec);
            return json(200, {
                library: rec.library,
                history: rec.history,
                userPlaylists: rec.userPlaylists,
                userFolders: rec.userFolders,
                settings: rec.settings,
                settingsUpdatedAt: rec.settingsUpdatedAt,
                updatedAt: rec.updatedAt,
            });
        }

        if (path === '/me/profile' && method === 'PATCH') {
            const rec = await loadRecord(store, user.id);
            const p = { ...(rec.profile || {}) };

            if ('username' in body) {
                const wanted = cleanText(body.username, 30).toLowerCase();
                if (!USERNAME_RE.test(wanted)) {
                    return json(400, { error: 'Nome de usuário: 3 a 30 caracteres (letras minúsculas, números e _)' });
                }
                const owner = await store.get(`username/${wanted}`);
                if (owner && owner !== user.id) return json(409, { error: 'Esse nome de usuário já está em uso' });
                if (p.username && p.username !== wanted) await store.delete(`username/${p.username}`);
                await store.set(`username/${wanted}`, user.id);
                p.username = wanted;
            }
            if ('display_name' in body) p.display_name = cleanText(body.display_name, 60);
            if ('status' in body) p.status = cleanText(body.status, 120);
            if ('about' in body) p.about = cleanText(body.about, 500);
            if ('lastfm_username' in body) p.lastfm_username = cleanText(body.lastfm_username, 60);
            for (const key of ['avatar_url', 'banner_url', 'website']) {
                if (key in body) p[key] = cleanUrl(body[key]);
            }
            for (const key of ['privacy_playlists', 'privacy_lastfm']) {
                if (key in body) p[key] = body[key] === 'private' ? 'private' : 'public';
            }
            if ('favorite_albums' in body) {
                p.favorite_albums = (Array.isArray(body.favorite_albums) ? body.favorite_albums : [])
                    .slice(0, 5)
                    .filter(isPlainObject)
                    .map((a) => ({
                        id: cleanText(String(a.id ?? ''), 80),
                        title: cleanText(a.title, 200),
                        cover: cleanUrl(a.cover) || cleanText(a.cover, 200),
                        artist: cleanText(typeof a.artist === 'string' ? a.artist : a.artist?.name, 200),
                    }));
            }

            rec.profile = p;
            rec.updatedAt = Date.now();
            await store.setJSON(`u/${user.id}`, rec);
            return json(200, publicProfile(rec));
        }

        return json(404, { error: 'Rota não encontrada' });
    } catch (err) {
        if (/inválid/.test(err.message)) return json(400, { error: err.message });
        console.error('[sync]', err);
        return json(500, { error: 'Erro ao salvar seus dados' });
    }
}
