// /api/share?kind=party|track|album&id=...
// Entrega o index.html do site com o "preview de link" (Open Graph / Twitter) personalizado para o que está sendo
// compartilhado: convite de sessão, faixa ou álbum. Quem abre o link normalmente recebe o mesmo app de sempre;
// quem só lê o endereço (WhatsApp, Discord, Telegram, X...) recebe a prévia certa.
// Segurança: o id é validado por formato; textos de terceiros são escapados; imagens só de hosts conhecidos.
import { SITE_URL } from '../server/config.js';

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PARTY_API = 'https://spotifreeyt.shardweb.app/api/parties/info';
const IMAGE_HOSTS = /^https:\/\/(?:[a-z0-9-]+\.)?(?:spotifycdn\.com|scdn\.co|monochrome\.st)\//;

const esc = (s) =>
    String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

const DEFAULT = {
    title: 'Spotifree — toda a música, zero anúncios, de graça',
    description:
        'Ouça qualquer música sem anúncios, importe suas playlists do Spotify e escute junto com os amigos. 100% grátis.',
    image: '/assets/og-default.png',
    imageAlt: 'Spotifree: toda a música, zero anúncios, de graça',
};

async function getJSON(url, headers = {}) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(3500) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function describeParty(id) {
    const base = {
        title: 'Vem ouvir junto no Spotifree! 🎧',
        description:
            'Você foi convidado para uma sessão de escuta: entre e ouça a mesma música, no mesmo segundo, com a galera.',
        image: '/assets/og-party.png',
        imageAlt: 'Convite para ouvir música junto no Spotifree',
    };
    try {
        const info = await getJSON(`${PARTY_API}?id=${id}`);
        const host = info.host ? `${clip(info.host, 30)} chamou você` : 'Você foi chamado';
        const count = Number(info.members) || 1;
        const listening = count > 1 ? `${count} pessoas ouvindo agora` : '1 pessoa ouvindo agora';
        const playing = info.track ? ` Tocando: ${clip(info.track, 70)}.` : '';
        return {
            ...base,
            title: `🎧 ${host} para ouvir junto: ${clip(info.name || 'Sessão de escuta', 50)}`,
            description: `${listening}.${playing} Entre e escute no mesmo segundo que a galera, de graça e sem anúncios.`,
        };
    } catch {
        return base; // servidor de sessões fora do ar ou sessão encerrada: usa o convite genérico
    }
}

async function describeSpotifyTrack(id) {
    const res = await fetch(`https://open.spotify.com/embed/track/${id}`, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' },
        signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) throw new Error('embed');
    const html = await res.text();
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    const entity = JSON.parse(match?.[1] || '{}')?.props?.pageProps?.state?.data?.entity;
    if (!entity?.name) throw new Error('sem dados');

    const artists = (entity.artists || []).map((a) => a.name).filter(Boolean).join(', ');
    const sources = entity.visualIdentity?.image || entity.coverArt?.sources || [];
    let image = [...sources].sort((a, b) => (b.maxWidth || 0) - (a.maxWidth || 0))[0]?.url || '';
    image = image.replace('ab67616d00001e02', 'ab67616d0000b273'); // versão de 640 px da capa
    return {
        title: `▶ ${clip(entity.name, 70)}${artists ? ` — ${clip(artists, 60)}` : ''}`,
        description: `Ouça${artists ? ` ${clip(entity.name, 60)} de ${clip(artists, 60)}` : ` ${clip(entity.name, 60)}`} de graça no Spotifree, sem anúncios.`,
        image: IMAGE_HOSTS.test(image) ? image : DEFAULT.image,
        imageAlt: `Capa de ${clip(entity.name, 80)}`,
    };
}

