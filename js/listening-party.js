import { syncManager } from './accounts/pocketbase.js';
import { authManager } from './accounts/auth.js';
import { Player } from './player.js';
import { navigate } from './router.js';
import { getTrackArtists, escapeHtml } from './utils.js';
import { audioContextManager } from './audio-context.js';
import { showNotification } from './downloads.js';
import { SVG_PAUSE } from './icons.js';
import { PartySocketClient } from './party-socket.js';

export const LISTENING_PARTIES_DISABLED_MESSAGE =
    'As sessões de escuta estão indisponíveis no momento. Elas voltam em breve.';

export function areListeningPartiesDisabled() {
    const flags = window.__FEATURE_FLAGS__ || {};
    if (typeof flags.listeningParties === 'boolean') return !flags.listeningParties;
    if (typeof flags.listeningPartiesDisabled === 'boolean') return flags.listeningPartiesDisabled;
    return false;
}

const LISTENING_PARTIES_DISABLED = areListeningPartiesDisabled();

class Modal {
    static async show({ title, content, actions = [] }) {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'modal active';
            modal.style.zIndex = '10000';
            modal.innerHTML = `
                <div class="modal-overlay"></div>
                <div class="modal-content" style="max-width: 450px; text-align: center; padding: 2.5rem;">
                    <h3 style="margin-bottom: 1rem; font-size: 1.5rem;">${title}</h3>
                    <div class="modal-body" style="margin-bottom: 2rem; color: var(--muted-foreground); line-height: 1.5;">${content}</div>
                    <div class="modal-actions" style="display: flex; flex-direction: column; gap: 0.75rem;">
                        ${actions
                            .map(
                                (a, i) => `
                            <button class="btn-${a.type || 'secondary'} modal-action-btn" data-index="${i}" style="width: 100%; padding: 0.8rem; font-weight: 600;">${a.label}</button>
                        `
                            )
                            .join('')}
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            const cleanup = (val) => {
                modal.remove();
                resolve(val);
            };

            modal.querySelectorAll('.modal-action-btn').forEach((btn) => {
                btn.onclick = () => {
                    const action = actions[btn.dataset.index];
                    if (action.callback) {
                        const result = action.callback(modal);
                        if (result !== false) cleanup(result ?? true);
                    } else {
                        cleanup(true);
                    }
                };
            });

            modal.querySelector('.modal-overlay').onclick = () => cleanup(false);
        });
    }

    static async alert(title, message) {
        return this.show({
            title,
            content: message,
            actions: [{ label: 'OK', type: 'primary' }],
        });
    }

    static async confirm(title, message, confirmLabel = 'Confirmar', type = 'primary') {
        return this.show({
            title,
            content: message,
            actions: [
                { label: confirmLabel, type: type },
                { label: 'Cancelar', type: 'secondary', callback: () => false },
            ],
        });
    }
}

export class ListeningPartyManager {
    constructor() {
        this.currentParty = null;
        this.isHost = false;
        this.memberId = null;
        this.members = [];
        this.messages = [];
        this.requests = [];
        this.unsubscribeFunctions = [];
        this.syncInterval = null;
        this.heartbeatInterval = null;
        this.isJoining = false;
        this.isLeaving = false;
        this.isInternalSync = false;
        this.originalSafePlay = null;
        this.originalPlayTrackFromQueue = null;
        this.maintenanceMode = false;
        this.maintenanceMessage = null;
        this.socket = null;
        this.socketUnsubscribe = null;
        this._suppressSocketClose = false;

        this.setupEventListeners();
    }

    setupEventListeners() {
        document.getElementById('create-party-btn')?.addEventListener('click', () => this.createParty());
        document.getElementById('sidebar-create-party-btn')?.addEventListener('click', () => this.quickStart());
        document.getElementById('leave-party-btn')?.addEventListener('click', () => this.leaveParty());
        document.getElementById('copy-party-link-btn')?.addEventListener('click', () => this.copyInviteLink());
        document.getElementById('party-chat-send-btn')?.addEventListener('click', () => this.sendChatMessage());
        const chatInput = document.getElementById('party-chat-input');
        chatInput?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendChatMessage().catch(console.error);
        });
        chatInput?.addEventListener('input', () => this._pingTyping());
        chatInput?.addEventListener('blur', () => this._clearTyping());

        if (LISTENING_PARTIES_DISABLED) {
            this.maintenanceMode = true;
            this.maintenanceMessage = LISTENING_PARTIES_DISABLED_MESSAGE;
            const createBtn = document.getElementById('create-party-btn');
            const nameInput = document.getElementById('party-name-input');
            const hostControls = document.getElementById('parties-host-controls');
            const disabledNotice = document.getElementById('parties-disabled-notice');
            if (createBtn) {
                createBtn.textContent = 'Temporariamente desativado';
                createBtn.disabled = true;
                createBtn.style.opacity = '0.5';
                createBtn.style.cursor = 'not-allowed';
            }
            if (nameInput) {
                nameInput.disabled = true;
                nameInput.placeholder = 'Criação de sessões temporariamente indisponível';
            }
            if (hostControls) hostControls.style.display = 'none';
            if (disabledNotice) disabledNotice.style.display = 'block';
        }
    }

    /** Botão da barra lateral: abre a sessão em andamento ou cria uma nova com um clique. */
    async quickStart() {
        document.querySelector('.sidebar')?.classList.remove('is-open');
        document.getElementById('sidebar-overlay')?.classList.remove('is-visible');
        if (this.currentParty?.id) {
            navigate(`/party/${this.currentParty.id}`);
            return;
        }
        await this.createParty();
    }

    async createParty() {
        if (this.maintenanceMode) {
            await Modal.alert('Em manutenção', this.maintenanceMessage);
            return;
        }

        const nameInput = document.getElementById('party-name-input');
        const user = authManager.user;

        let pbUser = null;
        if (user) {
            try {
                pbUser = await syncManager._getUserRecord(user.$id);
            } catch (_e) {
                pbUser = null;
            }
        }

        const ownerName = pbUser?.display_name?.trim() || pbUser?.username?.trim();
        const fallbackPartyName = ownerName ? `Sessão de ${ownerName}` : 'Sessão de escuta';
        const name = nameInput.value.trim() || fallbackPartyName;
        const player = Player.instance;
        const currentTrack = player.currentTrack ? syncManager._minifyItem('track', player.currentTrack) : null;
        const hostToken = this._generateHostToken();
        const profile = await this.getMemberProfile(pbUser);

        try {
            this._connectSocket();
            const response = await this.socket.request('create', {
                name,
                hostToken,
                memberId: this._stableMemberId(),
                userId: user?.$id || null,
                profile,
                playback: {
                    current_track: currentTrack,
                    is_playing: player.currentTrack ? !player.activeElement.paused : false,
                    playback_time: player.activeElement.currentTime || 0,
                    playback_timestamp: Date.now(),
                    queue: player.queue?.map((t) => syncManager._minifyItem('track', t)) || [],
                },
            });
            this._applyPartySnapshot(response);
            this._rememberHostToken(response.party.id, hostToken);
            this._rememberGuestMember(response.party.id, response.memberId);
            this.isHost = true;
            navigate(`/party/${response.party.id}`);
        } catch (e) {
            console.error('Create error:', e);
            this._closeSocket();
            await Modal.alert('Erro', 'Não foi possível criar a sessão. Tente de novo.');
        }
    }

    async joinParty(partyId) {
        if (this.maintenanceMode) {
            await Modal.alert('Sessões desativadas', this.maintenanceMessage);
            navigate('/parties');
            return;
        }
        if (this.currentParty?.id === partyId) {
            this.renderPartyUI();
            await this.loadInitialData(partyId);
            return;
        }
        if (this.isJoining) return;
        this.isJoining = true;

        try {
            const user = authManager.user;
            const pbUser = user ? await syncManager._getUserRecord(user.$id).catch(() => null) : null;
            const existingMemberId = this._getGuestMemberId(partyId);
            const hasHostToken = !!this._getHostToken(partyId);

            let confirmed;
            if (existingMemberId) {
                confirmed = { profile: await this.getMemberProfile(pbUser) };
            } else {
                confirmed = await this.showJoinModal(user, pbUser);
                if (!confirmed) {
                    this.isJoining = false;
                    navigate('/parties');
                    return;
                }
            }

            const profile = confirmed.profile || (await this.getMemberProfile(pbUser));
            this._connectSocket();
            const response = await this.socket.request('join', {
                partyId,
                memberId: existingMemberId || this._stableMemberId(),
                hostToken: this._getHostToken(partyId),
                userId: user?.$id || null,
                profile,
            });
            this._applyPartySnapshot(response);
            this.isHost = response.isHost === true || hasHostToken;
            this.memberId = response.memberId;
            this._rememberGuestMember(partyId, response.memberId);

            this.startHeartbeat();
            this.renderPartyUI();
            await this.loadInitialData(partyId);

            if (!this.isHost) {
                this.lockControls();
                this.setupGuestSyncInterception();
                if (this.currentParty.current_track) {
                    await audioContextManager.resume();
                    await this.syncWithHost(this.currentParty);
                }
            }
        } catch (error) {
            console.error('Join error:', error);
            this._closeSocket();
            await Modal.alert('Erro', 'Não foi possível entrar na sessão. Ela pode ter terminado.');
            navigate('/parties');
        } finally {
            this.isJoining = false;
        }
    }

    _hasProfileName(pbUser) {
        return !!(pbUser?.display_name?.trim() || pbUser?.username?.trim());
    }

    _userProfileKey(userId) {
        return `party_user_profile_${userId}`;
    }

    _getStoredUserProfile(userId) {
        try {
            const raw = localStorage.getItem(this._userProfileKey(userId));
            return raw ? JSON.parse(raw) : null;
        } catch (_e) {
            return null;
        }
    }

    async _promptNickname({ title, body, cached }) {
        const defaultName = escapeHtml(cached || '');
        return new Promise((resolve, reject) => {
            Modal.show({
                title,
                content: `
                    <p style="margin-bottom: 1rem;">${body}</p>
                    <input type="text" id="guest-name-input" class="template-input" value="${defaultName}" placeholder="Seu apelido" style="width: 100%; text-align: center;">
                `,
                actions: [
                    {
                        label: 'Entrar na sessão',
                        type: 'primary',
                        callback: (modal) => {
                            const name = modal.querySelector('#guest-name-input').value.trim() || 'Convidado';
                            const profile = {
                                name,
                                avatar_url: `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(name)}`,
                            };
                            return { profile };
                        },
                    },
                    { label: 'Cancelar', type: 'secondary', callback: () => false },
                ],
            })
                .then(resolve)
                .catch(reject);
        });
    }

    async showJoinModal(user, pbUser = null) {
        if (user && this._hasProfileName(pbUser)) {
            const confirmed = await Modal.confirm(
                'Entrar na sessão',
                `Você vai entrar em uma sessão de escuta. Todos na sessão verão o seu perfil. Pronto para ouvir junto?`,
                'Entrar na sessão'
            );
            return confirmed ? { profile: null } : false;
        }

        if (user) {
            const stored = this._getStoredUserProfile(user.$id);
            const result = await this._promptNickname({
                title: 'Escolha um apelido',
                body: 'Você ainda não tem um perfil. Escolha um apelido para os outros participantes saberem quem você é.',
                cached: stored?.name || '',
            });
            if (result && result.profile) {
                try {
                    localStorage.setItem(this._userProfileKey(user.$id), JSON.stringify(result.profile));
                } catch (_e) {}
            }
            return result;
        }

        const cached = localStorage.getItem('party_guest_profile');
        const cachedName = cached ? JSON.parse(cached).name : '';
        const result = await this._promptNickname({
            title: 'Entrar como convidado',
            body: 'Digite um apelido para entrar na sessão!',
            cached: cachedName,
        });
        if (result && result.profile) {
            try {
                localStorage.setItem('party_guest_profile', JSON.stringify(result.profile));
            } catch (_e) {}
        }
        return result;
    }

    setupGuestSyncInterception() {
        const player = Player.instance;
        if (!this.originalSafePlay) this.originalSafePlay = player.safePlay.bind(player);
        player.safePlay = async (el) => {
            if (this.currentParty && !this.isHost && !this.currentParty.is_playing) return false;
            return await this.originalSafePlay(el);
        };
    }

    _guestMemberKey(partyId) {
        return `party_guest_member_${partyId}`;
    }

    _hostTokenKey(partyId) {
        return `party_host_token_${partyId}`;
    }

    _getHostToken(partyId) {
        try {
            return localStorage.getItem(this._hostTokenKey(partyId)) || null;
        } catch (_e) {
            return null;
        }
    }

    _rememberHostToken(partyId, token) {
        try {
            localStorage.setItem(this._hostTokenKey(partyId), token);
        } catch (_e) {}
    }

    _forgetHostToken(partyId) {
        try {
            localStorage.removeItem(this._hostTokenKey(partyId));
        } catch (_e) {}
    }

    _generateHostToken() {
        const bytes = new Uint8Array(24);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }

    _stableMemberId() {
        const user = authManager.user;
        const key = user ? `party_member_user_${user.$id}` : 'party_member_guest';
        let memberId = localStorage.getItem(key);
        if (!memberId) {
            memberId = `member_${crypto.randomUUID().replaceAll('-', '').slice(0, 18)}`;
            localStorage.setItem(key, memberId);
        }
        return memberId;
    }

    _connectSocket() {
        if (this.socket) return this.socket;
        const client = new PartySocketClient();
        this.socket = client;
        this.socketUnsubscribe = client.onMessage((message) => this._handleSocketMessage(message));
        client.onClose(() => this._handleSocketClosed(client));
        return client;
    }

    /** A conexão caiu sem a pessoa ter saído (rede, proxy, servidor reiniciando): volta para a mesma sessão. */
    _handleSocketClosed(client) {
        if (this.isLeaving || !this.currentParty || this._reconnecting || this.socket !== client) return;
        this._reconnecting = true;
        this._reconnect()
            .catch(console.error)
            .finally(() => {
                this._reconnecting = false;
            });
    }

    async _reconnect() {
        const partyId = this.currentParty?.id;
        for (const wait of [1000, 2000, 4000, 8000, 15000, 15000]) {
            await new Promise((resolve) => setTimeout(resolve, wait));
            if (this.isLeaving || !this.currentParty) return;
            try {
                this.socketUnsubscribe?.();
                this.socketUnsubscribe = null;
                try {
                    this.socket?.close();
                } catch (_e) {}
                this.socket = null;
                this._connectSocket();
                const response = await this.socket.request('join', {
                    partyId,
                    memberId: this.memberId,
                    hostToken: this._getHostToken(partyId),
                    userId: authManager.user?.$id || null,
                    profile: await this.getMemberProfile(),
                });
                this._applyPartySnapshot(response);
                this.renderMembers();
                this.updatePartyHeader();
                if (!this.isHost) await this.syncWithHost(this.currentParty);
                showNotification('Reconectado à sessão');
                return;
            } catch (_e) {
                // tenta de novo no próximo intervalo
            }
        }
        await Modal.alert('Sessão encerrada', 'Não foi possível reconectar à sessão.');
        await this.leaveParty(false);
    }

    _closeSocket() {
        if (this.socketUnsubscribe) this.socketUnsubscribe();
        this.socketUnsubscribe = null;
        this.socket?.close();
        this.socket = null;
    }

    _applyPartySnapshot(snapshot) {
        if (!snapshot?.party) return;
        this.currentParty = snapshot.party;
        this.members = Array.isArray(snapshot.members) ? snapshot.members : this.members || [];
        this.messages = Array.isArray(snapshot.messages) ? snapshot.messages : this.messages || [];
        this.requests = Array.isArray(snapshot.requests) ? snapshot.requests : this.requests || [];
        if (snapshot.memberId) this.memberId = snapshot.memberId;
        if (typeof snapshot.isHost === 'boolean') this.isHost = snapshot.isHost;
    }

    async _handleSocketMessage(message) {
        if (!message || this.isLeaving) return;

        if (message.type === 'snapshot') {
            this._applyPartySnapshot(message);
            this.renderPartyUI();
            await this.loadInitialData(this.currentParty?.id);
            return;
        }

        if (message.type === 'party' && message.party) {
            this.currentParty = message.party;
            if (!this.isHost) await this.syncWithHost(message.party);
            this.updatePartyHeader();
            return;
        }

        if (message.type === 'members' && Array.isArray(message.members)) {
            this.members = message.members;
            this.renderMembers();
            this.renderTypingIndicator();
            this.updatePartyHeader();
            this.showPartyIndicator();
            return;
        }

        if (message.type === 'message' && message.message) {
            this.messages.push(message.message);
            this.messages = this.messages.slice(-100);
            this.addChatMessage(message.message);
            return;
        }

        if (message.type === 'requests' && Array.isArray(message.requests)) {
            this.requests = message.requests;
            this.renderRequests();
            return;
        }

        if (message.type === 'ended') {
            await Modal.alert('Sessão encerrada', 'O anfitrião encerrou a sessão de escuta.');
            await this.leaveParty(false);
        }
    }

    _getGuestMemberId(partyId) {
        try {
            return localStorage.getItem(this._guestMemberKey(partyId)) || null;
        } catch (_e) {
            return null;
        }
    }

    _rememberGuestMember(partyId, memberId) {
        try {
            localStorage.setItem(this._guestMemberKey(partyId), memberId);
        } catch (_e) {}
    }

    _forgetGuestMember(partyId) {
        try {
            localStorage.removeItem(this._guestMemberKey(partyId));
        } catch (_e) {}
    }

    async findExistingMember(partyId) {
        const cachedId = this._getGuestMemberId(partyId);
        return cachedId ? { id: cachedId } : null;
    }

    async getMemberProfile(pbUser = null) {
        if (this.memberId && Array.isArray(this.members)) {
            const me = this.members.find((m) => m.id === this.memberId);
            if (me?.name) return { name: me.name, avatar_url: me.avatar_url };
        }

        const user = authManager.user;
        if (user) {
            if (this._hasProfileName(pbUser)) {
                const name = pbUser.display_name?.trim() || pbUser.username?.trim();
                const avatar =
                    pbUser?.avatar_url || `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(name)}`;
                return { name, avatar_url: avatar };
            }
            const stored = this._getStoredUserProfile(user.$id);
            if (stored?.name) return stored;
            return {
                name: 'Membro',
                avatar_url: pbUser?.avatar_url || `https://api.dicebear.com/9.x/identicon/svg?seed=Member`,
            };
        }
        const cached = localStorage.getItem('party_guest_profile');
        return cached
            ? JSON.parse(cached)
            : { name: 'Convidado', avatar_url: 'https://api.dicebear.com/9.x/identicon/svg?seed=Convidado' };
    }

    setupSubscriptions(partyId) {
        this.unsubscribeFunctions.forEach((unsub) => unsub());
        this.unsubscribeFunctions = [];
        this._connectSocket();
    }

    async loadInitialData(_partyId) {
        if (this.maintenanceMode) return;
        await this.loadMembers();
        await this.loadMessages();
        await this.loadRequests();
    }

    async loadMembers() {
        if (this.maintenanceMode || !this.currentParty) return;
        this.renderMembers();
        this.renderTypingIndicator();
        this.updatePartyHeader();
    }

    _pingTyping() {
        if (!this.memberId || !this.currentParty) return;
        const now = Date.now();
        const lastPing = this._lastTypingPing || 0;
        if (now - lastPing < 1500) return;
        this._lastTypingPing = now;
        this.socket?.send('typing', { typing_until: now + 3000 }).catch(() => {});
    }

    _clearTyping() {
        if (!this.memberId || !this.currentParty) return;
        if ((this._lastTypingPing || 0) === 0) return;
        this._lastTypingPing = 0;
        this.socket?.send('typing', { typing_until: 0 }).catch(() => {});
    }

    renderTypingIndicator() {
        const el = document.getElementById('party-typing-indicator');
        const textEl = el?.querySelector('.party-typing-text');
        if (!el || !textEl) return;

        const now = Date.now();
        const typing = (this.members || []).filter(
            (m) => m.id !== this.memberId && typeof m.typing_until === 'number' && m.typing_until > now
        );

        clearTimeout(this._typingExpireTimer);

        if (!typing.length) {
            el.hidden = true;
            textEl.textContent = '';
            return;
        }

        let text;
        if (typing.length === 1) text = `${typing[0].name} está digitando…`;
        else if (typing.length === 2) text = `${typing[0].name} e ${typing[1].name} estão digitando…`;
        else text = `${typing[0].name} e mais ${typing.length - 1} estão digitando…`;
        textEl.textContent = text;
        el.hidden = false;

        const earliestExpiry = Math.min(...typing.map((m) => m.typing_until));
        const delay = Math.max(50, earliestExpiry - now + 50);
        this._typingExpireTimer = setTimeout(() => this.renderTypingIndicator(), delay);
    }

    async loadMessages() {
        const container = document.getElementById('party-chat-messages');
        if (container) {
            container.innerHTML = '';
            this.messages.forEach((m) => this.addChatMessage(m));
        }
    }

    async loadRequests() {
        if (this.maintenanceMode || !this.currentParty) return;
        this.renderRequests();
    }

    renderPartyUI() {
        this.updatePartyHeader();
        this.renderMembers();
        this.renderRequests();
        this.showPartyIndicator();
        if (this.isHost) {
            this.unlockControls();
            this.setupHostPlayerSync();
        } else {
            this.lockControls();
            this.setupGuestPlayerInterferenceCheck();
        }
    }

    updatePartyHeader() {
        const titleEl = document.getElementById('party-title');
        const countEl = document.getElementById('party-member-count');
        const metaEl = document.getElementById('party-meta');

        if (titleEl) titleEl.textContent = this.currentParty.name;
        if (countEl) countEl.textContent = this.members.length;

        if (metaEl) {
            const hostMember = (this.members || []).find((m) => m.is_host);
            const hostRecord = this.currentParty.expand?.host;
            const hostName =
                hostMember?.name?.trim() ||
                hostRecord?.display_name?.trim() ||
                hostRecord?.username?.trim() ||
                'Desconhecido';
            metaEl.textContent = `Anfitrião: ${hostName}`;
        }

        const track = this.currentParty.current_track;
        const display = document.getElementById('party-current-track-display');
        if (display) {
            if (track) {
                const api = Player.instance.api;
                const coverUrl = api.getCoverUrl(track.artwork || track.cover || track.album?.cover);
                display.innerHTML = `
                    <div class="party-now-playing">
                        <img crossorigin="anonymous" referrerpolicy="no-referrer" src="${escapeHtml(coverUrl)}" class="party-now-playing-cover" alt="">
                        <div class="party-now-playing-info">
                            <div class="party-now-playing-title">${escapeHtml(track.title || '')}</div>
                            <div class="party-now-playing-artist">${escapeHtml(getTrackArtists(track) || '')}</div>
                        </div>
                        ${
                            !this.currentParty.is_playing
                                ? `<div class="party-now-playing-paused">${SVG_PAUSE(20)} Pausada</div>`
                                : ''
                        }
                    </div>
                `;
            } else {
                display.innerHTML = `
                    <div class="party-now-playing-empty">
                        <div>Waiting for host to play music...</div>
                    </div>
                `;
            }
        }
    }

    renderMembers() {
        const list = document.getElementById('party-members-list');
        if (!list) return;
        list.innerHTML = this.members
            .map(
                (m) =>
                    `<div class="member-item" style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem; background: var(--background-secondary); border-radius: var(--radius); border: 1px solid var(--border)"><img crossorigin="anonymous" referrerpolicy="no-referrer" src="${escapeHtml(m.avatar_url || '')}" style="width: 40px; height: 40px; border-radius: 50%; background: var(--background-modifier-accent)"><div style="flex: 1; overflow: hidden"><div style="font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${escapeHtml(m.name || '')}</div>${m.is_host ? '<div style="color: var(--primary); font-size: 0.7rem; font-weight: bold; text-transform: uppercase;">Anfitrião</div>' : '<div style="color: var(--muted-foreground); font-size: 0.7rem">Ouvindo</div>'}</div></div>`
            )
            .join('');
    }

    renderRequests() {
        const list = document.getElementById('party-requests-list');
        if (!list) return;
        if (this.requests.length === 0) {
            list.innerHTML = `<div style="padding: 2rem; text-align: center; color: var(--muted-foreground); font-size: 0.9rem">Nenhum pedido ainda. Clique com o botão direito em uma música e escolha "Pedir música"!</div>`;
            return;
        }

        list.innerHTML = this.requests
            .map((r) => {
                try {
                    const api = Player.instance.api;
                    const artists = getTrackArtists(r.track);
                    const coverUrl = api.getCoverUrl(r.track.artwork || r.track.cover || r.track.album?.cover);
                    return `<div class="track-item" style="display: flex; align-items: center; gap: 1rem; padding: 0.75rem; border-bottom: 1px solid var(--border)">
                    <img crossorigin="anonymous" referrerpolicy="no-referrer" src="${escapeHtml(coverUrl)}" style="width: 48px; height: 48px; border-radius: 4px; object-fit: cover; flex-shrink: 0;">
                    <div class="track-info" style="flex: 1; min-width: 0;">
                        <div class="track-title" style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(r.track.title || 'Título desconhecido')}</div>
                        <div class="track-artist" style="font-size: 0.8rem; color: var(--muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(artists || '')} • Pedido por ${escapeHtml(r.requested_by || 'Membro')}</div>
                    </div>
                    ${this.isHost ? `<button class="btn-primary btn-sm add-request-btn" data-req-id="${r.id}" style="padding: 0.4rem 1rem; font-size: 0.8rem; flex-shrink: 0; white-space: nowrap;">Adicionar à fila</button>` : ''}
                </div>`;
                } catch (_e) {
                    return '';
                }
            })
            .join('');

        if (this.isHost) {
            list.querySelectorAll('.add-request-btn').forEach((btn) =>
                btn.addEventListener('click', async (e) => {
                    const reqId = e.currentTarget.dataset.reqId;
                    const req = this.requests.find((r) => r.id === reqId);
                    if (req) {
                        Player.instance.addToQueue(req.track);
                        showNotification(`"${req.track.title}" adicionada à fila`);
                        await this.socket?.send('request:remove', { requestId: req.id });
                    }
                })
            );
        }
    }

    addChatMessage(msg) {
        const container = document.getElementById('party-chat-messages');
        if (!container) return;
        const div = document.createElement('div');
        div.className = 'chat-msg';

        const urlRegex = /(https?:\/\/[^\s]+)/g;
        let content = escapeHtml(msg.content);

        content = content.replace(urlRegex, (url) => {
            if (url.match(/\.(jpeg|jpg|gif|png|webp|svg)(\?.*)?$/i)) {
                return `<a href="${url}" target="_blank" class="chat-link">${url}</a><img crossorigin="anonymous" referrerpolicy="no-referrer" src="${url}" style="max-width: 100%; border-radius: 8px; margin-top: 8px; display: block; cursor: pointer" onclick="window.open('${url}')">`;
            }
            const ytMatch = url.match(
                /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/i
            );
            if (ytMatch) {
                return `<a href="${url}" target="_blank" class="chat-link">${url}</a><iframe style="width: 100%; aspect-ratio: 16/9; border-radius: 8px; margin-top: 8px; border: none" src="https://www.youtube.com/embed/${ytMatch[1]}" allowfullscreen></iframe>`;
            }
            if (url.match(/\.(mp4|webm|ogg)(\?.*)?$/i)) {
                return `<a href="${url}" target="_blank" class="chat-link">${url}</a><video controls style="max-width: 100%; border-radius: 8px; margin-top: 8px; display: block"><source src="${url}"></video>`;
            }
            if (url.includes('tenor.com/view/')) {
                return `<a href="${url}" target="_blank" class="chat-link">${url}</a><div class="tenor-embed" data-postid="${url.split('-').pop()}" data-share-method="host" data-aspect-ratio="1" data-width="100%"><script type="text/javascript" async src="https://tenor.com/embed.js"></script></div>`;
            }
            return `<a href="${url}" target="_blank" class="chat-link" style="color: var(--primary); text-decoration: underline;">${url}</a>`;
        });

        div.innerHTML = `
            <div style="font-weight: 600; font-size: 0.75rem; color: var(--primary); margin-bottom: 2px">${escapeHtml(msg.sender_name)}</div>
            <div style="background: var(--background-modifier-accent); padding: 0.6rem 0.8rem; border-radius: 0.75rem; display: inline-block; max-width: 100%; word-break: break-word; font-size: 0.9rem; line-height: 1.4">
                ${content}
            </div>
        `;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }

    async sendChatMessage() {
        if (this.maintenanceMode) {
            await Modal.alert('Sessões desativadas', this.maintenanceMessage);
            return;
        }
        const input = document.getElementById('party-chat-input');
        if (!input || !input.value.trim()) return;
        const content = input.value.trim();
        input.value = '';
        this._clearTyping();
        try {
            await this.socket?.send('chat', { content });
        } catch (_e) {}
    }

    async requestSong(track) {
        if (this.maintenanceMode) {
            showNotification('As sessões estão temporariamente indisponíveis');
            return;
        }
        if (!this.currentParty) return;
        try {
            const minifiedTrack = syncManager._minifyItem('track', track);
            await this.socket?.send('request', { track: minifiedTrack });
            showNotification(`Pedido enviado: "${track.title}"`);
        } catch (e) {
            console.error('Request error:', e);
        }
    }

    async syncWithHost(party, attempt = 0) {
        // Se uma sincronização anterior travou (por exemplo, esperando um áudio que nunca veio), não bloqueia as próximas
        if (this.isInternalSync && Date.now() - (this._syncStartedAt || 0) < 25000) return;
        this.isInternalSync = true;
        this._syncStartedAt = Date.now();
        let needsRetry = false;
        try {
            const player = Player.instance;
            const el = player.activeElement;
            if (!party.current_track) {
                if (player.currentTrack) el.pause();
                return;
            }

            const currentId = String(player.currentTrack?.id || '');
            const targetId = String(party.current_track.id || '');
            const hasSource = !!(el.currentSrc || el.src);

            if (currentId !== targetId || !hasSource || el.error) {
                console.info(`[Grupo] carregando a faixa do host (${targetId}), tentativa ${attempt + 1}`);
                const cleanedTrack = { ...party.current_track };
                if (!cleanedTrack.isTracker) {
                    delete cleanedTrack.audioUrl;
                    delete cleanedTrack.streamUrl;
                    delete cleanedTrack.remoteUrl;
                }
                // Tempo do host agora (o estado pode ter ficado velho enquanto a faixa carregava)
                const latency = party.is_playing ? (Date.now() - party.playback_timestamp) / 1000 : 0;
                player.setQueue([cleanedTrack], 0);
                await player.playTrackFromQueue(Math.max(0, party.playback_time + latency));
                if (!party.is_playing) el.pause();

                // Conferência: a faixa certa carregou de verdade? Se não, tenta de novo (até 3 vezes)
                const loaded = String(player.currentTrack?.id || '') === targetId && !!(el.currentSrc || el.src) && !el.error;
                console.info(`[Grupo] faixa do host ${loaded ? 'carregada' : 'NÃO carregou'}`);
                if (!loaded && attempt < 2) needsRetry = true;
                return;
            }

            if (party.is_playing) {
                if (el.paused) {
                    const started = await player.safePlay(el);
                    if (started === false) {
                        this.promptForGesture();
                        return;
                    }
                }
                if (el.readyState < 3) return; // ainda carregando: não mexe na posição

                // Onde o host está agora, no relógio deste aparelho
                const latency = (Date.now() - party.playback_timestamp) / 1000;
                const target = party.playback_time + latency;
                const drift = target - el.currentTime; // positivo: este aparelho está atrasado
                const size = Math.abs(drift);
                const now = Date.now();

                // O destino já está carregado? Então o pulo é instantâneo, sem esperar o servidor
                const alvo = target + 0.4;
                let carregado = false;
                for (let i = 0; i < el.buffered.length; i++) {
                    if (alvo >= el.buffered.start(i) && alvo <= el.buffered.end(i) - 0.5) carregado = true;
                }
                if ((size > 6 || (size > 2 && carregado)) && now - (this._lastSeekAt || 0) > 8000) {
                    // Longe do host: um único pulo, e depois espera a reprodução se acomodar (sem pular de novo e de novo)
                    this._lastSeekAt = now;
                    el.playbackRate = 1;
                    el.currentTime = target + 0.4;
                } else if (size > 1.5) {
                    el.playbackRate = drift > 0 ? 1.08 : 0.92; // alcança/espera aos poucos, sem cortar o som
                } else if (size > 0.4) {
                    el.playbackRate = drift > 0 ? 1.04 : 0.96;
                } else if (el.playbackRate !== 1) {
                    el.playbackRate = 1;
                }
            } else {
                if (el.playbackRate !== 1) el.playbackRate = 1;
                if (!el.paused) el.pause();
                if (Math.abs(el.currentTime - party.playback_time) > 0.5) el.currentTime = party.playback_time;
            }
        } catch (e) {
            console.error('Sync error:', e);
            if (attempt < 2) needsRetry = true;
        } finally {
            this.isInternalSync = false;
        }
        if (needsRetry) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            if (this.currentParty && !this.isHost) await this.syncWithHost(this.currentParty, attempt + 1);
        }
    }

    /** O navegador só deixa o som começar depois de um toque na página: avisa e tenta de novo no primeiro toque. */
    promptForGesture() {
        if (this._gesturePrompted) return;
        this._gesturePrompted = true;
        showNotification('Toque na tela para começar a ouvir junto');
        document.addEventListener(
            'pointerdown',
            () => {
                this._gesturePrompted = false;
                if (this.currentParty && !this.isHost) void this.syncWithHost(this.currentParty);
            },
            { once: true, capture: true }
        );
    }

    lockControls() {
        const selectors = [
            '.play-pause-btn',
            '#next-btn',
            '#prev-btn',
            '#shuffle-btn',
            '#repeat-btn',
            '#progress-bar',
            '#fs-play-pause-btn',
            '#fs-next-btn',
            '#fs-prev-btn',
            '#fs-shuffle-btn',
            '#fs-repeat-btn',
            '#fs-progress-bar',
        ];
        selectors.forEach((s) =>
            document.querySelectorAll(s).forEach((el) => {
                el.style.opacity = '0.5';
                el.style.pointerEvents = 'none';
            })
        );
    }

    unlockControls() {
        try {
            Player.instance.activeElement.playbackRate = 1;
        } catch (_e) {
            // player ainda não existe
        }
        const selectors = [
            '.play-pause-btn',
            '#next-btn',
            '#prev-btn',
            '#shuffle-btn',
            '#repeat-btn',
            '#progress-bar',
            '#fs-play-pause-btn',
            '#fs-next-btn',
            '#fs-prev-btn',
            '#fs-shuffle-btn',
            '#fs-repeat-btn',
            '#fs-progress-bar',
        ];
        selectors.forEach((s) =>
            document.querySelectorAll(s).forEach((el) => {
                el.style.opacity = '1';
                el.style.pointerEvents = 'auto';
            })
        );
    }

    setupHostPlayerSync() {
        this.teardownHostPlayerSync(); // evita acumular ouvintes e temporizadores a cada renderização da tela
        const player = Player.instance;
        const updateParty = async () => {
            if (!this.currentParty || !this.isHost || this.isInternalSync) return;
            // Enquanto uma faixa carrega, o player passa por estados falsos (pausado, posição 0). Mandar isso fazia
            // os convidados pararem e voltarem ao início.
            if (player.isLoadingTrack) return;
            const el = player.activeElement;
            if (!el || !(el.currentSrc || el.src)) return;
            const sharedTrack = player.currentTrack ? syncManager._minifyItem('track', player.currentTrack) : null;
            try {
                await this.socket?.send('playback', {
                    current_track: sharedTrack,
                    is_playing: !el.paused,
                    playback_time: el.currentTime,
                    playback_timestamp: Date.now(),
                    queue: player.queue?.map((t) => syncManager._minifyItem('track', t)) || [],
                });
            } catch (_e) {}
        };
        const targets = [player.audio, player.video].filter(Boolean);
        const events = ['play', 'pause', 'seeked'];
        targets.forEach((t) => events.forEach((ev) => t.addEventListener(ev, updateParty)));
        if (!this.originalPlayTrackFromQueue) this.originalPlayTrackFromQueue = player.playTrackFromQueue.bind(player);
        const originalPlayTrackFromQueue = this.originalPlayTrackFromQueue;
        player.playTrackFromQueue = async (...args) => {
            const result = await originalPlayTrackFromQueue(...args);
            if (!this.isInternalSync) await updateParty();
            return result;
        };
        this.syncInterval = setInterval(updateParty, 2000);
        this._hostSync = { targets, events, updateParty };
    }

    teardownHostPlayerSync() {
        clearInterval(this.syncInterval);
        this.syncInterval = null;
        const sync = this._hostSync;
        if (!sync) return;
        sync.targets.forEach((t) => sync.events.forEach((ev) => t.removeEventListener(ev, sync.updateParty)));
        this._hostSync = null;
    }

    setupGuestPlayerInterferenceCheck() {
        const player = Player.instance;
        if (!this.originalPlayTrackFromQueue) this.originalPlayTrackFromQueue = player.playTrackFromQueue.bind(player);
        const originalPlayTrackFromQueue = this.originalPlayTrackFromQueue;
        player.playTrackFromQueue = async (...args) => {
            if (this.currentParty && !this.isHost && !this.isInternalSync) {
                const leave = await Modal.confirm(
                    'Sair da sessão?',
                    'Tocar uma música vai tirar você da sessão de escuta. Tem certeza?',
                    'Sair e tocar',
                    'danger'
                );
                if (!leave) return;
                await this.leaveParty();
            }
            return await originalPlayTrackFromQueue(...args);
        };
    }

    startHeartbeat() {
        this.heartbeatInterval = setInterval(async () => {
            if (!this.memberId) return;
            try {
                await this.socket?.send('heartbeat');
            } catch (_e) {}
        }, 30000);
    }

    async leaveParty(shouldCleanup = true) {
        if (this.isLeaving) return;
        this.isLeaving = true;

        const partyIdForCleanup = this.currentParty?.id;

        try {
            if (this.isHost && shouldCleanup) {
                const end = await Modal.confirm(
                    'Encerrar a sessão?',
                    'Sair vai encerrar a sessão para todos. Tem certeza?',
                    'Encerrar sessão',
                    'danger'
                );
                if (!end) {
                    this.isLeaving = false;
                    return;
                }
                await this.socket?.send('leave', { end: true }).catch(() => {});
            } else if (this.memberId) {
                await this.socket?.send('leave', { end: false }).catch(() => {});
            }
        } finally {
            this.restorePlayerMethods();
            this.unlockControls();
            this.unsubscribeFunctions.forEach((unsub) => unsub());
            this.unsubscribeFunctions = [];
            this.teardownHostPlayerSync();
            clearInterval(this.heartbeatInterval);
            clearTimeout(this._typingExpireTimer);
            this._typingExpireTimer = null;
            this._lastTypingPing = 0;
            const typingEl = document.getElementById('party-typing-indicator');
            if (typingEl) typingEl.hidden = true;
            if (partyIdForCleanup) {
                this._forgetGuestMember(partyIdForCleanup);
                this._forgetHostToken(partyIdForCleanup);
            }
            this._closeSocket();
            this.currentParty = null;
            this.isHost = false;
            this.memberId = null;
            this.hidePartyIndicator();
            this.isLeaving = false;
            navigate('/parties');
        }
    }

    restorePlayerMethods() {
        const player = Player.instance;
        if (this.originalSafePlay) {
            player.safePlay = this.originalSafePlay;
            this.originalSafePlay = null;
        }
        if (this.originalPlayTrackFromQueue) {
            player.playTrackFromQueue = this.originalPlayTrackFromQueue;
            this.originalPlayTrackFromQueue = null;
        }
    }

    copyInviteLink() {
        if (!this.currentParty) return;
        navigator.clipboard.writeText(`${window.location.origin}/party/${this.currentParty.id}`).catch(console.error);
        showNotification('Link de convite copiado!');
    }

    showPartyIndicator() {
        const btn = document.getElementById('now-playing-party-btn');
        if (!btn || !this.currentParty) return;
        btn.style.display = '';
        const name = this.currentParty.name || 'Sessão de escuta';
        const count = this.members.length;
        const tooltip = `${name} (${count} listener${count === 1 ? '' : 's'})`;
        btn.title = tooltip;
        btn.setAttribute('aria-label', `Open listening party: ${tooltip}`);
        if (!btn.dataset.partyHandlerBound) {
            btn.addEventListener('click', () => {
                if (this.currentParty) navigate(`/party/${this.currentParty.id}`);
            });
            btn.dataset.partyHandlerBound = '1';
        }
    }

    hidePartyIndicator() {
        const btn = document.getElementById('now-playing-party-btn');
        if (!btn) return;
        btn.style.display = 'none';
        btn.removeAttribute('title');
        btn.setAttribute('aria-label', 'Abrir sessão de escuta');
    }
}

export const partyManager = new ListeningPartyManager();
