// /api/yt-endpoint
// O servidor de áudio roda no PC do dono, atrás de um túnel gratuito cujo endereço muda a cada início.
// O PC se registra aqui (POST, com segredo) e o site pergunta qual é o endereço atual (GET).
//   GET  -> { url, updatedAt }   (url = null se o PC não avisou nos últimos 3 minutos)
//   POST -> { url }              (exige o cabeçalho x-registry-secret)
import { timingSafeEqual } from 'node:crypto';
import { jsonResponse as json } from '../server/config.js';
import { readJSON, writeJSON } from '../server/store.js';

const PATH = 'config/yt-endpoint.json';
const FRESH_MS = 3 * 60 * 1000;
// Só aceitamos endereços de túnel da Cloudflare, para ninguém registrar um destino malicioso
const TUNNEL_RE = /^https:\/\/[a-z0-9-]{3,80}\.trycloudflare\.com$/;

function secretMatches(given) {
    const expected = process.env.YT_REGISTRY_SECRET || '';
    if (expected.length < 32 || !given) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET() {
    try {
        const record = await readJSON(PATH);
        const fresh = record?.url && Date.now() - (record.updatedAt || 0) < FRESH_MS;
        return json(200, { url: fresh ? record.url : null, updatedAt: record?.updatedAt || 0 });
    } catch (err) {
        console.error('[yt-endpoint] leitura:', err.message);
        return json(200, { url: null, updatedAt: 0 });
    }
}

export async function POST(request) {
    if (!secretMatches(request.headers.get('x-registry-secret'))) return json(401, { error: 'não autorizado' });
    let body = null;
    try {
        body = await request.json();
    } catch {
        return json(400, { error: 'JSON inválido' });
    }
    const url = String(body?.url || '').replace(/\/+$/, '');
    if (!TUNNEL_RE.test(url)) return json(400, { error: 'endereço de túnel inválido' });
    try {
        await writeJSON(PATH, { url, updatedAt: Date.now() });
        return json(200, { ok: true });
    } catch (err) {
        console.error('[yt-endpoint] gravação:', err.message);
        return json(503, { error: 'armazenamento indisponível' });
    }
}