async function describeCatalogAlbum(id) {
    const rel = await getJSON(`https://tracks.monochrome.st/releases/${id}`);
    if (!rel?.title) throw new Error('sem dados');
    const artists = (rel.artists || []).map((a) => a.name).filter(Boolean).join(', ');
    const year = String(rel.releaseDate || '').slice(0, 4);
    return {
        title: `💿 ${clip(rel.title, 70)}${artists ? ` — ${clip(artists, 60)}` : ''}`,
        description: `Ouça o álbum ${clip(rel.title, 60)}${artists ? ` de ${clip(artists, 60)}` : ''}${year ? ` (${year})` : ''} de graça no Spotifree, sem anúncios.`,
        image: IMAGE_HOSTS.test(rel.artwork || '') ? rel.artwork : DEFAULT.image,
        imageAlt: `Capa de ${clip(rel.title, 80)}`,
    };
}

async function describe(kind, id) {
    if (kind === 'party' && /^[a-f0-9]{10}$/.test(id)) return describeParty(id);
    if (kind === 'track') {
        const spotify = id.match(/^spotify:([A-Za-z0-9]{22})$/);
        if (spotify) return describeSpotifyTrack(spotify[1]);
    }
    if (kind === 'album' && /^\d{15,20}$/.test(id)) return describeCatalogAlbum(id);
    return null;
}

function setMeta(html, attr, name, value) {
    const re = new RegExp(`<meta\\s+${attr}="${name}"\\s+content="[^"]*"\\s*/?>`);
    const tag = `<meta ${attr}="${name}" content="${esc(value)}" />`;
    return re.test(html) ? html.replace(re, () => tag) : html.replace('</head>', () => `${tag}\n</head>`);
}

export async function GET(request) {
    const url = new URL(request.url);
    const kind = url.searchParams.get('kind') || '';
    const id = decodeURIComponent(url.searchParams.get('id') || '').slice(0, 80);

    // Página-base do próprio site (o app de sempre); só o <head> muda
    const shell = await fetch(new URL('/index.html', SITE_URL), { signal: AbortSignal.timeout(5000) });
    let html = await shell.text();

    let meta = null;
    try {
        meta = await describe(kind, id);
    } catch {
        meta = null; // sem prévia específica: cai no padrão
    }
    const m = { ...DEFAULT, ...(meta || {}) };
    const pageUrl = `${SITE_URL}${kind === 'party' ? '/party/' : `/${kind}/`}${encodeURIComponent(id)}`;
    const image = m.image.startsWith('http') ? m.image : `${SITE_URL}${m.image}`;
    const isLocalCard = !m.image.startsWith('http');

    html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${esc(m.title)}</title>`);
    html = html.replace(/<link rel="canonical" href="[^"]*"\s*\/?>/, () => `<link rel="canonical" href="${esc(pageUrl)}" />`);
    for (const [attr, name, value] of [
        ['name', 'description', m.description],
        ['property', 'og:title', m.title],
        ['property', 'og:description', m.description],
        ['property', 'og:url', pageUrl],
        ['property', 'og:image', image],
        ['property', 'og:image:alt', m.imageAlt],
        ['property', 'og:image:type', isLocalCard ? 'image/png' : 'image/jpeg'],
        ['property', 'og:image:width', isLocalCard ? '1200' : '640'],
        ['property', 'og:image:height', isLocalCard ? '630' : '640'],
        ['name', 'twitter:card', isLocalCard ? 'summary_large_image' : 'summary'],
        ['name', 'twitter:title', m.title],
        ['name', 'twitter:description', m.description],
        ['name', 'twitter:url', pageUrl],
        ['name', 'twitter:image', image],
        ['name', 'twitter:image:alt', m.imageAlt],
    ]) {
        html = setMeta(html, attr, name, value);
    }

    return new Response(html, {
        status: 200,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            // prévias de convite mudam (quantos estão ouvindo); faixas e álbuns quase não
            'Cache-Control': `public, s-maxage=${kind === 'party' ? 60 : 3600}, stale-while-revalidate=86400`,
            'X-Content-Type-Options': 'nosniff',
        },
    });
}
