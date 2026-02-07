import { gameState } from './gameState.svelte';
import { authState } from './authState.svelte';
import { world } from '$lib/game/world';
import * as THREE from 'three';

let socket: WebSocket | null = null;
let reconnectAttempts = 0;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let playerId: string | null = null;

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 2000;

function generatePlayerId(): string {
  return `player_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function connectToServer(room: string = 'default'): void {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
    return;
  }

  // Clear any pending reconnect
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  try {
    // Construct WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/game/ws?room=${encodeURIComponent(room)}`;

    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log('[Starspace] Connected to multiplayer server');
      reconnectAttempts = 0;
      gameState.mode = 'multiplayer';

      // Generate or reuse player ID
      if (!playerId) {
        playerId = authState.userId || generatePlayerId();
      }

      // Join the game
      send({
        type: 'join',
        id: playerId,
        username: authState.username || 'Player'
      });

      // Sync puzzle nodes if we have any (first player seeds the state)
      if (world.puzzleNodes.length > 0) {
        send({
          type: 'sync-puzzle-nodes',
          nodes: world.puzzleNodes.map(n => ({
            id: n.id,
            x: n.position.x,
            y: n.position.y,
            z: n.position.z,
            connected: n.connected
          }))
        });
      }
    };

    socket.onclose = () => {
      console.log('[Starspace] Disconnected from server');
      gameState.mode = 'solo';
      socket = null;

      // Try to reconnect
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        console.log(`[Starspace] Reconnecting in ${RECONNECT_DELAY}ms (attempt ${reconnectAttempts})`);
        reconnectTimeout = setTimeout(() => connectToServer(room), RECONNECT_DELAY);
      }
    };

    socket.onerror = () => {
      console.log('[Starspace] WebSocket error, falling back to solo mode');
      gameState.mode = 'solo';
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleMessage(data);
      } catch (e) {
        console.error('[Starspace] Failed to parse message:', e);
      }
    };
  } catch {
    console.log('[Starspace] WebSocket unavailable, solo mode');
    gameState.mode = 'solo';
  }
}

function handleMessage(data: Record<string, unknown>): void {
  const type = data.type as string;
  switch (type) {
    case 'welcome': {
      // Received when joining - contains all existing players and game state
      const players = data.players as Array<{
        id: string;
        username: string;
        x: number;
        y: number;
        z: number;
        rx: number;
        ry: number;
        rz: number;
      }>;

      // Add all existing players
      for (const p of players) {
        const existing = world.otherPlayers.find(op => op.id === p.id);
        if (!existing) {
          world.otherPlayers.push({
            id: p.id,
            username: p.username || 'Player',
            position: new THREE.Vector3(p.x, p.y, p.z),
            rotation: new THREE.Euler(p.rx, p.ry, p.rz),
            lastUpdate: Date.now()
          });
        }
      }

      // Restore puzzle state from server
      const puzzleNodes = data.puzzleNodes as Array<{
        id: string;
        x: number;
        y: number;
        z: number;
        connected: boolean;
      }>;

      if (puzzleNodes?.length > 0) {
        for (const serverNode of puzzleNodes) {
          const localNode = world.puzzleNodes.find(n => n.id === serverNode.id);
          if (localNode) {
            localNode.position.set(serverNode.x, serverNode.y, serverNode.z);
            localNode.connected = serverNode.connected;
          }
        }
      }

      gameState.puzzleProgress = data.puzzleProgress as number || 0;
      gameState.puzzleSolved = data.puzzleSolved as boolean || false;
      gameState.wave = data.wave as number || 1;
      gameState.playerCount = data.playerCount as number || 1;
      gameState.npcCount = Math.max(0, 5 - (gameState.playerCount - 1));

      console.log(`[Starspace] Joined game with ${players.length} other players`);
      break;
    }

    case 'player-joined': {
      gameState.playerCount = data.count as number;
      gameState.npcCount = Math.max(0, 5 - (gameState.playerCount - 1));
      console.log(`[Starspace] Player ${data.username} joined (${data.count} total)`);
      break;
    }

    case 'player-left': {
      const leftId = data.id as string;
      gameState.playerCount = data.count as number;
      gameState.npcCount = Math.max(0, 5 - (gameState.playerCount - 1));
      world.otherPlayers = world.otherPlayers.filter(p => p.id !== leftId);
      console.log(`[Starspace] Player left (${data.count} remaining)`);
      break;
    }

    case 'player-position': {
      const posId = data.id as string;
      const posUsername = (data.username as string) || 'Player';
      const posX = data.x as number;
      const posY = data.y as number;
      const posZ = data.z as number;
      const posRx = data.rx as number;
      const posRy = data.ry as number;
      const posRz = data.rz as number;

      // Don't add ourselves
      if (posId === playerId) return;

      const existing = world.otherPlayers.find(p => p.id === posId);
      if (existing) {
        existing.position.set(posX, posY, posZ);
        existing.rotation.set(posRx, posRy, posRz);
        existing.username = posUsername;
        existing.lastUpdate = Date.now();
      } else {
        world.otherPlayers.push({
          id: posId,
          username: posUsername,
          position: new THREE.Vector3(posX, posY, posZ),
          rotation: new THREE.Euler(posRx, posRy, posRz),
          lastUpdate: Date.now()
        });
      }
      break;
    }

    case 'puzzle-update': {
      const nodeId = data.nodeId as string;
      const node = world.puzzleNodes.find(n => n.id === nodeId);
      if (node) {
        if (data.x !== undefined) node.position.x = data.x as number;
        if (data.y !== undefined) node.position.y = data.y as number;
        if (data.z !== undefined) node.position.z = data.z as number;
        if (data.connected !== undefined) node.connected = data.connected as boolean;
      }
      if (data.puzzleProgress !== undefined) {
        gameState.puzzleProgress = data.puzzleProgress as number;
      }
      if (data.puzzleSolved !== undefined) {
        gameState.puzzleSolved = data.puzzleSolved as boolean;
      }
      break;
    }

    case 'chat': {
      gameState.messages = [
        ...gameState.messages,
        {
          sender: data.sender as string,
          text: data.text as string,
          time: Date.now()
        }
      ];
      break;
    }
  }
}

function send(data: object): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}

export function sendPosition(): void {
  if (socket?.readyState !== WebSocket.OPEN) return;

  send({
    type: 'position',
    username: authState.username || 'Player',
    x: world.player.position.x,
    y: world.player.position.y,
    z: world.player.position.z,
    rx: world.player.rotation.x,
    ry: world.player.rotation.y,
    rz: world.player.rotation.z
  });
}

export function sendPuzzleAction(
  nodeId: string,
  action: string,
  position?: { x: number; y: number; z: number; },
  connected?: boolean
): void {
  if (socket?.readyState !== WebSocket.OPEN) return;

  send({
    type: 'puzzle-action',
    nodeId,
    action,
    ...(position && { x: position.x, y: position.y, z: position.z }),
    ...(connected !== undefined && { connected })
  });
}

export function sendChat(text: string): void {
  if (socket?.readyState !== WebSocket.OPEN) return;
  send({ type: 'chat', text });
}

export function disconnect(): void {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  socket?.close();
  socket = null;
  playerId = null;
}

export function isConnected(): boolean {
  return socket?.readyState === WebSocket.OPEN;
}

export function getPlayerId(): string | null {
  return playerId;
}
