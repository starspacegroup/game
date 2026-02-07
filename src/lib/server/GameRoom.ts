/// <reference types="@cloudflare/workers-types" />
/**
 * Cloudflare Durable Object for real-time multiplayer game room
 * Handles WebSocket connections and broadcasts player state to all connected players
 */

interface Player {
  id: string;
  username: string;
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  lastUpdate: number;
}

interface PuzzleNodeState {
  id: string;
  x: number;
  y: number;
  z: number;
  connected: boolean;
}

interface GameState {
  players: Map<string, Player>;
  puzzleNodes: PuzzleNodeState[];
  puzzleProgress: number;
  puzzleSolved: boolean;
  wave: number;
}

export class GameRoom implements DurableObject {
  private state: DurableObjectState;
  private sessions: Map<WebSocket, string> = new Map(); // ws -> playerId
  private gameState: GameState = {
    players: new Map(),
    puzzleNodes: [],
    puzzleProgress: 0,
    puzzleSolved: false,
    wave: 1
  };

  constructor(state: DurableObjectState) {
    this.state = state;
    // Restore game state from storage if exists
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<{ puzzleNodes: PuzzleNodeState[]; puzzleProgress: number; puzzleSolved: boolean; wave: number; }>('gameState');
      if (stored) {
        this.gameState.puzzleNodes = stored.puzzleNodes;
        this.gameState.puzzleProgress = stored.puzzleProgress;
        this.gameState.puzzleSolved = stored.puzzleSolved;
        this.gameState.wave = stored.wave;
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }

    // HTTP endpoints for debugging/status
    if (url.pathname === '/status') {
      return Response.json({
        playerCount: this.gameState.players.size,
        players: Array.from(this.gameState.players.values()).map(p => ({
          id: p.id,
          username: p.username
        })),
        puzzleProgress: this.gameState.puzzleProgress,
        puzzleSolved: this.gameState.puzzleSolved,
        wave: this.gameState.wave
      });
    }

    return new Response('Game Room Durable Object', { status: 200 });
  }

  private handleWebSocket(request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // Accept the WebSocket
    this.state.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;

    try {
      const data = JSON.parse(message);
      await this.handleMessage(ws, data);
    } catch (e) {
      console.error('Failed to parse WebSocket message:', e);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const playerId = this.sessions.get(ws);
    if (playerId) {
      this.sessions.delete(ws);
      this.gameState.players.delete(playerId);

      // Broadcast player left to all other players
      this.broadcast({
        type: 'player-left',
        id: playerId,
        count: this.gameState.players.size
      }, ws);
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  private async handleMessage(ws: WebSocket, data: Record<string, unknown>): Promise<void> {
    const type = data.type as string;
    switch (type) {
      case 'join': {
        const playerId = data.id as string;
        const username = (data.username as string) || 'Player';

        this.sessions.set(ws, playerId);
        this.gameState.players.set(playerId, {
          id: playerId,
          username,
          x: 0,
          y: 0,
          z: 0,
          rx: 0,
          ry: 0,
          rz: 0,
          lastUpdate: Date.now()
        });

        // Send current game state to the new player
        const existingPlayers = Array.from(this.gameState.players.values())
          .filter(p => p.id !== playerId);

        ws.send(JSON.stringify({
          type: 'welcome',
          playerId,
          players: existingPlayers,
          puzzleNodes: this.gameState.puzzleNodes,
          puzzleProgress: this.gameState.puzzleProgress,
          puzzleSolved: this.gameState.puzzleSolved,
          wave: this.gameState.wave,
          playerCount: this.gameState.players.size
        }));

        // Broadcast new player to all others
        this.broadcast({
          type: 'player-joined',
          id: playerId,
          username,
          count: this.gameState.players.size
        }, ws);
        break;
      }

      case 'position': {
        const playerId = this.sessions.get(ws);
        if (!playerId) return;

        const player = this.gameState.players.get(playerId);
        if (player) {
          player.x = data.x as number;
          player.y = data.y as number;
          player.z = data.z as number;
          player.rx = data.rx as number;
          player.ry = data.ry as number;
          player.rz = data.rz as number;
          player.username = data.username as string || player.username;
          player.lastUpdate = Date.now();

          // Broadcast position to all other players
          this.broadcast({
            type: 'player-position',
            id: playerId,
            username: player.username,
            x: player.x,
            y: player.y,
            z: player.z,
            rx: player.rx,
            ry: player.ry,
            rz: player.rz
          }, ws);
        }
        break;
      }

      case 'puzzle-action': {
        const nodeId = data.nodeId as string;
        const action = data.action as string;
        const x = data.x as number | undefined;
        const y = data.y as number | undefined;
        const z = data.z as number | undefined;
        const connected = data.connected as boolean | undefined;

        // Update puzzle node state
        let node = this.gameState.puzzleNodes.find(n => n.id === nodeId);
        if (!node && x !== undefined && y !== undefined && z !== undefined) {
          node = { id: nodeId, x, y, z, connected: connected || false };
          this.gameState.puzzleNodes.push(node);
        } else if (node) {
          if (x !== undefined) node.x = x;
          if (y !== undefined) node.y = y;
          if (z !== undefined) node.z = z;
          if (connected !== undefined) node.connected = connected;
        }

        // Calculate puzzle progress
        const connectedCount = this.gameState.puzzleNodes.filter(n => n.connected).length;
        this.gameState.puzzleProgress = this.gameState.puzzleNodes.length > 0
          ? (connectedCount / this.gameState.puzzleNodes.length) * 100
          : 0;
        this.gameState.puzzleSolved = this.gameState.puzzleProgress >= 100;

        // Persist puzzle state
        await this.state.storage.put('gameState', {
          puzzleNodes: this.gameState.puzzleNodes,
          puzzleProgress: this.gameState.puzzleProgress,
          puzzleSolved: this.gameState.puzzleSolved,
          wave: this.gameState.wave
        });

        // Broadcast puzzle update to all players
        this.broadcast({
          type: 'puzzle-update',
          nodeId,
          action,
          x: node?.x,
          y: node?.y,
          z: node?.z,
          connected: node?.connected,
          puzzleProgress: this.gameState.puzzleProgress,
          puzzleSolved: this.gameState.puzzleSolved
        });
        break;
      }

      case 'chat': {
        const playerId = this.sessions.get(ws);
        const player = playerId ? this.gameState.players.get(playerId) : null;
        const sender = player?.username || 'Unknown';

        this.broadcast({
          type: 'chat',
          sender,
          text: data.text as string
        });
        break;
      }

      case 'sync-puzzle-nodes': {
        // Initial sync of puzzle nodes from a player (server-authoritative merge)
        const nodes = data.nodes as PuzzleNodeState[];
        if (this.gameState.puzzleNodes.length === 0 && nodes?.length > 0) {
          this.gameState.puzzleNodes = nodes;
          await this.state.storage.put('gameState', {
            puzzleNodes: this.gameState.puzzleNodes,
            puzzleProgress: this.gameState.puzzleProgress,
            puzzleSolved: this.gameState.puzzleSolved,
            wave: this.gameState.wave
          });
        }
        break;
      }
    }
  }

  private broadcast(message: object, exclude?: WebSocket): void {
    const msg = JSON.stringify(message);
    for (const ws of this.state.getWebSockets()) {
      if (ws !== exclude) {
        try {
          ws.send(msg);
        } catch {
          // WebSocket might be closed, ignore
        }
      }
    }
  }
}
