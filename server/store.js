// server/store.js
// Armazenamento de JSON no Vercel Blob (loja PRIVADA). Requer BLOB_READ_WRITE_TOKEN (vem da loja conectada).
import { createHash } from 'node:crypto';
import { del, get, put } from '@vercel/blob';

/** Nunca usamos IDs de usuário direto no caminho: o hash evita caracteres estranhos e injeção de caminho. */
export const hashId = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 40);

export async function readJSON(pathname) {
    try {
        const result = await get(pathname, { access: 'private', useCache: false });
        if (!result?.stream) return null;
        return JSON.parse(await new Response(result.stream).text());
    } catch (err) {
        if (/not.?found|404|does not exist/i.test(`${err?.name} ${err?.message}`)) return null;
        throw err;
    }
}

export async function writeJSON(pathname, data) {
    await put(pathname, JSON.stringify(data), {
        access: 'private',
        contentType: 'application/json',
        allowOverwrite: true,
        addRandomSuffix: false,
    });
}

export async function removeJSON(pathname) {
    try {
        await del(pathname);
    } catch {
        // já não existia
    }
}
