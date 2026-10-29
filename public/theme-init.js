// Nunca fica em /index.html: volta para o endereço normal (sem recarregar a página)
try {
    if (/\/index\.html$/.test(location.pathname)) {
        history.replaceState(null, '', location.pathname.replace(/index\.html$/, '') + location.search + location.hash);
    }
} catch (_e) {
    // sem history API: segue com o endereço atual
}

(() => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!window.__swReloading) {
                window.__swReloading = true;
                window.location.reload();
            }
        });
    }
    try {
        if (localStorage.getItem('disable-blur-effects') === 'true') {
            document.documentElement.classList.add('disable-blur-effects');
        }

        const theme = localStorage.getItem('spotyfree-theme');
        const css = localStorage.getItem('custom_theme_css');
        const palette = localStorage.getItem('spotyfree-custom-theme');
        if (!theme) return;

        document.documentElement.setAttribute('data-theme', theme);

        if (theme === 'custom') {
            if (css) {
                let styleEl = document.getElementById('custom-theme-style');
                if (!styleEl) {
                    styleEl = document.createElement('style');
                    styleEl.id = 'custom-theme-style';
                    document.head.appendChild(styleEl);
                }
                styleEl.textContent = css;
            } else if (palette) {
                const colors = JSON.parse(palette);
                const root = document.documentElement;
                for (const [key, value] of Object.entries(colors)) {
                    root.style.setProperty(`--${key}`, value);
                }
            }
        }
    } catch (e) {
        console.error('theme loading failed', e);
    }
})();

// ---------------------------------------------------------------------------
// Tela de carregamento: some só quando tudo estiver pronto (página, fontes e conteúdo inicial)
// ---------------------------------------------------------------------------
(() => {
    document.documentElement.classList.add('splash-active');
    const startedAt = Date.now();
    const MIN_MS = 1400; // tempo mínimo para a animação ser vista
    const MAX_MS = 12000; // nunca prende o usuário
    const tips = [
        'Preparando sua música...',
        'Afinando os instrumentos...',
        'Buscando suas recomendações...',
        'Quase lá...',
    ];
    let tipIndex = 0;
    let hidden = false;
    let fontsReady = false;

    try {
        document.fonts?.ready.then(() => {
            fontsReady = true;
        });
    } catch {
        fontsReady = true;
    }
    if (!document.fonts) fontsReady = true;

    function hide() {
        if (hidden) return;
        hidden = true;
        const el = document.getElementById('splash');
        document.documentElement.classList.remove('splash-active');
        if (!el) return;
        el.classList.add('splash-hide');
        setTimeout(() => el.remove(), 700);
    }

    // O conteúdo inicial está pronto quando a página ativa já mostra algo (cartões, faixas, mensagem vazia)
    // ou quando o assistente de gostos musicais abriu.
    function contentReady() {
        if (document.getElementById('spotifree-onboarding-modal')) return true;
        const page = document.querySelector('.page.active');
        if (!page) return false;
        if (page.id !== 'page-home') return true;
        const view = page.querySelector('.home-view.active') || page;
        if (view.querySelector('.track-item, .card')) return true;
        return /Nenhum|nenhum|No .* found/.test(view.textContent || '');
    }

    function tick() {
        if (hidden) return;
        const elapsed = Date.now() - startedAt;
        if (elapsed > MAX_MS) return hide();
        const loaded = document.readyState === 'complete';
        if (loaded && fontsReady && elapsed >= MIN_MS && contentReady()) return hide();
        setTimeout(tick, 150);
    }

    const tipTimer = setInterval(() => {
        if (hidden) return clearInterval(tipTimer);
        const tip = document.getElementById('splash-tip');
        if (!tip) return;
        tipIndex = (tipIndex + 1) % tips.length;
        tip.style.opacity = '0';
        setTimeout(() => {
            tip.textContent = tips[tipIndex];
            tip.style.opacity = '1';
        }, 250);
    }, 1800);

    tick();
})();

// Rede de segurança: se depois de 25 s nenhuma página apareceu (cache antigo do app depois de uma atualização),
// limpa o service worker e o cache e recarrega uma única vez.
setTimeout(() => {
    try {
        const visible = [...document.querySelectorAll('.page')].some((p) => getComputedStyle(p).display !== 'none');
        if (visible || sessionStorage.getItem('sw_reset_done')) return;
        sessionStorage.setItem('sw_reset_done', '1');
        (async () => {
            for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
            for (const key of await caches.keys()) await caches.delete(key);
            location.reload();
        })().catch(() => {});
    } catch (_e) {
        // sem service worker/cache: nada a fazer
    }
}, 25000);
