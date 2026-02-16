/// <reference types="@cloudflare/workers-types" />
/**
 * Cloudflare Durable Object for the real-time game lobby.
 *
 * Lobby clients (WelcomeScreen) connect via WebSocket and receive
 * instant updates whenever rooms are created, deleted, or their
 * player counts change.
 *
 * GameRoom DOs and the rooms API notify this DO via HTTP POST
 * whenever relevant state changes.
 */

export interface LobbyRoomInfo {
  id: string;
  name: string;
  playerCount: number;
  createdAt: number;
  createdBy: string;
  puzzleProgress?: number;
  wave?: number;
  isPrivate?: boolean;
  phase?: 'lobby' | 'playing' | 'ended';
}

export interface ArchivedRoomInfo {
  id: string;
  name: string;
  endedAt: number;
  duration: number;
  finalWave: number;
  finalPuzzleProgress: number;
  players: Array<{ id: string; username: string; score: number; }>;
  /** Discord user IDs of players who participated */
  playerIds: string[];
  /** Complete event log from the game session */
  eventLog?: Array<{ time: number; event: string; actor?: string; detail?: string; }>;
}

export class GameLobby implements DurableObject {
  private state: DurableObjectState;
  private env: Record<string, unknown> = {};

  /** Current snapshot of all active rooms */
  private rooms: Map<string, LobbyRoomInfo> = new Map();

  /** Archived (ended) rooms, keyed by room ID */
  private archivedRooms: Map<string, ArchivedRoomInfo> = new Map();

  /** Max archived rooms to keep */
  private static readonly MAX_ARCHIVED = 50;

  /** Active admin detail subscriptions: roomId -> alarm interval handle */
  private adminDetailInterval: ReturnType<typeof setInterval> | null = null;

  /** Room IDs that admin clients are subscribed to for detail */
  private adminSubscribedRooms: Set<string> = new Set();

  /** Whether admin clients want auto-polling of ALL rooms */
  private adminAutoSubscribeAll: boolean = false;

  /** Admin detail refresh rate (ms) */
  private static readonly ADMIN_DETAIL_INTERVAL = 2000;

  constructor(state: DurableObjectState, env: Record<string, unknown>) {
    this.state = state;
    this.env = env;

    // Restore persisted room list
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<LobbyRoomInfo[]>('rooms');
      if (stored) {
        for (const room of stored) {
          this.rooms.set(room.id, room);
        }
      }
      const storedArchived = await this.state.storage.get<ArchivedRoomInfo[]>('archivedRooms');
      if (storedArchived) {
        for (const room of storedArchived) {
          this.archivedRooms.set(room.id, room);
        }
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // ── WebSocket upgrade (lobby clients + admin clients) ──
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];

      const isAdmin = url.searchParams.get('admin') === '1';
      const tags = isAdmin ? ['admin'] : ['lobby'];
      this.state.acceptWebSocket(server, tags);

      try {
        if (isAdmin) {
          // Admin gets ALL rooms (including private) + archived + lobby stats
          server.send(JSON.stringify({
            type: 'admin-rooms',
            rooms: Array.from(this.rooms.values()),
            archivedRooms: Array.from(this.archivedRooms.values()),
            lobbyClients: this.state.getWebSockets('lobby').length,
            kvKeyCount: this.rooms.size,
            fetchedAt: Date.now()
          }));
        } else {
          // Regular lobby client: only public rooms
          const publicRooms = Array.from(this.rooms.values()).filter(r => !r.isPrivate);
          server.send(JSON.stringify({
            type: 'rooms',
            rooms: publicRooms
          }));
          server.send(JSON.stringify({
            type: 'archived-rooms',
            rooms: Array.from(this.archivedRooms.values())
          }));
        }
      } catch {
        // Client may have disconnected immediately
      }

      // Start admin detail polling if we have admin clients and subscriptions
      this.maybeStartAdminPolling();

      return new Response(null, { status: 101, webSocket: client });
    }

