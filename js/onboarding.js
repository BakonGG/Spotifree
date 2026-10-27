// js/onboarding.js
// Onboarding wizard for first-time visitors to choose their favorite genres and artists in Spotyfree.

export const GENRES_DATA = [
    {
        id: 'trap-rap',
        name: 'Trap / Rap',
        icon: '🔥',
        artists: ['Matuê', 'Veigh', 'KayBlack', 'Teto', 'WIU', 'Filipe Ret', 'L7NNON', 'Orochi', 'MC Cabelinho'],
    },
    {
        id: 'funk',
        name: 'Funk',
        icon: '🔊',
        artists: ['MC Ryan SP', 'MC Hariel', 'MC IG', 'Anitta', 'Pedro Sampaio', 'Ludmilla', 'DJ Arana', 'MC Daniel'],
    },
    {
        id: 'sertanejo',
        name: 'Sertanejo',
        icon: '🤠',
        artists: ['Gusttavo Lima', 'Henrique & Juliano', 'Jorge & Mateus', 'Ana Castela', 'Luan Santana', 'Marília Mendonça', 'Zé Neto & Cristiano'],
    },
    {
        id: 'pagode-samba',
        name: 'Pagode & Samba',
        icon: '🥁',
        artists: ['Menos é Mais', 'Sorriso Maroto', 'Ferrugem', 'Dilsinho', 'Thiaguinho', 'Belo', 'Turma do Pagode'],
    },
    {
        id: 'pop-br',
        name: 'Pop Nacional',
        icon: '✨',
        artists: ['Luísa Sonza', 'Jão', 'Pabllo Vittar', 'Gloria Groove', 'Marina Sena', 'Iza'],
    },
    {
        id: 'pop-int',
        name: 'Pop Internacional',
        icon: '🌟',
        artists: ['Taylor Swift', 'The Weeknd', 'Bruno Mars', 'Billie Eilish', 'Dua Lipa', 'Ariana Grande', 'Post Malone'],
    },
    {
        id: 'rock',
        name: 'Rock & Alternativo',
        icon: '🎸',
        artists: ['Charlie Brown Jr.', 'CPM 22', 'Legião Urbana', 'Linkin Park', 'Queen', 'Arctic Monkeys', 'Imagine Dragons'],
    },
    {
        id: 'mpb',
        name: 'MPB',
        icon: '☕',
        artists: ['Djavan', 'Caetano Veloso', 'Gilberto Gil', 'Tim Maia', 'Liniker', 'Seu Jorge', 'Chico Buarque'],
    },
    {
        id: 'forro-piseiro',
        name: 'Forró & Piseiro',
        icon: '🪗',
        artists: ['João Gomes', 'Nattan', 'Mari Fernandez', 'Zé Vaqueiro', 'Tarcísio do Acordeon', 'Iguinho e Lulinha'],
    },
    {
        id: 'eletronica',
        name: 'Eletrônica',
        icon: '⚡',
        artists: ['Alok', 'Vintage Culture', 'KVSH', 'Dubdogz', 'David Guetta', 'Tiësto'],
    },
    {
        id: 'gospel',
        name: 'Gospel',
        icon: '🙏',
        artists: ['Gabriela Rocha', 'Fernandinho', 'Isadora Pompeo', 'Aline Barros', 'Morada'],
    },
];

export function getUserPreferences() {
    try {
        const genres = JSON.parse(localStorage.getItem('spotifree_user_genres') || '[]');
        const artists = JSON.parse(localStorage.getItem('spotifree_user_artists') || '[]');
        return { genres, artists };
    } catch {
        return { genres: [], artists: [] };
    }
}

export function isOnboardingCompleted() {
    return localStorage.getItem('spotifree_onboarding_done') === 'true';
}

/**
 * Open the onboarding / preference customization modal.
 * @param {boolean} isInitial  True if automatically displayed on first visit
 */
