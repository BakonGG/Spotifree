// js/inspect-guard.js
// Desestímulo ao "modo inspecionar": ao detectar atalho do inspetor ou o inspetor aberto, leva a pessoa
// para /aqui-não-rapaz (tela cheia com um vídeo e, depois de 15 s, uma mensagem com o botão "Voltar").
// ATENÇÃO: nenhuma proteção feita no navegador é infalível (menus do navegador, JavaScript desligado, ver o
// código-fonte por outros meios). Isto serve só para espantar curiosos.
const GUARD_PATH = '/aqui-não-rapaz';
const YT_ORIGIN = 'https://www.youtube-nocookie.com';
const VIDEO_ID = 'dQw4w9WgXcQ';
const MESSAGE_AFTER_MS = 15000;
const COOLDOWN_MS = 10000;

const isDevHost = ['localhost', '127.0.0.1'].includes(location.hostname);
const isGuardPath = () => {
    let path = location.pathname;
    try {
        path = decodeURIComponent(path);
    } catch {
        // endereço malformado: compara como está
    }
    return path.replace(/\/{2,}/g, '/').replace(/\/+$/, '').normalize('NFC') === GUARD_PATH.normalize('NFC');
};

let overlay = null;
let active = false;
let pushed = false;
let returnTo = '/';
let cooldownUntil = 0;
let messageTimer = null;

function buildOverlay() {
    const el = document.createElement('div');
    el.id = 'guard-overlay';
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-label', 'Modo inspecionar não é permitido');

    // Só o vídeo: sem controles, sem teclado, sem fullscreen do player. O iframe é maior que a tela para que
    // a faixa de título (em cima) e a de controles (embaixo) do player fiquem fora da área visível.
    const src =
        `https://www.youtube-nocookie.com/embed/${VIDEO_ID}` +
        '?autoplay=1&controls=0&disablekb=1&fs=0&modestbranding=1&rel=0&iv_load_policy=3&playsinline=1' +
        `&loop=1&playlist=${VIDEO_ID}&cc_load_policy=0&mute=1&enablejsapi=1`;
    el.innerHTML = `
        <div class="guard-video">
            <iframe class="guard-frame" src="${src}" title="" tabindex="-1"
                allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin"></iframe>
        </div>
        <div class="guard-shield"></div>
        <div class="guard-message" hidden>
            <div class="guard-card">
                <p class="guard-text">Modo inspecionar não é permitido, está querendo fazer o que? Babaca.</p>
                <button type="button" class="guard-back">Voltar</button>
            </div>
        </div>`;
    // Nada de clique, menu ou teclado chegando ao vídeo
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('keydown', (e) => e.preventDefault(), true);
    el.querySelector('.guard-back').addEventListener('click', () => leave(false));

    // Começa mudo (o navegador sempre deixa tocar sozinho) e liga o som assim que possível: logo após carregar
    // (funciona quando a pessoa acabou de apertar uma tecla) e no primeiro toque/clique/tecla.
    const frame = el.querySelector('iframe');
    const command = (func) =>
        frame.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: [] }), YT_ORIGIN);
    const play = () => {
        command('playVideo');
        command('unMute');
    };
    // Insiste no play até o player avisar que está tocando (o celular às vezes ignora as primeiras tentativas)
    let retry = null;
    const onPlayerMessage = (e) => {
        if (e.origin !== YT_ORIGIN || e.source !== frame.contentWindow) return;
        let data = e.data;
        try {
            if (typeof data === 'string') data = JSON.parse(data);
        } catch {
            return;
        }
        const state = data?.info?.playerState ?? (data?.event === 'onStateChange' ? data.info : undefined);
        if (state === 1) {
            clearInterval(retry);
            command('unMute');
        }
    };
    window.addEventListener('message', onPlayerMessage);
    el.addEventListener('guard-cleanup', () => {
        clearInterval(retry);
        window.removeEventListener('message', onPlayerMessage);
    });
    frame.addEventListener('load', () => {
        frame.contentWindow?.postMessage(JSON.stringify({ event: 'listening' }), YT_ORIGIN);
        play();
        let tries = 0;
        retry = setInterval(() => {
            play();
            if (++tries > 40) clearInterval(retry);
        }, 600);
    });
    ['pointerdown', 'touchstart', 'keydown'].forEach((type) => el.addEventListener(type, play, { capture: true }));
    return el;
}

