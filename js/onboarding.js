// js/onboarding.js
// Assistente de gostos musicais (primeira visita): passo 1 = gêneros, passo 2 = artistas (com foto).
import { searchSpotify } from './spotify-api.js';

export const GENRES_DATA = [
    {
        id: 'trap-rap',
        name: 'Trap / Rap',
        icon: '🔥',
        artists: ['Matuê', 'Veigh', 'KayBlack', 'Teto', 'WIU', 'Filipe Ret', 'L7NNON', 'Orochi', 'MC Cabelinho', 'Djonga', 'Racionais MC\'s', 'Emicida', 'Baco Exu do Blues', 'Travis Scott'],
    },
    {
        id: 'funk',
        name: 'Funk',
        icon: '🔊',
        artists: ['MC Ryan SP', 'MC Hariel', 'MC IG', 'Anitta', 'Pedro Sampaio', 'Ludmilla', 'DJ Arana', 'MC Daniel', 'MC Kevin o Chris', 'MC Livinho', 'MC Poze do Rodo', 'Kevinho', 'Dennis DJ'],
    },
    {
        id: 'sertanejo',
        name: 'Sertanejo',
        icon: '🤠',
        artists: ['Gusttavo Lima', 'Henrique & Juliano', 'Jorge & Mateus', 'Ana Castela', 'Luan Santana', 'Marília Mendonça', 'Zé Neto & Cristiano', 'Maiara & Maraisa', 'Simone Mendes', 'Bruno & Marrone', 'Chitãozinho & Xororó', 'Leonardo', 'Murilo Huff'],
    },
    {
        id: 'pagode-samba',
        name: 'Pagode & Samba',
        icon: '🥁',
        artists: ['Menos é Mais', 'Sorriso Maroto', 'Ferrugem', 'Dilsinho', 'Thiaguinho', 'Belo', 'Turma do Pagode', 'Péricles', 'Grupo Revelação', 'Exaltasamba', 'Zeca Pagodinho', 'Jorge Aragão', 'Alexandre Pires'],
    },
    {
        id: 'pop-br',
        name: 'Pop Nacional',
        icon: '✨',
        artists: ['Luísa Sonza', 'Jão', 'Pabllo Vittar', 'Gloria Groove', 'Marina Sena', 'Iza', 'Anavitória', 'Lagum', 'Vitor Kley', 'Silva', 'Ivete Sangalo', 'Claudia Leitte'],
    },
    {
        id: 'pop-int',
        name: 'Pop Internacional',
        icon: '🌟',
        artists: ['Taylor Swift', 'The Weeknd', 'Bruno Mars', 'Billie Eilish', 'Dua Lipa', 'Ariana Grande', 'Post Malone', 'Ed Sheeran', 'Rihanna', 'Justin Bieber', 'Harry Styles', 'Olivia Rodrigo', 'Sabrina Carpenter'],
    },
    {
        id: 'rock',
        name: 'Rock & Alternativo',
        icon: '🎸',
        artists: ['Charlie Brown Jr.', 'CPM 22', 'Legião Urbana', 'Linkin Park', 'Queen', 'Arctic Monkeys', 'Imagine Dragons', 'Pitty', 'Skank', 'Capital Inicial', 'O Rappa', 'Nirvana', 'Coldplay'],
    },
    {
        id: 'mpb',
        name: 'MPB',
        icon: '☕',
        artists: ['Djavan', 'Caetano Veloso', 'Gilberto Gil', 'Tim Maia', 'Liniker', 'Seu Jorge', 'Chico Buarque', 'Gal Costa', 'Maria Bethânia', 'Milton Nascimento', 'Elis Regina', 'Jorge Ben Jor'],
    },
    {
        id: 'forro-piseiro',
        name: 'Forró & Piseiro',
        icon: '🪗',
        artists: ['João Gomes', 'Nattan', 'Mari Fernandez', 'Zé Vaqueiro', 'Tarcísio do Acordeon', 'Iguinho e Lulinha', 'Xand Avião', 'Wesley Safadão', 'Vitor Fernandes', 'Os Barões da Pisadinha', 'Calcinha Preta', 'Luiz Gonzaga'],
    },
    {
        id: 'eletronica',
        name: 'Eletrônica',
        icon: '⚡',
        artists: ['Alok', 'Vintage Culture', 'KVSH', 'Dubdogz', 'David Guetta', 'Tiësto', 'Calvin Harris', 'Martin Garrix', 'Avicii', 'Marshmello', 'Zerb', 'Illenium'],
    },
    {
        id: 'gospel',
        name: 'Gospel',
        icon: '🙏',
        artists: ['Gabriela Rocha', 'Fernandinho', 'Isadora Pompeo', 'Aline Barros', 'Morada', 'Thalles Roberto', 'Julliany Souza', 'Anderson Freire', 'Eli Soares', 'Davi Sacer', 'Bruna Karla', 'Ministério Zoe'],
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

// ─── Fotos dos artistas ────────────────────────────────────────────────────
// Só guardamos fotos encontradas; falhas e "sem foto" não ficam no cache e podem ser tentadas de novo.
const IMAGES_KEY = 'spotifree_artist_images_v2';
const artistImages = (() => {
    try {
        return JSON.parse(localStorage.getItem(IMAGES_KEY) || '{}');
    } catch {
        return {};
    }
})();
const inFlight = new Map();

const normalizeName = (s) =>
    String(s)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

const escapeAttr = (v) =>
    String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Busca a foto do artista no Spotify (preferindo o nome idêntico). Devolve '' se não houver foto. */
function resolveArtistPhoto(name) {
    if (artistImages[name]) return Promise.resolve(artistImages[name]);
    if (inFlight.has(name)) return inFlight.get(name);
    const promise = (async () => {
        try {
            const result = await searchSpotify(name, { limit: 5, types: ['artist'] });
            const wanted = normalizeName(name);
            const withPhoto = (result.artists || []).filter((a) => a.picture);
            const best = withPhoto.find((a) => normalizeName(a.name) === wanted) || null;
            if (best) {
                artistImages[name] = best.picture;
                try {
                    localStorage.setItem(IMAGES_KEY, JSON.stringify(artistImages));
                } catch {
                    // sem espaço no localStorage: segue sem cache
                }
                return best.picture;
            }
        } catch {
            // falha de rede: tenta de novo na próxima vez
        } finally {
            inFlight.delete(name);
        }
        return '';
    })();
    inFlight.set(name, promise);
    return promise;
}

/**
 * Abre o assistente de gostos.
 * @param {boolean} isInitial true na primeira visita (não pode ser fechado sem concluir)
 */
export function openOnboardingModal(isInitial = false) {
    document.getElementById('spotifree-onboarding-modal')?.remove();

    const saved = getUserPreferences();
    const selectedGenres = new Set(saved.genres);
    const selectedArtists = new Set(saved.artists);
    const extraArtists = new Map(); // artistas achados na busca: nome -> foto
    let step = 1;
    let loadToken = 0;

    const modal = document.createElement('div');
    modal.id = 'spotifree-onboarding-modal';
    modal.className = 'modal active ob-modal';

    const content = document.createElement('div');
    content.className = 'ob-content';
    modal.appendChild(content);

    const closeBtnHTML = !isInitial ? '<button id="ob-close" class="ob-close" aria-label="Fechar">&times;</button>' : '';

    function headerHTML(title, subtitle) {
        return `
            <div class="ob-header">
                <div class="ob-header-main">
                    <img src="/assets/icone.png" class="ob-logo" alt="" width="44" height="44" />
                    <div>
                        <h2 class="ob-title">${title}</h2>
                        <p class="ob-subtitle">${subtitle}</p>
                    </div>
                </div>
                ${closeBtnHTML}
            </div>
            <div class="ob-steps" aria-hidden="true">
                <span class="ob-dot ${step === 1 ? 'active' : 'done'}"></span>
                <span class="ob-dot ${step === 2 ? 'active' : ''}"></span>
                <span class="ob-steps-label">Passo ${step} de 2</span>
            </div>`;
    }

    function bindClose() {
        content.querySelector('#ob-close')?.addEventListener('click', () => modal.remove());
    }

    // ── Passo 1: gêneros ──────────────────────────────────────────────────
    function renderGenres() {
        step = 1;
        loadToken++;
        content.innerHTML = `
            ${headerHTML(
                isInitial ? 'Bem-vindo ao Spotyfree! 🎵' : 'Personalizar meus gostos 🎵',
                'Escolha os estilos que você mais curte. É rapidinho!'
            )}
            <div class="ob-body">
                <div class="ob-genres">
                    ${GENRES_DATA.map(
                        (g) => `
                        <button type="button" class="ob-genre ${selectedGenres.has(g.id) ? 'selected' : ''}" data-genre-id="${g.id}">
                            <span class="ob-genre-icon">${g.icon}</span>
                            <span class="ob-genre-name">${g.name}</span>
                            <span class="ob-genre-check">✓</span>
                        </button>`
                    ).join('')}
                </div>
            </div>
            <div class="ob-footer">
                <span class="ob-hint" id="ob-hint"></span>
                <button type="button" id="ob-next" class="ob-primary">Avançar →</button>
            </div>`;
        bindClose();

        const nextBtn = content.querySelector('#ob-next');
        const hint = content.querySelector('#ob-hint');
        const refresh = () => {
            const n = selectedGenres.size;
            nextBtn.disabled = n === 0;
            hint.textContent = n === 0 ? 'Escolha pelo menos um estilo' : `${n} ${n === 1 ? 'estilo escolhido' : 'estilos escolhidos'}`;
        };
        refresh();

        content.querySelectorAll('.ob-genre').forEach((btn) => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.genreId;
                if (selectedGenres.has(id)) selectedGenres.delete(id);
                else selectedGenres.add(id);
                btn.classList.toggle('selected', selectedGenres.has(id));
                refresh();
            });
        });
        nextBtn.addEventListener('click', () => {
            if (selectedGenres.size > 0) renderArtists();
        });
    }

    // ── Passo 2: artistas ─────────────────────────────────────────────────
    function chipHTML(name, photo) {
        const sel = selectedArtists.has(name);
        return `
            <button type="button" class="ob-artist ${sel ? 'selected' : ''}" data-artist-name="${escapeAttr(name)}">
                <span class="ob-avatar">
                    <img src="${escapeAttr(photo)}" alt="" loading="lazy" referrerpolicy="no-referrer" />
                    <span class="ob-avatar-check">✓</span>
                </span>
                <span class="ob-artist-name">${escapeAttr(name)}</span>
            </button>`;
    }

    function renderArtists() {
        step = 2;
        const token = ++loadToken;
        content.innerHTML = `
            ${headerHTML('Agora, seus artistas favoritos 🎤', 'Toque nos artistas que você gosta. Quanto mais, melhor a sua seleção.')}
            <div class="ob-body">
                <div class="ob-toolbar">
                    <input type="search" id="ob-search" class="ob-search" placeholder="Buscar outro artista..." autocomplete="off" />
                    <button type="button" id="ob-all" class="ob-link">Selecionar todos</button>
                </div>
                <div id="ob-search-results" class="ob-artists ob-search-results" hidden></div>
                <div id="ob-artists" class="ob-artists"></div>
                <div id="ob-loading" class="ob-loading"><span class="ob-spinner"></span> Carregando artistas...</div>
            </div>
            <div class="ob-footer">
                <button type="button" id="ob-back" class="ob-secondary">← Voltar</button>
                <span class="ob-hint" id="ob-hint"></span>
                <button type="button" id="ob-done" class="ob-primary">Concluir e começar a ouvir 🎧</button>
            </div>`;
        bindClose();

        const grid = content.querySelector('#ob-artists');
        const loading = content.querySelector('#ob-loading');
        const hint = content.querySelector('#ob-hint');
        const shown = new Set(); // nomes já exibidos no grid principal

        const updateHint = () => {
            const n = selectedArtists.size;
            hint.textContent = n === 0 ? 'Você pode concluir sem escolher' : `${n} ${n === 1 ? 'artista' : 'artistas'}`;
        };
        updateHint();

        // Alterna a seleção sem redesenhar a lista: assim a rolagem não volta ao topo
        const onToggle = (e) => {
            const chip = e.target.closest('.ob-artist');
            if (!chip) return;
            const name = chip.dataset.artistName;
            if (selectedArtists.has(name)) selectedArtists.delete(name);
            else selectedArtists.add(name);
            const on = selectedArtists.has(name);
            // mesmo artista pode aparecer no grid e nos resultados da busca
            content.querySelectorAll('.ob-artist').forEach((c) => {
                if (c.dataset.artistName === name) c.classList.toggle('selected', on);
            });
            updateHint();
        };
        grid.addEventListener('click', onToggle);
        content.querySelector('#ob-search-results').addEventListener('click', onToggle);

        const addChip = (name, photo) => {
            if (shown.has(name)) return;
            shown.add(name);
            grid.insertAdjacentHTML('beforeend', chipHTML(name, photo));
        };

        // Nomes do pool: artistas dos gêneros escolhidos + os que a pessoa já tinha selecionado/buscado
        const pool = [];
        const seen = new Set();
        const push = (name) => {
            const k = normalizeName(name);
            if (!seen.has(k)) {
                seen.add(k);
                pool.push(name);
            }
        };
        GENRES_DATA.filter((g) => selectedGenres.has(g.id)).forEach((g) => g.artists.forEach(push));
        selectedArtists.forEach(push);
        extraArtists.forEach((_, n) => push(n));

        // Busca as fotos (6 por vez) e vai acrescentando os cartões; quem não tem foto não aparece
        let next = 0;
        const worker = async () => {
            while (next < pool.length && token === loadToken) {
                const name = pool[next++];
                const photo = extraArtists.get(name) || (await resolveArtistPhoto(name));
                if (token !== loadToken) return;
                if (photo) addChip(name, photo);
            }
        };
        Promise.all(Array.from({ length: Math.min(6, pool.length) }, worker)).then(() => {
            if (token !== loadToken) return;
            loading.remove();
            if (shown.size === 0) {
                grid.innerHTML = '<p class="ob-empty">Não consegui carregar as fotos agora. Use a busca acima para achar seus artistas.</p>';
            }
        });

        // Selecionar todos / limpar
        content.querySelector('#ob-all').addEventListener('click', (e) => {
            const names = Array.from(grid.querySelectorAll('.ob-artist')).map((c) => c.dataset.artistName);
            const allSelected = names.length > 0 && names.every((n) => selectedArtists.has(n));
            names.forEach((n) => (allSelected ? selectedArtists.delete(n) : selectedArtists.add(n)));
            grid.querySelectorAll('.ob-artist').forEach((c) => c.classList.toggle('selected', selectedArtists.has(c.dataset.artistName)));
            e.target.textContent = allSelected ? 'Selecionar todos' : 'Limpar seleção';
            updateHint();
        });

        // Busca de qualquer artista na API do Spotify
        const searchInput = content.querySelector('#ob-search');
        const results = content.querySelector('#ob-search-results');
        let searchTimer = null;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimer);
            const q = searchInput.value.trim();
            if (q.length < 2) {
                results.hidden = true;
                results.innerHTML = '';
                return;
            }
            searchTimer = setTimeout(async () => {
                try {
                    const res = await searchSpotify(q, { limit: 8, types: ['artist'] });
                    if (searchInput.value.trim() !== q) return;
                    const found = (res.artists || []).filter((a) => a.picture);
                    found.forEach((a) => extraArtists.set(a.name, a.picture));
                    results.innerHTML = found.length
                        ? found.map((a) => chipHTML(a.name, a.picture)).join('')
                        : '<p class="ob-empty">Nenhum artista encontrado.</p>';
                    results.hidden = false;
                } catch {
                    results.innerHTML = '<p class="ob-empty">Não foi possível buscar agora.</p>';
                    results.hidden = false;
                }
            }, 350);
        });

        content.querySelector('#ob-back').addEventListener('click', renderGenres);
        content.querySelector('#ob-done').addEventListener('click', finish);
    }

    async function finish() {
        const doneBtn = content.querySelector('#ob-done');
        if (doneBtn) {
            doneBtn.disabled = true;
            doneBtn.textContent = 'Preparando suas músicas...';
        }
        localStorage.setItem('spotifree_user_genres', JSON.stringify(Array.from(selectedGenres)));
        localStorage.setItem('spotifree_user_artists', JSON.stringify(Array.from(selectedArtists)));
        localStorage.setItem('spotifree_onboarding_done', 'true');
        modal.remove();

        window.dispatchEvent(
            new CustomEvent('spotifree-preferences-updated', {
                detail: { genres: Array.from(selectedGenres), artists: Array.from(selectedArtists) },
            })
        );

        // Recarrega as recomendações da página inicial já com os gostos escolhidos
        try {
            const { UIRenderer } = await import('./ui.js');
            const ui = UIRenderer.instance;
            if (ui) {
                // O renderHomePage não refaz listas que já têm conteúdo, então atualizamos cada seção à força
                await Promise.all([ui.renderHomeSongs(true), ui.renderHomeAlbums(true), ui.renderHomeArtists(true)]);
            }
        } catch (e) {
            console.warn('Falha ao atualizar a página inicial após o assistente:', e);
        }
    }

    renderGenres();
    document.body.appendChild(modal);
}
