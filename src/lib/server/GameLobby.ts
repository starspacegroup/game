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
}

export class GameLobby implements DurableObject {
  private state: DurableObjectState;

  /** Current snapshot of all active rooms */
  private rooms: Map<string, LobbyRoomInfo> = new Map();

  /** Archived (ended) rooms, keyed by room ID */
  private archivedRooms: Map<string, ArchivedRoomInfo> = new Map();

  /** Max archived rooms to keep */
  private static readonly MAX_ARCHIVED = 50;

  constructor(state: DurableObjectState) {
    this.state = state;

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

    // ── WebSocket upgrade (lobby clients) ──
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.state.acceptWebSocket(server);

      // Send current room list and archived rooms immediately
      // Only send public rooms to lobby clients
      try {
        const publicRooms = Array.from(this.rooms.values()).filter(r => !r.isPrivate);
        server.send(JSON.stringify({
          type: 'rooms',
          rooms: publicRooms
        }));
        server.send(JSON.stringify({
          type: 'archived-rooms',
          rooms: Array.from(this.archivedRooms.values())
        }));
      } catch {
        // Client may have disconnected immediately
      }

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

  async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): Promise<void> {
    // Lobby clients don't send meaningful messages; just keep-alive
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    // Nothing to clean up – Cloudflare removes the socket automatically
    try { ws.close(); } catch { /* already closed */ }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  // ── Helpers ──

  private broadcastRooms(): void {
    // Only broadcast public rooms to lobby clients
    const publicRooms = Array.from(this.rooms.values()).filter(r => !r.isPrivate);
    const payload = JSON.stringify({
      type: 'rooms',
      rooms: publicRooms
    });
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // Dead socket – Cloudflare will clean it up
      }
    }
  }

  private broadcastArchivedRooms(): void {
    const payload = JSON.stringify({
      type: 'archived-rooms',
      rooms: Array.from(this.archivedRooms.values())
    });
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // Dead socket
      }
    }
  }

  private async persistRooms(): Promise<void> {
    await this.state.storage.put('rooms', Array.from(this.rooms.values()));
  }

  private async persistArchivedRooms(): Promise<void> {
    await this.state.storage.put('archivedRooms', Array.from(this.archivedRooms.values()));
  }
}