    // ── HTTP: room state updates from GameRoom / rooms API ──
    if (url.pathname === '/room-update' && request.method === 'POST') {
      const body = await request.json() as {
        action: 'upsert' | 'delete' | 'archive';
        room?: LobbyRoomInfo;
        roomId?: string;
        archivedRoom?: ArchivedRoomInfo;
      };

      if (body.action === 'upsert' && body.room) {
        this.rooms.set(body.room.id, body.room);
      } else if (body.action === 'delete' && body.roomId) {
        this.rooms.delete(body.roomId);
      } else if (body.action === 'archive' && body.archivedRoom) {
        // Remove from active rooms, add to archived
        this.rooms.delete(body.archivedRoom.id);
        this.archivedRooms.set(body.archivedRoom.id, body.archivedRoom);

        // Trim old archived rooms if over limit
        if (this.archivedRooms.size > GameLobby.MAX_ARCHIVED) {
          const sorted = Array.from(this.archivedRooms.entries())
            .sort((a, b) => a[1].endedAt - b[1].endedAt);
          while (this.archivedRooms.size > GameLobby.MAX_ARCHIVED) {
            const oldest = sorted.shift();
            if (oldest) this.archivedRooms.delete(oldest[0]);
          }
        }

        await this.persistArchivedRooms();
      }

      // Persist and broadcast
      await this.persistRooms();
      this.broadcastRooms();
      if (body.action === 'archive') {
        this.broadcastArchivedRooms();
      }

      return Response.json({ ok: true });
    }

    // ── HTTP: admin status (all rooms + archived, for superadmin page) ──
    if (url.pathname === '/admin-status') {
      return Response.json({
        rooms: Array.from(this.rooms.values()),
        archivedRooms: Array.from(this.archivedRooms.values()),
        connectedClients: this.state.getWebSockets().length
      });
    }

    // ── HTTP: get rooms (fallback for non-WS clients) ──
    if (url.pathname === '/rooms') {
      return Response.json({ rooms: Array.from(this.rooms.values()) });
    }

