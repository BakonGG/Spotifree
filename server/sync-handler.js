// server/sync-handler.js
// Dados da conta: biblioteca, histórico, playlists, pastas, configurações e perfil.
// Rotas: GET/PATCH /api/sync, PATCH /api/me/profile, GET /api/users/:username
// Tudo é gravado no Vercel Blob (privado), separado por usuário, e só acessível com sessão válida.
import { TRUSTED_ORIGINS, jsonResponse as json } from './config.js';
import { getSessionUser } from './auth-instance.js';
import { hashId, readJSON, removeJSON, writeJSON } from './store.js';

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const USERNAME_RE = /^[a-z0-9_]{3,30}$/;
const SETTING_KEY_RE = /^[A-Za-z0-9._:-]{1,80}$/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const emptyRecord = () => ({
    library: {},
    history: [],
    userPlaylists: {},
    userFolders: {},
    settings: {},
    settingsUpdatedAt: 0,
    profile: {},
    updatedAt: 0,
});

const recordPath = (userId) => `u/${hashId(userId)}.json`;
const usernamePath = (name) => `username/${name}.json`;

async function loadRecord(userId) {
    const rec = await readJSON(recordPath(userId));
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

const cleanText = (v, max) =>
    typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';
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

function applySyncPatch(rec, patch) {
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

export async function handleSync(request) {
    const method = request.method;
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/sync';

    // Escritas só vêm do próprio site (defesa extra contra CSRF, além do cookie SameSite=Lax)
    if (method !== 'GET' && method !== 'HEAD') {
        const origin = request.headers.get('origin') || '';
        if (!TRUSTED_ORIGINS.includes(origin)) return json(403, { error: 'Origem não permitida' });
    }

    // GET /api/users/:username é público (perfil); o resto exige sessão
    const userMatch = path.match(/^\/users\/([A-Za-z0-9_]{1,30})$/);
    if (method === 'GET' && userMatch) {
        try {
            const owner = await readJSON(usernamePath(userMatch[1].toLowerCase()));
            if (!owner?.id) return json(404, { error: 'Usuário não encontrado' });
            const rec = await loadRecord(owner.id);
            const profile = publicProfile(rec);
            const playlists = {};
            if (profile.privacy_playlists === 'public') {
                for (const [id, p] of Object.entries(rec.userPlaylists || {})) if (p?.isPublic) playlists[id] = p;
            }
            return json(200, { ...profile, user_playlists: playlists });
        } catch (err) {
            console.error('[sync] perfil:', err.message);
            return json(503, { error: 'Armazenamento indisponível no momento' });
        }
    }

    let user;
    try {
        user = await getSessionUser(request);
    } catch (err) {
        console.error('[sync] sessão:', err.message);
        return json(500, { error: 'Falha ao validar a sessão' });
    }
    if (!user) return json(401, { error: 'Entre na sua conta para sincronizar' });

    let body = {};
    if (method === 'PATCH' || method === 'PUT' || method === 'POST') {
        const text = await request.text();
        if (Buffer.byteLength(text) > MAX_BODY_BYTES) return json(413, { error: 'Dados grandes demais' });
        try {
            body = text ? JSON.parse(text) : {};
        } catch {
            return json(400, { error: 'JSON inválido' });
        }
        if (!isPlainObject(body)) return json(400, { error: 'Corpo inválido' });
    }

    try {
        if (path === '/sync' && method === 'GET') {
            const rec = await loadRecord(user.id);
            return json(200, {
                appUserId: hashId(user.id),
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
            const rec = await loadRecord(user.id);
            applySyncPatch(rec, body);
            await writeJSON(recordPath(user.id), rec);
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
            const rec = await loadRecord(user.id);
            const p = { ...(rec.profile || {}) };

            if ('username' in body) {
                const wanted = cleanText(body.username, 30).toLowerCase();
                if (!USERNAME_RE.test(wanted)) {
                    return json(400, { error: 'Nome de usuário: 3 a 30 caracteres (letras minúsculas, números e _)' });
                }
                const owner = await readJSON(usernamePath(wanted));
                const me = hashId(user.id);
                if (owner?.id && owner.id !== me && owner.id !== user.id) {
                    return json(409, { error: 'Esse nome de usuário já está em uso' });
                }
                if (p.username && p.username !== wanted) await removeJSON(usernamePath(p.username));
                await writeJSON(usernamePath(wanted), { id: user.id });
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
            await writeJSON(recordPath(user.id), rec);
            return json(200, publicProfile(rec));
        }

        return json(404, { error: 'Rota não encontrada' });
    } catch (err) {
        if (/inválid/.test(err.message)) return json(400, { error: err.message });
        console.error('[sync]', err);
        return json(500, { error: 'Erro ao salvar seus dados' });
    }
}
