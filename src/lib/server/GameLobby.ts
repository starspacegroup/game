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
}

export class GameLobby implements DurableObject {
  private state: DurableObjectState;

  /** Current snapshot of all active rooms */
  private rooms: Map<string, LobbyRoomInfo> = new Map();

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
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // ── WebSocket upgrade (lobby clients) ──
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.state.acceptWebSocket(server);

      // Send current room list immediately
      try {
        server.send(JSON.stringify({
          type: 'rooms',
          rooms: Array.from(this.rooms.values())
        }));
      } catch {
        // Client may have disconnected immediately
      }

      return new Response(null, { status: 101, webSocket: client });
    }

    // ── HTTP: room state updates from GameRoom / rooms API ──
    if (url.pathname === '/room-update' && request.method === 'POST') {
      const body = await request.json() as {
        action: 'upsert' | 'delete';
        room?: LobbyRoomInfo;
        roomId?: string;
      };

      if (body.action === 'upsert' && body.room) {
        this.rooms.set(body.room.id, body.room);
      } else if (body.action === 'delete' && body.roomId) {
        this.rooms.delete(body.roomId);
      }

      // Persist and broadcast
      await this.persistRooms();
      this.broadcastRooms();

      return Response.json({ ok: true });
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
    const payload = JSON.stringify({
      type: 'rooms',
      rooms: Array.from(this.rooms.values())
    });
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // Dead socket – Cloudflare will clean it up
      }
    }
  }

  private async persistRooms(): Promise<void> {
    await this.state.storage.put('rooms', Array.from(this.rooms.values()));
  }
}
