// Sincroniza configurações e dados de recomendação (histórico de escuta) com a conta.
// Ao entrar: baixa as configurações da nuvem (se mais novas) ou envia as locais.
// Depois: qualquer mudança nas chaves sincronizadas é enviada em segundo plano.
import { dataApi } from './authApi.js';
import { authManager } from './auth.js';

const SYNC_KEYS = new Set([
    'spotyfree-theme',
    'spotyfree-font',
    'monochrome-font-config-v2',
    'monochrome-sidebar-collapsed',
    'album-background-enabled',
    'artist-banners-enabled',
    'close-modals-on-navigation',
    'cover-art-size',
    'crossfade-enabled',
    'disable-blur-effects',
    'exponential-volume-enabled',
    'gapless-playback-enabled',
    'keyboard-shortcuts',
    'lossless-container',
    'mono-audio-enabled',
    'now-playing-mode',
    'show-quality-badges',
    'silence-removal-enabled',
    'use-album-release-year',
    'waveform-seekbar-enabled',
    'libraryLikedTracksView',
    'side-panel-width',
    'volume',
    'muted',
    // Gostos e histórico de escuta: é o que faz as recomendações acompanharem o que a pessoa ouve
    'monochrome-listening-data',
    'spotifree_onboarding_done',
    'spotifree_user_artists',
    'spotifree_user_genres',
]);
const SYNC_PREFIXES = ['butterchurn-', 'fullscreen-', 'show-', 'sidebar-'];
const SYNCED_AT_KEY = 'spotifree-settings-synced-at'; // só local: quando a nuvem foi aplicada/enviada

const isSyncKey = (key) => SYNC_KEYS.has(key) || SYNC_PREFIXES.some((p) => key.startsWith(p));

function snapshot() {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && isSyncKey(key)) out[key] = localStorage.getItem(key);
    }
    return out;
}

let applying = false;
let timer = null;
let pushing = false;

async function push() {
    if (!authManager.user || applying || pushing) return;
    pushing = true;
    try {
        const res = await dataApi('/api/sync', { method: 'PATCH', body: JSON.stringify({ settings: snapshot() }) });
        localStorage.setItem(SYNCED_AT_KEY, String(res?.settingsUpdatedAt || Date.now()));
    } catch (err) {
        console.warn('[SettingsSync] falha ao enviar:', err.message);
    } finally {
        pushing = false;
    }
}

function schedulePush(delay = 8000) {
    if (!authManager.user || applying) return;
    clearTimeout(timer);
    timer = setTimeout(push, delay);
}

async function pull() {
    try {
        const data = await dataApi('/api/sync');
        const cloud = data?.settings || {};
        const cloudAt = Number(data?.settingsUpdatedAt) || 0;
        const localAt = Number(localStorage.getItem(SYNCED_AT_KEY)) || 0;

        if (Object.keys(cloud).length === 0) {
            await push(); // conta nova: leva as configurações deste aparelho
            return;
        }
        if (cloudAt <= localAt) return; // este aparelho já está atualizado

        let changed = false;
        applying = true;
        for (const [key, value] of Object.entries(cloud)) {
            if (isSyncKey(key) && localStorage.getItem(key) !== value) {
                localStorage.setItem(key, value);
                changed = true;
            }
        }
        localStorage.setItem(SYNCED_AT_KEY, String(cloudAt));
        applying = false;
        if (changed) window.location.reload(); // aplica tema, fonte etc.
    } catch (err) {
        applying = false;
        console.warn('[SettingsSync] falha ao baixar:', err.message);
    }
}

export function initSettingsSync() {
    // Observa mudanças nas chaves sincronizadas (o evento "storage" não dispara na mesma aba)
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
        originalSetItem.call(this, key, value);
        if (this === window.localStorage && isSyncKey(key)) schedulePush(key === 'monochrome-listening-data' ? 30000 : 8000);
    };

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && timer) {
            clearTimeout(timer);
            void push();
        }
    });

    authManager.onAuthStateChanged((user) => {
        if (user) void pull();
    });
}