export function openOnboardingModal(isInitial = false) {
    // Remove any existing modal
    const existing = document.getElementById('spotifree-onboarding-modal');
    if (existing) existing.remove();

    const { genres: savedGenres, artists: savedArtists } = getUserPreferences();
    let selectedGenres = new Set(savedGenres.length > 0 ? savedGenres : ['trap-rap', 'funk', 'sertanejo']);
    let selectedArtists = new Set(savedArtists.length > 0 ? savedArtists : ['Matuê', 'Veigh', 'Henrique & Juliano', 'MC Ryan SP']);

    const modal = document.createElement('div');
    modal.id = 'spotifree-onboarding-modal';
    modal.className = 'modal active';
    modal.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: 100000;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.85);
        backdrop-filter: blur(8px);
        padding: 1rem;
        animation: fadeIn 0.3s ease;
    `;

    const content = document.createElement('div');
    content.className = 'onboarding-content';
    content.style.cssText = `
        background: var(--background, #121212);
        border: 1px solid var(--border, rgba(255, 255, 255, 0.15));
        border-radius: 16px;
        width: 100%;
        max-width: 680px;
        max-height: 90vh;
        overflow-y: auto;
        padding: 2rem;
        box-shadow: 0 20px 40px rgba(0,0,0,0.6);
        color: var(--foreground, #fff);
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
    `;

    function renderModalBody() {
        // Collect artists from currently selected genres
        const artistsPool = new Set();
        GENRES_DATA.forEach((g) => {
            if (selectedGenres.has(g.id)) {
                g.artists.forEach((a) => artistsPool.add(a));
            }
        });
        // Also ensure currently selected artists are visible
        selectedArtists.forEach((a) => artistsPool.add(a));

        content.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border, rgba(255,255,255,0.1)); padding-bottom: 1rem;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <img src="/assets/icone.png" style="width: 36px; height: 36px; border-radius: 8px; object-fit: contain;" alt="Spotyfree Logo" />
                    <div>
                        <h2 style="margin: 0; font-size: 1.4rem; font-weight: 700;">${isInitial ? 'Bem-vindo ao Spotyfree! 🎵' : 'Personalizar Meus Gostos 🎵'}</h2>
                        <p style="margin: 4px 0 0; color: var(--muted-foreground, #aaa); font-size: 0.9rem;">Escolha seus gêneros e artistas favoritos para recomendarmos o que você mais ama.</p>
                    </div>
                </div>
                ${!isInitial ? '<button id="close-onboarding-btn" style="background:none; border:none; color:inherit; font-size:1.8rem; cursor:pointer; padding:0 8px;">&times;</button>' : ''}
            </div>

            <div>
                <h3 style="margin: 0 0 0.8rem; font-size: 1.05rem; font-weight: 600; display: flex; align-items: center; gap: 8px;">
                    <span>1. Estilos musicais favoritos:</span>
                    <span style="font-size: 0.8rem; color: var(--muted-foreground, #aaa); font-weight: normal;">(clique para selecionar)</span>
                </h3>
                <div id="onboarding-genres-grid" style="display: flex; flex-wrap: wrap; gap: 8px;">
                    ${GENRES_DATA.map((genre) => {
                        const isSelected = selectedGenres.has(genre.id);
                        return `
                            <button type="button" class="genre-chip" data-genre-id="${genre.id}" style="
                                background: ${isSelected ? 'var(--primary, #1ed760)' : 'var(--card, rgba(255,255,255,0.06))'};
                                color: ${isSelected ? '#000' : 'var(--foreground, #fff)'};
                                border: 1px solid ${isSelected ? 'var(--primary, #1ed760)' : 'var(--border, rgba(255,255,255,0.12))'};
                                border-radius: 20px;
                                padding: 8px 16px;
                                font-size: 0.9rem;
                                font-weight: 600;
                                cursor: pointer;
                                display: flex;
                                align-items: center;
                                gap: 6px;
                                transition: all 0.2s ease;
                            ">
                                <span>${genre.icon}</span>
                                <span>${genre.name}</span>
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>

            <div>
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.8rem;">
                    <h3 style="margin: 0; font-size: 1.05rem; font-weight: 600;">2. Seus artistas favoritos:</h3>
                    <button type="button" id="toggle-all-artists-btn" style="background: none; border: none; color: var(--primary, #1ed760); font-size: 0.85rem; font-weight: 600; cursor: pointer;">
                        Selecionar Todos
                    </button>
                </div>
                <div id="onboarding-artists-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px; max-height: 220px; overflow-y: auto; padding-right: 4px;">
                    ${Array.from(artistsPool).map((artistName) => {
                        const isSelected = selectedArtists.has(artistName);
                        return `
                            <button type="button" class="artist-chip" data-artist-name="${artistName}" style="
                                background: ${isSelected ? 'rgba(30, 215, 96, 0.15)' : 'var(--card, rgba(255,255,255,0.04))'};
                                border: 1px solid ${isSelected ? 'var(--primary, #1ed760)' : 'var(--border, rgba(255,255,255,0.1))'};
                                color: var(--foreground, #fff);
                                border-radius: 12px;
                                padding: 10px 8px;
                                font-size: 0.88rem;
                                font-weight: 500;
                                cursor: pointer;
                                text-align: center;
                                transition: all 0.2s ease;
                                display: flex;
                                flex-direction: column;
                                align-items: center;
                                gap: 6px;
                            ">
                                <span style="
                                    display: inline-block;
                                    width: 32px;
                                    height: 32px;
                                    border-radius: 50%;
                                    background: ${isSelected ? 'var(--primary, #1ed760)' : 'rgba(255,255,255,0.1)'};
                                    color: ${isSelected ? '#000' : '#fff'};
                                    line-height: 32px;
                                    font-weight: 700;
                                    font-size: 0.85rem;
                                ">${isSelected ? '✓' : artistName.charAt(0)}</span>
                                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%;">${artistName}</span>
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>

            <div style="border-top: 1px solid var(--border, rgba(255,255,255,0.1)); padding-top: 1.2rem; display: flex; justify-content: flex-end; gap: 12px;">
                <button type="button" id="save-onboarding-btn" style="
                    background: var(--primary, #1ed760);
                    color: #000;
                    border: none;
                    border-radius: 24px;
                    padding: 12px 28px;
                    font-size: 1rem;
                    font-weight: 700;
                    cursor: pointer;
                    box-shadow: 0 4px 14px rgba(30, 215, 96, 0.4);
                    transition: transform 0.2s ease;
                ">
                    Concluir e Começar a Ouvir 🎧
                </button>
            </div>
        `;

        // Event listeners
        const closeBtn = content.querySelector('#close-onboarding-btn');
        if (closeBtn) {
            closeBtn.onclick = () => modal.remove();
        }

        content.querySelectorAll('.genre-chip').forEach((btn) => {
            btn.onclick = () => {
                const gid = btn.dataset.genreId;
                if (selectedGenres.has(gid)) {
                    if (selectedGenres.size > 1) selectedGenres.delete(gid);
                } else {
                    selectedGenres.add(gid);
                }
                renderModalBody();
            };
        });

        content.querySelectorAll('.artist-chip').forEach((btn) => {
            btn.onclick = () => {
                const aname = btn.dataset.artistName;
                if (selectedArtists.has(aname)) {
                    selectedArtists.delete(aname);
                } else {
                    selectedArtists.add(aname);
                }
                renderModalBody();
            };
        });

        const toggleAllBtn = content.querySelector('#toggle-all-artists-btn');
        if (toggleAllBtn) {
            toggleAllBtn.onclick = () => {
                const currentPool = [];
                GENRES_DATA.forEach((g) => {
                    if (selectedGenres.has(g.id)) currentPool.push(...g.artists);
                });
                const allSelected = currentPool.every((a) => selectedArtists.has(a));
                if (allSelected) {
                    currentPool.forEach((a) => selectedArtists.delete(a));
                } else {
                    currentPool.forEach((a) => selectedArtists.add(a));
                }
                renderModalBody();
            };
        }

        const saveBtn = content.querySelector('#save-onboarding-btn');
        if (saveBtn) {
            saveBtn.onclick = async () => {
                saveBtn.disabled = true;
                saveBtn.textContent = 'Carregando suas músicas...';

                // Save to localStorage
                localStorage.setItem('spotifree_user_genres', JSON.stringify(Array.from(selectedGenres)));
                localStorage.setItem('spotifree_user_artists', JSON.stringify(Array.from(selectedArtists)));
                localStorage.setItem('spotifree_onboarding_done', 'true');

                // Animate out
                modal.remove();

                // Trigger preferences updated event
                window.dispatchEvent(new CustomEvent('spotifree-preferences-updated', {
                    detail: {
                        genres: Array.from(selectedGenres),
                        artists: Array.from(selectedArtists),
                    },
                }));

                // Refresh Home recommendations
                try {
                    const { UIRenderer } = await import('./ui.js');
                    if (UIRenderer.instance) {
                        await UIRenderer.instance.renderHomePage(true);
                    }
                } catch (e) {
                    console.warn('Failed to refresh home page after onboarding:', e);
                }
            };
        }
    }

    renderModalBody();
    modal.appendChild(content);
    document.body.appendChild(modal);
}
