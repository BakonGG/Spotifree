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
