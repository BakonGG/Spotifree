// yt-server/party.js
// Servidor das "sessões de escuta em grupo" (WebSocket em /api/parties/ws). Sem dependências: o protocolo
// WebSocket (RFC 6455) é tratado aqui mesmo. As sessões ficam só na memória e somem quando acabam.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const WS_PATH = '/api/parties/ws';
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 256 * 1024; // maior mensagem aceita
const MAX_PARTIES = 200;
const MAX_MEMBERS = 50;
const MAX_CONNECTIONS_PER_IP = 12;
const MEMBER_GRACE_MS = 45 * 1000; // tempo para uma recarga de página voltar sem sair da sessão
const HOST_GONE_MS = 10 * 60 * 1000; // sem host por tanto tempo, a sessão termina
const EMPTY_PARTY_MS = 30 * 60 * 1000;

const parties = new Map(); // id -> party
const connectionsByIp = new Map();

const sha = (v) => createHash('sha256').update(String(v)).digest('hex');
const same = (a, b) => {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
};

// Texto que vem de outros usuários: tira o que serviria para injetar HTML e limita o tamanho
const text = (v, max) =>
    String(v ?? '')
        .replace(/[<>"'`\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, max);
const safeUrl = (u) => (/^https:\/\/[^\s"'<>`]{1,300}$/.test(String(u || '')) ? String(u) : '');
const idOk = (v) => /^[A-Za-z0-9_:-]{4,64}$/.test(String(v || ''));

/** Copia um objeto JSON (faixa, fila) limitando profundidade, tamanho e removendo < e >. */
function sanitizeDeep(value, depth = 0) {
    if (typeof value === 'string') return value.replace(/[<>\u0000-\u001f\u007f]/g, '').slice(0, 300);
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'boolean' || value === null) return value;
    if (depth > 4) return null;
    if (Array.isArray(value)) return value.slice(0, 300).map((v) => sanitizeDeep(v, depth + 1));
    if (typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value).slice(0, 40)) {
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
            out[key.slice(0, 40)] = sanitizeDeep(value[key], depth + 1);
        }
        return out;
    }
    return null;
}

// ─── WebSocket (RFC 6455) ───────────────────────────────────────────────────
function frame(opcode, payload) {
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    let header;
    if (body.length < 126) {
        header = Buffer.from([0x80 | opcode, body.length]);
    } else if (body.length < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x80 | opcode;
        header[1] = 126;
        header.writeUInt16BE(body.length, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x80 | opcode;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(body.length), 2);
    }
    return Buffer.concat([header, body]);
}

class Client {
    constructor(socket, ip) {
        this.socket = socket;
        this.ip = ip;
        this.buffer = Buffer.alloc(0);
        this.fragments = [];
        this.party = null;
        this.memberId = null;
        this.alive = true;
        this.msgCount = 0;
        this.msgReset = Date.now() + 10000;
        this.lastChat = 0;
    }

    send(obj) {
        if (!this.alive || this.socket.destroyed) return;
        try {
            this.socket.write(frame(0x1, JSON.stringify({ ...obj, server_time: Date.now() })));
        } catch {
            this.close();
        }
    }

    close(code = 1000) {
        if (!this.alive) return;
        this.alive = false;
        try {
            const payload = Buffer.alloc(2);
            payload.writeUInt16BE(code, 0);
            this.socket.write(frame(0x8, payload));
        } catch {
            // socket já fechado
        }
        this.socket.end();
        onDisconnect(this);
    }

    onData(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        for (;;) {
            if (this.buffer.length < 2) return;
            const b0 = this.buffer[0];
            const b1 = this.buffer[1];
            const fin = (b0 & 0x80) !== 0;
            const opcode = b0 & 0x0f;
            const masked = (b1 & 0x80) !== 0;
            let len = b1 & 0x7f;
            let offset = 2;
            if (len === 126) {
                if (this.buffer.length < 4) return;
                len = this.buffer.readUInt16BE(2);
                offset = 4;
            } else if (len === 127) {
                if (this.buffer.length < 10) return;
                const big = this.buffer.readBigUInt64BE(2);
                if (big > BigInt(MAX_FRAME)) return this.close(1009);
                len = Number(big);
                offset = 10;
            }
            if (!masked) return this.close(1002); // clientes de navegador sempre mascaram
            if (len > MAX_FRAME) return this.close(1009);
            if (this.buffer.length < offset + 4 + len) return;

            const mask = this.buffer.subarray(offset, offset + 4);
            const data = Buffer.from(this.buffer.subarray(offset + 4, offset + 4 + len));
            for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
            this.buffer = this.buffer.subarray(offset + 4 + len);

            if (opcode === 0x8) return this.close(1000);
            if (opcode === 0x9) {
                this.socket.write(frame(0xa, data));
                continue;
            }
            if (opcode === 0xa) continue;
            if (opcode === 0x1 || opcode === 0x0) {
                this.fragments.push(data);
                if (this.fragments.reduce((n, f) => n + f.length, 0) > MAX_FRAME) return this.close(1009);
                if (fin) {
                    const message = Buffer.concat(this.fragments).toString('utf8');
                    this.fragments = [];
                    this.onMessage(message);
                }
            }
        }
    }

    onMessage(raw) {
        const now = Date.now();
        if (now > this.msgReset) {
            this.msgCount = 0;
            this.msgReset = now + 10000;
        }
        if (++this.msgCount > 200) return this.close(1008); // mais de 200 mensagens em 10 s

        let msg;
        try {
            msg = JSON.parse(raw);
        } catch {
            return;
        }
        if (!msg || typeof msg.type !== 'string') return;
        const reply = (extra) => this.send({ requestId: msg.requestId, ...extra });
        try {
            handle(this, msg.type, msg.payload || {}, reply);
        } catch (err) {
            console.error('[party]', msg.type, err.message);
            reply({ type: 'error', error: 'Não foi possível concluir o pedido.' });
        }
    }
}

// ─── Sessões ────────────────────────────────────────────────────────────────
function publicParty(p) {
    return {
        id: p.id,
        name: p.name,
        current_track: p.current_track,
        is_playing: p.is_playing,
        playback_time: p.playback_time,
        playback_timestamp: p.playback_timestamp,
        queue: p.queue,
    };
}

const membersList = (p) =>
    [...p.members.values()].map((m) => ({
        id: m.id,
        name: m.name,
        avatar_url: m.avatar_url,
        is_host: m.is_host,
        typing_until: m.typing_until,
    }));

function broadcast(p, obj, except = null) {
    for (const m of p.members.values()) {
        for (const c of m.clients) if (c !== except) c.send(obj);
    }
}

const snapshot = (p, memberId, isHost) => ({
    party: publicParty(p),
    members: membersList(p),
    messages: p.messages,
    requests: p.requests,
    memberId,
    isHost,
});

function applyPlayback(p, pb) {
    if (!pb || typeof pb !== 'object') return;
    p.current_track = pb.current_track ? sanitizeDeep(pb.current_track) : null;
    p.is_playing = pb.is_playing === true;
    p.playback_time = Math.max(0, Number(pb.playback_time) || 0);
    p.playback_timestamp = Date.now(); // hora do servidor; o navegador converte para o relógio dele
    p.queue = Array.isArray(pb.queue) ? sanitizeDeep(pb.queue.slice(0, 100)) : [];
}

function profileOf(payload) {
    const profile = payload.profile || {};
    const name = text(profile.name, 32) || 'Convidado';
    const avatar = safeUrl(profile.avatar_url) || `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(name)}`;
    return { name, avatar_url: avatar };
}

function addMember(p, client, memberId, profile, isHost) {
    let m = p.members.get(memberId);
    if (m?.removeTimer) clearTimeout(m.removeTimer);
    if (!m) {
        if (p.members.size >= MAX_MEMBERS) return null;
        m = { id: memberId, clients: new Set(), typing_until: 0, removeTimer: null };
        p.members.set(memberId, m);
    }
    m.removeTimer = null;
    m.name = profile.name;
    m.avatar_url = profile.avatar_url;
    m.is_host = m.is_host || isHost;
    m.clients.add(client);
    client.party = p;
    client.memberId = memberId;
    p.hostGoneSince = null;
    return m;
}

function removeMember(p, memberId) {
    const m = p.members.get(memberId);
    if (!m) return;
    if (m.removeTimer) clearTimeout(m.removeTimer);
    p.members.delete(memberId);
    broadcast(p, { type: 'members', members: membersList(p) });
}

function endParty(p) {
    broadcast(p, { type: 'ended' });
    for (const m of p.members.values()) {
        if (m.removeTimer) clearTimeout(m.removeTimer);
        for (const c of m.clients) c.party = null;
    }
    parties.delete(p.id);
}

function onDisconnect(client) {
    const ipCount = (connectionsByIp.get(client.ip) || 1) - 1;
    if (ipCount <= 0) connectionsByIp.delete(client.ip);
    else connectionsByIp.set(client.ip, ipCount);

    const p = client.party;
    if (!p) return;
    const m = p.members.get(client.memberId);
    if (!m) return;
    m.clients.delete(client);
    if (m.clients.size > 0) return;
    if (m.is_host) p.hostGoneSince = Date.now();
    m.removeTimer = setTimeout(() => removeMember(p, m.id), MEMBER_GRACE_MS);
}

function handle(client, type, payload, reply) {
    if (type === 'create') {
        if (parties.size >= MAX_PARTIES) return reply({ type: 'error', error: 'Servidor cheio, tente mais tarde.' });
        const memberId = idOk(payload.memberId) ? payload.memberId : `member_${randomBytes(9).toString('hex')}`;
        const hostToken = String(payload.hostToken || '');
        if (hostToken.length < 16) return reply({ type: 'error', error: 'Pedido inválido.' });

        const p = {
            id: randomBytes(5).toString('hex'),
            name: text(payload.name, 60) || 'Sessão de escuta',
            hostHash: sha(hostToken),
            current_track: null,
            is_playing: false,
            playback_time: 0,
            playback_timestamp: Date.now(),
            queue: [],
            members: new Map(),
            messages: [],
            requests: [],
            hostGoneSince: null,
            lastActive: Date.now(),
        };
        applyPlayback(p, payload.playback);
        parties.set(p.id, p);
        addMember(p, client, memberId, profileOf(payload), true);
        return reply({ type: 'created', ...snapshot(p, memberId, true) });
    }

    if (type === 'join') {
        const p = parties.get(String(payload.partyId || ''));
        if (!p) return reply({ type: 'error', error: 'A sessão não existe mais.' });
        const memberId = idOk(payload.memberId) ? payload.memberId : `member_${randomBytes(9).toString('hex')}`;
        const isHost = !!payload.hostToken && same(sha(payload.hostToken), p.hostHash);
        const m = addMember(p, client, memberId, profileOf(payload), isHost);
        if (!m) return reply({ type: 'error', error: 'A sessão está cheia.' });
        p.lastActive = Date.now();
        reply({ type: 'joined', ...snapshot(p, memberId, m.is_host === true) });
        broadcast(p, { type: 'members', members: membersList(p) }, client);
        return;
    }

    // Todo o resto exige estar dentro de uma sessão
    const p = client.party;
    const member = p?.members.get(client.memberId);
    if (!p || !member) return reply({ type: 'error', error: 'Você não está em uma sessão.' });
    p.lastActive = Date.now();

    switch (type) {
        case 'playback':
            if (!member.is_host) return;
            applyPlayback(p, payload);
            broadcast(p, { type: 'party', party: publicParty(p) }, client);
            return;
        case 'heartbeat':
            return;
        case 'typing': {
            const until = Number(payload.typing_until) || 0;
            member.typing_until = until > 0 ? Math.min(until, Date.now() + 5000) : 0;
            broadcast(p, { type: 'members', members: membersList(p) }, client);
            return;
        }
        case 'chat': {
            const content = text(payload.content, 500);
            const now = Date.now();
            if (!content || now - client.lastChat < 600) return;
            client.lastChat = now;
            const message = { id: randomBytes(6).toString('hex'), sender_id: member.id, sender_name: member.name, content, created: now };
            p.messages.push(message);
            p.messages = p.messages.slice(-100);
            broadcast(p, { type: 'message', message });
            return;
        }
        case 'request': {
            if (!payload.track || p.requests.length >= 50) return;
            const track = sanitizeDeep(payload.track);
            p.requests.push({ id: randomBytes(6).toString('hex'), track, requested_by: member.name });
            broadcast(p, { type: 'requests', requests: p.requests });
            return;
        }
        case 'request:remove':
            if (!member.is_host) return;
            p.requests = p.requests.filter((r) => r.id !== String(payload.requestId));
            broadcast(p, { type: 'requests', requests: p.requests });
            return;
        case 'leave':
            if (payload.end === true && member.is_host) return endParty(p);
            member.clients.delete(client);
            client.party = null;
            if (member.clients.size === 0) removeMember(p, member.id);
            return;
        default:
            return;
    }
}

// Limpeza periódica de sessões sem host ou sem ninguém
setInterval(() => {
    const now = Date.now();
    for (const p of parties.values()) {
        const connected = [...p.members.values()].some((m) => m.clients.size > 0);
        if (p.hostGoneSince && now - p.hostGoneSince > HOST_GONE_MS) endParty(p);
        else if (!connected && now - p.lastActive > EMPTY_PARTY_MS) endParty(p);
    }
}, 60 * 1000).unref();

// Informações públicas de uma sessão (nome, quem chamou, quantos ouvem, faixa atual), usadas no preview do convite.
// Só quem tem o id da sessão (10 caracteres aleatórios) consegue consultar.
const infoHits = new Map(); // ip -> { n, reset }
function partyInfo(id) {
    const p = parties.get(id);
    if (!p) return null;
    const host = [...p.members.values()].find((m) => m.is_host);
    const t = p.current_track;
    const artist = t?.artists?.[0]?.name || t?.artist?.name || '';
    return {
        name: p.name,
        host: host?.name || '',
        members: p.members.size,
        track: t ? [t.title, artist].filter(Boolean).join(' — ') : '',
    };
}

function installInfo(server) {
    const existing = server.listeners('request');
    server.removeAllListeners('request');
    server.on('request', (req, res) => {
        if (req.method === 'GET' && req.url.startsWith('/api/parties/info')) {
            const ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'x';
            const now = Date.now();
            const hit = infoHits.get(ip);
            if (!hit || hit.reset < now) infoHits.set(ip, { n: 1, reset: now + 60000 });
            else if (++hit.n > 60) {
                res.writeHead(429, { 'Content-Type': 'application/json' });
                return res.end('{"error":"muitos pedidos"}');
            }
            const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
            const info = /^[a-f0-9]{10}$/.test(id) ? partyInfo(id) : null;
            res.writeHead(info ? 200 : 404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            return res.end(JSON.stringify(info || { error: 'sessão não encontrada' }));
        }
        for (const handler of existing) handler.call(server, req, res);
    });
}

/** Liga o servidor de sessões ao servidor HTTP já existente. */
export function attachParties(server, origins) {
    installInfo(server);
    server.on('upgrade', (req, socket) => {
        const reject = (code, reason) => {
            socket.write(`HTTP/1.1 ${code} ${reason}\r\nConnection: close\r\n\r\n`);
            socket.destroy();
        };
        const url = new URL(req.url, 'http://x');
        if (url.pathname !== WS_PATH) return reject(404, 'Not Found');
        if (String(req.headers.upgrade).toLowerCase() !== 'websocket') return reject(400, 'Bad Request');

        // Só os sites permitidos podem abrir a conexão (navegadores sempre enviam o Origin)
        const origin = req.headers.origin;
        if (!origins.includes('*') && !origins.includes(origin)) return reject(403, 'Forbidden');

        const key = req.headers['sec-websocket-key'];
        if (!key || !/^[A-Za-z0-9+/=]{16,40}$/.test(key)) return reject(400, 'Bad Request');

        const ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'x';
        const open = connectionsByIp.get(ip) || 0;
        if (open >= MAX_CONNECTIONS_PER_IP) return reject(429, 'Too Many Requests');
        connectionsByIp.set(ip, open + 1);

        const accept = createHash('sha1').update(key + GUID).digest('base64');
        socket.write(
            'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
                `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
        );
        socket.setNoDelay(true);
        socket.setTimeout(0);

        const client = new Client(socket, ip);
        socket.on('data', (chunk) => client.onData(chunk));
        const gone = () => {
            if (!client.alive) return;
            client.alive = false;
            onDisconnect(client);
        };
        socket.on('close', gone);
        socket.on('error', gone);

        // Ping a cada 25 s mantém a conexão viva atrás do túnel/proxy
        const ping = setInterval(() => {
            if (!client.alive || socket.destroyed) return clearInterval(ping);
            try {
                socket.write(frame(0x9, ''));
            } catch {
                clearInterval(ping);
            }
        }, 25000);
        socket.on('close', () => clearInterval(ping));
    });
}