    return new Response('GameLobby DO', { status: 200 });
  }

  // ── Hibernation-compatible WebSocket handlers ──

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;

    try {
      const msg = JSON.parse(message) as {
        type: string;
        roomId?: string;
      };

      const tags = this.state.getTags(ws);
      if (!tags.includes('admin')) return; // Only admin clients send messages

      if (msg.type === 'subscribe-all') {
        // Admin wants real-time detail for ALL active rooms
        this.adminAutoSubscribeAll = true;
        // Fetch details for all rooms immediately
        await this.fetchAndBroadcastAllRoomDetails();
        this.maybeStartAdminPolling();
      } else if (msg.type === 'unsubscribe-all') {
        this.adminAutoSubscribeAll = false;
        if (this.adminSubscribedRooms.size === 0) {
          this.maybeStopAdminPolling();
        }
      } else if (msg.type === 'subscribe-room' && msg.roomId) {
        this.adminSubscribedRooms.add(msg.roomId);
        // Fetch detail immediately for the requested room
        await this.fetchAndSendRoomDetail(msg.roomId);
        this.maybeStartAdminPolling();
      } else if (msg.type === 'unsubscribe-room' && msg.roomId) {
        this.adminSubscribedRooms.delete(msg.roomId);
        if (this.adminSubscribedRooms.size === 0) {
          this.maybeStopAdminPolling();
        }
      } else if (msg.type === 'refresh') {
        // Admin requests a full refresh of all data
        this.sendAdminSnapshot(ws);
      }
    } catch {
      // Ignore malformed messages
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try { ws.close(); } catch { /* already closed */ }
    // If the last admin disconnects, stop polling
    const adminSockets = this.state.getWebSockets('admin');
    if (adminSockets.length === 0) {
      this.adminSubscribedRooms.clear();
      this.adminAutoSubscribeAll = false;
      this.maybeStopAdminPolling();
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  // ── Helpers ──

  private broadcastRooms(): void {
    // Broadcast public rooms to lobby clients
    const publicRooms = Array.from(this.rooms.values()).filter(r => !r.isPrivate);
    const lobbyPayload = JSON.stringify({
      type: 'rooms',
      rooms: publicRooms
    });
    for (const ws of this.state.getWebSockets('lobby')) {
      try {
        ws.send(lobbyPayload);
      } catch {
        // Dead socket – Cloudflare will clean it up
      }
    }

    // Broadcast ALL rooms to admin clients
    const adminPayload = JSON.stringify({
      type: 'admin-rooms',
      rooms: Array.from(this.rooms.values()),
      archivedRooms: Array.from(this.archivedRooms.values()),
      lobbyClients: this.state.getWebSockets('lobby').length,
      kvKeyCount: this.rooms.size,
      fetchedAt: Date.now()
    });
    for (const ws of this.state.getWebSockets('admin')) {
      try {
        ws.send(adminPayload);
      } catch { /* dead */ }
    }
  }

  private broadcastArchivedRooms(): void {
    const payload = JSON.stringify({
      type: 'archived-rooms',
      rooms: Array.from(this.archivedRooms.values())
    });
    for (const ws of this.state.getWebSockets('lobby')) {
      try {
        ws.send(payload);
      } catch {
        // Dead socket
      }
    }
    // Admin clients already get archived rooms in broadcastRooms()
  }

  private async persistRooms(): Promise<void> {
    await this.state.storage.put('rooms', Array.from(this.rooms.values()));
  }

  private async persistArchivedRooms(): Promise<void> {
    await this.state.storage.put('archivedRooms', Array.from(this.archivedRooms.values()));
  }

  // ── Admin real-time detail helpers ──

  private sendAdminSnapshot(ws: WebSocket): void {
    try {
      ws.send(JSON.stringify({
        type: 'admin-rooms',
        rooms: Array.from(this.rooms.values()),
        archivedRooms: Array.from(this.archivedRooms.values()),
        lobbyClients: this.state.getWebSockets('lobby').length,
        kvKeyCount: this.rooms.size,
        fetchedAt: Date.now()
      }));
    } catch { /* dead socket */ }
  }

  private maybeStartAdminPolling(): void {
    if (this.adminDetailInterval) return;
    const adminSockets = this.state.getWebSockets('admin');
    if (adminSockets.length === 0) return;
    if (!this.adminAutoSubscribeAll && this.adminSubscribedRooms.size === 0) return;

    this.adminDetailInterval = setInterval(() => {
      this.pollAdminDetails();
    }, GameLobby.ADMIN_DETAIL_INTERVAL);

    // Also poll immediately
    this.pollAdminDetails();
  }

  private maybeStopAdminPolling(): void {
    if (this.adminDetailInterval) {
      clearInterval(this.adminDetailInterval);
      this.adminDetailInterval = null;
    }
  }

  private async pollAdminDetails(): Promise<void> {
    const adminSockets = this.state.getWebSockets('admin');
    if (adminSockets.length === 0) {
      this.maybeStopAdminPolling();
      return;
    }

    if (this.adminAutoSubscribeAll) {
      // Poll ALL active rooms
      await this.fetchAndBroadcastAllRoomDetails();
    } else {
      // Poll only explicitly subscribed rooms
      for (const roomId of this.adminSubscribedRooms) {
        await this.fetchAndSendRoomDetail(roomId);
      }
    }
  }

  private async fetchAndBroadcastAllRoomDetails(): Promise<void> {
    const adminSockets = this.state.getWebSockets('admin');
    if (adminSockets.length === 0) return;

    const gameRoomNs = this.env.GAME_ROOM as DurableObjectNamespace | undefined;
    if (!gameRoomNs) return;

    const allDetails: Record<string, unknown> = {};

    for (const [roomId] of this.rooms) {
      try {
        const doId = gameRoomNs.idFromName(roomId);
        const room = gameRoomNs.get(doId);
        const response = await room.fetch('https://internal/admin-detail');
        allDetails[roomId] = await response.json();
      } catch (e) {
        allDetails[roomId] = { error: String(e) };
      }
    }

    const payload = JSON.stringify({
      type: 'admin-all-details',
      details: allDetails,
      fetchedAt: Date.now()
    });

    for (const ws of adminSockets) {
      try {
        ws.send(payload);
      } catch { /* dead socket */ }
    }
  }

  private async fetchAndSendRoomDetail(roomId: string): Promise<void> {
    const adminSockets = this.state.getWebSockets('admin');
    if (adminSockets.length === 0) return;

    try {
      const gameRoomNs = this.env.GAME_ROOM as DurableObjectNamespace | undefined;
      if (!gameRoomNs) return;

      const doId = gameRoomNs.idFromName(roomId);
      const room = gameRoomNs.get(doId);
      const response = await room.fetch('https://internal/admin-detail');
      const detail = await response.json();

      const payload = JSON.stringify({
        type: 'room-detail',
        roomId,
        detail,
        fetchedAt: Date.now()
      });

      for (const ws of adminSockets) {
        try {
          ws.send(payload);
        } catch { /* dead socket */ }
      }
    } catch (e) {
      // Room may no longer exist — notify admins
      const errPayload = JSON.stringify({
        type: 'room-detail-error',
        roomId,
        error: String(e)
      });
      for (const ws of adminSockets) {
        try {
          ws.send(errPayload);
        } catch { /* dead socket */ }
      }
    }
  }
}
