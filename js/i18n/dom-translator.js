// Tradutor de interface (en -> pt-BR) em tempo de execução.
// Traduz texto, placeholders, títulos e aria-labels que aparecem no DOM, inclusive os gerados pelo JS.
// Só troca textos que existam no dicionário (correspondência exata) ou casem com um padrão, então
// conteúdo do usuário (músicas, artistas, nomes de playlist) não é tocado.
import { PT_EXACT, PT_PATTERNS } from './pt-BR.js';

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-tooltip'];
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'NOSCRIPT']);
// Regiões que mostram dados do usuário/catálogo: nunca traduzir.
const SKIP_SELECTOR = [
    '[translate="no"]',
    '.track-item',
    '.queue-track-item',
    '.card-title',
    '.card-subtitle',
    '.now-playing-bar .title',
    '.now-playing-bar .artist',
    '#fullscreen-track-title',
    '#fullscreen-track-artist',
    '#fullscreen-track-album',
    '.lyrics-container',
    '.am-lyrics',
    '.search-suggestion-title',
    '.chat-message',
].join(',');

const missing = new Map(); // texto -> nó onde apareceu (só para depuração)
const normalize = (s) => s.replace(/\s+/g, ' ').trim();

function lookup(text, patternsOnly = false) {
    const key = normalize(text);
    if (!key || !/[A-Za-z]{2}/.test(key)) return null;
    const exact = patternsOnly ? undefined : PT_EXACT[key];
    if (exact !== undefined) return exact;
    for (const [re, fn] of PT_PATTERNS) {
        const m = key.match(re);
        if (m) return typeof fn === 'function' ? fn(...m.slice(1)) : key.replace(re, fn);
    }
    return null;
}

function keepSpacing(original, translated) {
    const lead = original.match(/^\s*/)[0];
    const trail = original.match(/\s*$/)[0];
    return lead + translated + trail;
}

function translateTextNode(node) {
    const parent = node.parentElement;
    if (!parent || SKIP_TAGS.has(parent.tagName)) return;
    // Em áreas com dados do usuário/catálogo só traduzimos formatos numéricos ("22 tracks"), nunca textos soltos.
    const inDataZone = !!parent.closest(SKIP_SELECTOR);
    const original = node.nodeValue;
    const translated = lookup(original, inDataZone);
    if (translated != null) {
        if (translated !== normalize(original)) node.nodeValue = keepSpacing(original, translated);
    } else if (!inDataZone && localStorage.getItem('i18n-debug') === '1') {
        const key = normalize(original);
        if (/[A-Za-z]{3}/.test(key)) missing.set(key, node);
    }
}

function translateAttributes(el) {
    if (el.closest?.(SKIP_SELECTOR)) return;
    for (const attr of ATTRS) {
        const value = el.getAttribute?.(attr);
        if (!value) continue;
        const translated = lookup(value);
        if (translated != null && translated !== value) el.setAttribute(attr, translated);
        else if (translated == null && localStorage.getItem('i18n-debug') === '1' && /[A-Za-z]{3}/.test(value)) {
            missing.set(`[${attr}] ${normalize(value)}`, el);
        }
    }
}

function translateTree(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) return translateTextNode(root);
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    translateAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
        if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
        else translateAttributes(node);
        node = walker.nextNode();
    }
}

let queue = new Set();
let scheduled = false;
function flush() {
    scheduled = false;
    const items = queue;
    queue = new Set();
    for (const n of items) if (n.isConnected) translateTree(n);
}
function enqueue(n) {
    queue.add(n);
    if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(flush);
    }
}

/** Traduz um texto solto (usado nas janelas alert/confirm/prompt). */
export function translateText(text) {
    const t = lookup(String(text));
    return t == null ? text : t;
}

export function startDomTranslator() {
    // alert/confirm/prompt não passam pelo DOM, então traduzimos a mensagem antes de abrir a janela
    for (const fn of ['alert', 'confirm', 'prompt']) {
        const original = window[fn].bind(window);
        window[fn] = (message, ...rest) => original(typeof message === 'string' ? translateText(message) : message, ...rest);
    }
    document.documentElement.lang = 'pt-BR';
    translateTree(document.body);
    new MutationObserver((mutations) => {
        for (const m of mutations) {
            if (m.type === 'childList') m.addedNodes.forEach((n) => enqueue(n));
            else if (m.type === 'characterData') enqueue(m.target);
            else if (m.type === 'attributes') enqueue(m.target);
        }
    }).observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ATTRS,
    });
    // Depuração: textos em inglês ainda visíveis (ative com localStorage i18n-debug=1)
    window.__i18nMissing = () =>
        [...missing]
            .filter(([, n]) => {
                const el = n.nodeType === 1 ? n : n.parentElement;
                return el?.isConnected && el.getClientRects().length > 0;
            })
            .map(([t]) => t)
            .sort();
}