function show(push) {
    active = true;
    // Pausa a música do app para o vídeo ser ouvido
    document.getElementById('audio-player')?.pause();
    document.getElementById('video-player')?.pause();

    if (push && !isGuardPath()) {
        history.pushState({ guard: true }, '', GUARD_PATH);
        pushed = true;
    }
    overlay = buildOverlay();
    document.body.appendChild(overlay);
    document.documentElement.classList.add('guard-active');

    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => {
        const message = overlay?.querySelector('.guard-message');
        if (message) {
            message.hidden = false;
            overlay.querySelector('.guard-back')?.focus();
        }
    }, MESSAGE_AFTER_MS);
}

function leave(fromPopState) {
    if (!active) return;
    active = false;
    clearTimeout(messageTimer);
    overlay?.dispatchEvent(new Event('guard-cleanup'));
    // Remover o iframe do DOM é o que para o vídeo
    overlay?.querySelector('iframe')?.setAttribute('src', 'about:blank');
    overlay?.remove();
    overlay = null;
    document.documentElement.classList.remove('guard-active');
    cooldownUntil = Date.now() + COOLDOWN_MS;

    if (!fromPopState) {
        if (pushed) {
            history.back(); // dispara popstate e o roteador volta à tela anterior
        } else {
            history.replaceState(null, '', returnTo || '/');
            window.dispatchEvent(new PopStateEvent('popstate'));
        }
    }
    pushed = false;
}

function trigger() {
    if (active || isDevHost || Date.now() < cooldownUntil) return;
    returnTo = isGuardPath() ? '/' : `${location.pathname}${location.search}${location.hash}`;
    show(true);
}

// ─── Detecção ──────────────────────────────────────────────────────────────
function onKeyDown(e) {
    if (isDevHost) return;
    const k = (e.key || '').toLowerCase();
    const inspector =
        e.key === 'F12' ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j', 'c'].includes(k)) ||
        (e.metaKey && e.altKey && ['i', 'j', 'c', 'u'].includes(k)) ||
        ((e.ctrlKey || e.metaKey) && !e.shiftKey && k === 'u');
    if (inspector) {
        e.preventDefault();
        e.stopPropagation();
        trigger();
    }
}

// Detecta o inspetor sem usar "debugger" (que deixava a página travada no modo debugger):
//  1) inspetor encaixado na janela (no computador): a janela por fora fica bem maior que a área da página;
//  2) o console aberto lê propriedades de objetos que ele mostra: uma "armadilha" avisa quando isso acontece.
let consoleOpen = false;
const trap = new Image();
Object.defineProperty(trap, 'id', {
    get() {
        consoleOpen = true;
        return '';
    },
});

function devtoolsProbe() {
    if (active || isDevHost || document.hidden) return;
    const desktop = window.innerWidth >= 900 && !('ontouchstart' in window && navigator.maxTouchPoints > 0);
    const docked =
        desktop && (window.outerWidth - window.innerWidth > 200 || window.outerHeight - window.innerHeight > 300);
    consoleOpen = false;
    console.debug(trap);
    if (docked || consoleOpen) trigger();
}

// O menu do botão direito do navegador (com "Inspecionar") fica bloqueado. Os menus do próprio app (opções
// da música: curtir, fila, baixar...) continuam funcionando, porque o evento segue para o código deles.
function onContextMenu(e) {
    if (isDevHost || active) return;
    const field = e.target?.closest?.('input, textarea, [contenteditable="true"]');
    if (field) return; // colar/copiar em campos de texto continua permitido
    e.preventDefault();
}

export function initInspectGuard() {
    if (isDevHost) return;
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('contextmenu', onContextMenu, true);
    setInterval(devtoolsProbe, 1000);

    window.addEventListener('popstate', () => {
        if (active && !isGuardPath()) leave(true);
        else if (!active && isGuardPath()) {
            returnTo = '/';
            show(false);
        }
    });

    // Abriram o endereço direto (ou deram F5 na página do aviso)
    if (isGuardPath()) {
        returnTo = '/';
        show(false);
    }
}
