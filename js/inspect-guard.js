// js/inspect-guard.js
// Desestímulo ao "modo inspecionar": ao detectar atalho do inspetor ou o inspetor aberto, leva a pessoa
// para /aqui-não-rapaz (tela cheia com um vídeo e, depois de 15 s, uma mensagem com o botão "Voltar").
// ATENÇÃO: nenhuma proteção feita no navegador é infalível (menus do navegador, JavaScript desligado, ver o
// código-fonte por outros meios). Isto serve só para espantar curiosos.
const GUARD_PATH = '/aqui-não-rapaz';
const VIDEO_ID = 'dQw4w9WgXcQ';
const MESSAGE_AFTER_MS = 15000;
const COOLDOWN_MS = 10000;

const isDevHost = ['localhost', '127.0.0.1'].includes(location.hostname);
const isGuardPath = () => decodeURIComponent(location.pathname).replace(/\/+$/, '') === GUARD_PATH;

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
        `&loop=1&playlist=${VIDEO_ID}&cc_load_policy=0`;
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

// Com o inspetor aberto, a instrução "debugger" pausa a página; o atraso entre antes e depois entrega.
function debuggerProbe() {
    if (active || isDevHost || document.hidden) return;
    const start = performance.now();
    debugger; // eslint-disable-line no-debugger
    if (performance.now() - start > 150) trigger();
}

export function initInspectGuard() {
    if (isDevHost) return;
    window.addEventListener('keydown', onKeyDown, true);
    setInterval(debuggerProbe, 1500);

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
