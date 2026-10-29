import { YT_AUDIO_API } from './ytmusic-api.js';

// O servidor das sessões roda junto do servidor de áudio (sempre ligado na ShardCloud)
function getPartySocketUrl() {
    if (window.__PARTY_WS_URL__) return window.__PARTY_WS_URL__;
    const url = new URL(YT_AUDIO_API);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/api/parties/ws';
    url.search = '';
    url.hash = '';
    return url.toString();
}

export class PartySocketClient {
    constructor() {
        this.socket = null;
        this.pending = new Map();
        this.handlers = new Set();
        this.closeHandlers = new Set();
        this.connected = null;
        this.requestId = 0;
    }

    async connect() {
        if (this.socket?.readyState === WebSocket.OPEN) return;
        if (this.connected) return this.connected;

        this.connected = new Promise((resolve, reject) => {
            const socket = new WebSocket(getPartySocketUrl());
            this.socket = socket;
            let settled = false;
            const fail = (message) => {
                if (settled) return;
                settled = true;
                try {
                    if (socket && socket.readyState !== WebSocket.CLOSED && typeof socket.close === 'function') {
                        socket.close();
                    }
                } catch (_e) {}
                clearTimeout(connectTimeout);
                this.connected = null;
                this.socket = null;
                reject(new Error(message));
            };
            const connectTimeout = setTimeout(() => fail('Could not connect to the listening party server.'), 8000);

            socket.onopen = () => {
                if (settled) return;
                settled = true;
                clearTimeout(connectTimeout);
                this.connected = null;
                resolve();
            };

            socket.onerror = () => {
                fail('Could not connect to the listening party server.');
            };

            socket.onclose = () => {
                if (!settled) {
                    fail('Could not connect to the listening party server.');
                    return;
                }
                this.connected = null;
                this.closeHandlers.forEach((handler) => handler());
                for (const { reject, timeout } of this.pending.values()) {
                    clearTimeout(timeout);
                    reject(new Error('Listening party connection closed.'));
                }
                this.pending.clear();
            };

            socket.onmessage = (event) => this.receive(event);
        });

        return this.connected;
    }

    receive(event) {
        let message;
        try {
            message = JSON.parse(event.data);
        } catch (_e) {
            return;
        }

        // O servidor marca o momento da reprodução com o relógio dele; aqui convertemos para o relógio deste aparelho
        // (os relógios de celulares e computadores diferem), senão a sincronização com o host sai errada.
        if (message.party && typeof message.server_time === 'number' && typeof message.party.playback_timestamp === 'number') {
            message.party.playback_timestamp += Date.now() - message.server_time;
        }

        if (message.requestId && this.pending.has(message.requestId)) {
            const pending = this.pending.get(message.requestId);
            clearTimeout(pending.timeout);
            this.pending.delete(message.requestId);
            if (message.type === 'error') {
                pending.reject(new Error(message.error || 'Listening party request failed.'));
            } else {
                pending.resolve(message);
            }
        }

        this.handlers.forEach((handler) => handler(message));
    }

    onClose(handler) {
        this.closeHandlers.add(handler);
        return () => this.closeHandlers.delete(handler);
    }

    onMessage(handler) {
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
    }

    async send(type, payload = {}) {
        await this.connect();
        if (this.socket?.readyState !== WebSocket.OPEN) {
            throw new Error('Listening party connection is not open.');
        }
        this.socket.send(JSON.stringify({ type, payload }));
    }

    async request(type, payload = {}) {
        await this.connect();
        const requestId = `req_${++this.requestId}`;
        const promise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new Error('Listening party request timed out.'));
            }, 10000);
            this.pending.set(requestId, { resolve, reject, timeout });
        });
        if (this.socket?.readyState !== WebSocket.OPEN) {
            clearTimeout(this.pending.get(requestId)?.timeout);
            this.pending.delete(requestId);
            throw new Error('Listening party connection is not open.');
        }
        this.socket.send(JSON.stringify({ type, payload, requestId }));
        return promise;
    }

    close() {
        if (!this.socket) return;
        if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
            this.socket.close();
        }
        this.socket = null;
        this.connected = null;
    }
}
