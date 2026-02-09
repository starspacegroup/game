import { gameState } from './gameState.svelte';
import { authState } from './authState.svelte';
import { world } from '$lib/game/world';
import * as THREE from 'three';
import type {
  ClientMessage,
  ServerMessage,
  InputMessage,
  Vector3,
  StateMessage,
  AsteroidState,
  NpcState,
  PowerUpState,
  PuzzleNodeState
} from '$lib/shared/protocol';

let socket: WebSocket | null = null;
let reconnectAttempts = 0;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let playerId: string | null = null;
let currentRoomCode: string | null = null;
let inputSequence = 0;

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 2000;
const INPUT_SEND_RATE = 50; // Send inputs every 50ms

// Input state tracking
let inputInterval: ReturnType<typeof setInterval> | null = null;
let currentInput: Omit<InputMessage, 'type' | 'tick'> = {
  thrust: false,
  brake: false,
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0
};

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

  currentRoomCode = room;

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
        username: authState.username || 'Player',
        roomCode: room
      });

      // Start input sending loop
      startInputLoop();
    };

    socket.onclose = () => {
      console.log('[Starspace] Disconnected from server');
      gameState.mode = 'solo';
      socket = null;
      stopInputLoop();

      // Try to reconnect
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS && currentRoomCode) {
        reconnectAttempts++;
        console.log(`[Starspace] Reconnecting in ${RECONNECT_DELAY}ms (attempt ${reconnectAttempts})`);
        reconnectTimeout = setTimeout(() => connectToServer(currentRoomCode!), RECONNECT_DELAY);
      }
    };

    socket.onerror = () => {
      console.log('[Starspace] WebSocket error, falling back to solo mode');
      gameState.mode = 'solo';
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as ServerMessage;
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

function handleMessage(data: ServerMessage): void {
  switch (data.type) {
    case 'welcome': {
      // Received when joining - contains full world state
      currentRoomCode = data.roomCode;
      playerId = data.playerId;

      // Apply full world state from server
      applyFullState(data.state);

      gameState.puzzleProgress = data.state.puzzleProgress;
      gameState.puzzleSolved = data.state.puzzleSolved;
      gameState.wave = data.state.wave;
      gameState.playerCount = data.state.players.length;

      console.log(`[Starspace] Joined room ${data.roomCode} with ${data.state.players.length} players`);
      break;
    }

    case 'state': {
      // Regular state update from server
      applyStateUpdate(data);
      break;
    }

    case 'player-joined': {
      gameState.playerCount = data.playerCount;
      console.log(`[Starspace] Player ${data.player.username} joined (${data.playerCount} total)`);
      break;
    }

    case 'player-left': {
      gameState.playerCount = data.playerCount;
      world.otherPlayers = world.otherPlayers.filter(p => p.id !== data.playerId);
      console.log(`[Starspace] Player left (${data.playerCount} remaining)`);
      break;
    }

    case 'player-hit': {
      if (data.playerId === playerId) {
        gameState.health = data.health;
        world.player.health = data.health;
      }
      break;
    }

    case 'player-respawn': {
      if (data.player.id === playerId) {
        gameState.health = data.player.health;
        world.player.health = data.player.health;
        world.player.position.set(data.player.position.x, data.player.position.y, data.player.position.z);
      }
      break;
    }

    case 'power-up-collected': {
      // Remove power-up from local state
      const pwrIdx = world.powerUps.findIndex(p => p.id === data.powerUpId);
      if (pwrIdx >= 0) {
        world.powerUps[pwrIdx].collected = true;
      }
      break;
    }

    case 'entity-destroyed': {
      if (data.entityType === 'asteroid') {
        const ast = world.asteroids.find(a => a.id === data.entityId);
        if (ast) ast.destroyed = true;
      } else if (data.entityType === 'npc') {
        const npc = world.npcs.find(n => n.id === data.entityId);
        if (npc) npc.destroyed = true;
      }

      // Award score if we destroyed it
      if (data.destroyedBy === playerId) {
        gameState.score += data.entityType === 'asteroid' ? 10 : 25;
      }
      break;
    }

    case 'npc-converted': {
      gameState.convertedNpcCount++;
      break;
    }

    case 'hint': {
      gameState.addHint(data.nodeId, data.hint);
      break;
    }

    case 'chat-broadcast': {
      gameState.messages = [
        ...gameState.messages,
        {
          sender: data.sender,
          text: data.text,
          time: data.timestamp
        }
      ];
      break;
    }

    case 'error': {
      console.error(`[Starspace] Server error: ${data.code} - ${data.message}`);
      break;
    }
  }
}

/**
 * Apply full world state from server (on join)
 */
function applyFullState(state: import('$lib/shared/protocol').WorldState): void {
  // Reset world bounds
  world.bounds = state.bounds;

  // Apply players
  world.otherPlayers = [];
  for (const p of state.players) {
    if (p.id === playerId) {
      // This is us
      world.player.position.set(p.position.x, p.position.y, p.position.z);
      world.player.velocity.set(p.velocity.x, p.velocity.y, p.velocity.z);
      world.player.rotation.set(p.rotation.x, p.rotation.y, p.rotation.z);
      world.player.health = p.health;
      world.player.maxHealth = p.maxHealth;
      world.player.score = p.score;
      world.player.speed = p.speed;
    } else {
      world.otherPlayers.push({
        id: p.id,
        username: p.username,
        position: new THREE.Vector3(p.position.x, p.position.y, p.position.z),
        rotation: new THREE.Euler(p.rotation.x, p.rotation.y, p.rotation.z),
        lastUpdate: Date.now()
      });
    }
  }

  // Apply asteroids
  world.asteroids = state.asteroids.map(a => ({
    id: a.id,
    position: new THREE.Vector3(a.position.x, a.position.y, a.position.z),
    velocity: new THREE.Vector3(a.velocity.x, a.velocity.y, a.velocity.z),
    rotation: new THREE.Euler(a.rotation.x, a.rotation.y, a.rotation.z),
    rotationSpeed: new THREE.Vector3(a.rotationSpeed.x, a.rotationSpeed.y, a.rotationSpeed.z),
    radius: a.radius,
    health: a.health,
    maxHealth: a.maxHealth,
    puzzleIndex: null,
    destroyed: a.destroyed
  }));

  // Apply NPCs
  world.npcs = state.npcs.map(n => ({
    id: n.id,
    position: new THREE.Vector3(n.position.x, n.position.y, n.position.z),
    velocity: new THREE.Vector3(n.velocity.x, n.velocity.y, n.velocity.z),
    rotation: new THREE.Euler(n.rotation.x, n.rotation.y, n.rotation.z),
    radius: n.radius,
    health: n.health,
    maxHealth: n.maxHealth,
    shootCooldown: n.shootCooldown,
    destroyed: n.destroyed,
    converted: n.converted,
    conversionProgress: n.conversionProgress,
    targetNodeId: n.targetNodeId,
    orbitAngle: n.orbitAngle,
    orbitDistance: n.orbitDistance,
    hintTimer: 3,
    hintData: null
  }));

  // Apply puzzle nodes
  world.puzzleNodes = state.puzzleNodes.map(n => ({
    id: n.id,
    position: new THREE.Vector3(n.position.x, n.position.y, n.position.z),
    targetPosition: new THREE.Vector3(n.targetPosition.x, n.targetPosition.y, n.targetPosition.z),
    radius: n.radius,
    connected: n.connected,
    color: n.color
  }));

  // Apply power-ups
  world.powerUps = state.powerUps.map(p => ({
    id: p.id,
    position: new THREE.Vector3(p.position.x, p.position.y, p.position.z),
    type: p.type,
    radius: p.radius,
    collected: p.collected,
    bobPhase: Math.random() * Math.PI * 2
  }));

  // Apply lasers
  world.lasers = state.lasers.map(l => ({
    id: l.id,
    position: new THREE.Vector3(l.position.x, l.position.y, l.position.z),
    direction: new THREE.Vector3(l.direction.x, l.direction.y, l.direction.z),
    speed: l.speed,
    life: l.life,
    owner: l.ownerId,
    radius: l.radius
  }));
}

/**
 * Apply incremental state updates from server
 */
function applyStateUpdate(data: StateMessage): void {
  // Update players
  for (const serverPlayer of data.players) {
    if (serverPlayer.id === playerId) {
      // Server is authoritative - smoothly interpolate to server position
      // Use lerp for smooth movement instead of hard snaps
      const lerpFactor = 0.3; // Smooth interpolation
      world.player.position.x += (serverPlayer.position.x - world.player.position.x) * lerpFactor;
      world.player.position.y += (serverPlayer.position.y - world.player.position.y) * lerpFactor;
      world.player.position.z += (serverPlayer.position.z - world.player.position.z) * lerpFactor;

      world.player.health = serverPlayer.health;
      world.player.score = serverPlayer.score;
      gameState.health = serverPlayer.health;
      gameState.score = serverPlayer.score;
    } else {
      // Update other player
      const existing = world.otherPlayers.find(p => p.id === serverPlayer.id);
      if (existing) {
        existing.position.set(serverPlayer.position.x, serverPlayer.position.y, serverPlayer.position.z);
        existing.rotation.set(serverPlayer.rotation.x, serverPlayer.rotation.y, serverPlayer.rotation.z);
        existing.username = serverPlayer.username;
        existing.lastUpdate = Date.now();
      } else {
        world.otherPlayers.push({
          id: serverPlayer.id,
          username: serverPlayer.username,
          position: new THREE.Vector3(serverPlayer.position.x, serverPlayer.position.y, serverPlayer.position.z),
          rotation: new THREE.Euler(serverPlayer.rotation.x, serverPlayer.rotation.y, serverPlayer.rotation.z),
          lastUpdate: Date.now()
        });
      }
    }
  }

  // Update lasers from server
  if (data.lasers) {
    world.lasers = data.lasers.map(l => ({
      id: l.id,
      position: new THREE.Vector3(l.position.x, l.position.y, l.position.z),
      direction: new THREE.Vector3(l.direction.x, l.direction.y, l.direction.z),
      speed: l.speed,
      life: l.life,
      owner: l.ownerId,
      radius: l.radius
    }));
  }

  // Update full entity state periodically (every 5 ticks from server)
  if (data.asteroids) {
    syncAsteroids(data.asteroids);
  }
  if (data.npcs) {
    syncNpcs(data.npcs);
  }
  if (data.powerUps) {
    syncPowerUps(data.powerUps);
  }
  if (data.puzzleNodes) {
    syncPuzzleNodes(data.puzzleNodes);
  }

  gameState.puzzleProgress = data.puzzleProgress;
  gameState.puzzleSolved = data.puzzleSolved;
}

function syncAsteroids(serverAsteroids: AsteroidState[]): void {
  for (const sa of serverAsteroids) {
    const local = world.asteroids.find(a => a.id === sa.id);
    if (local) {
      local.position.set(sa.position.x, sa.position.y, sa.position.z);
      local.velocity.set(sa.velocity.x, sa.velocity.y, sa.velocity.z);
      local.health = sa.health;
      local.destroyed = sa.destroyed;
    }
  }
}

function syncNpcs(serverNpcs: NpcState[]): void {
  for (const sn of serverNpcs) {
    const local = world.npcs.find(n => n.id === sn.id);
    if (local) {
      local.position.set(sn.position.x, sn.position.y, sn.position.z);
      local.velocity.set(sn.velocity.x, sn.velocity.y, sn.velocity.z);
      local.health = sn.health;
      local.destroyed = sn.destroyed;
      local.converted = sn.converted;
      local.targetNodeId = sn.targetNodeId;
    }
  }
}

function syncPowerUps(serverPowerUps: PowerUpState[]): void {
  for (const sp of serverPowerUps) {
    const local = world.powerUps.find(p => p.id === sp.id);
    if (local) {
      local.position.set(sp.position.x, sp.position.y, sp.position.z);
      local.collected = sp.collected;
    }
  }
}

function syncPuzzleNodes(serverNodes: PuzzleNodeState[]): void {
  for (const sn of serverNodes) {
    const local = world.puzzleNodes.find(n => n.id === sn.id);
    if (local) {
      local.position.set(sn.position.x, sn.position.y, sn.position.z);
      local.connected = sn.connected;
    }
  }
}

function send(data: ClientMessage): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}

// ==========================================
// Input Management
// ==========================================

function startInputLoop(): void {
  if (inputInterval) return;

  inputInterval = setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) {
      send({
        type: 'input',
        tick: inputSequence++,
        ...currentInput
      });
    }
  }, INPUT_SEND_RATE);
}

function stopInputLoop(): void {
  if (inputInterval) {
    clearInterval(inputInterval);
    inputInterval = null;
  }
}

/**
 * Update the current input state (called by input handlers)
 */
export function setInput(input: Partial<Omit<InputMessage, 'type' | 'tick'>>): void {
  Object.assign(currentInput, input);
}

/**
 * Send a fire command to the server
 */
export function sendFire(): void {
  if (socket?.readyState !== WebSocket.OPEN) return;
  send({ type: 'fire', tick: inputSequence });
}

/**
 * Send an interact command to the server
 */
export function sendInteract(
  targetId: string,
  targetType: 'puzzle-node' | 'npc' | 'power-up',
  action: 'move' | 'connect' | 'convert',
  position?: Vector3
): void {
  if (socket?.readyState !== WebSocket.OPEN) return;

  send({
    type: 'interact',
    targetId,
    targetType,
    action,
    ...(position && { position })
  });
}

/**
 * Send puzzle action (legacy compatibility)
 */
export function sendPuzzleAction(
  nodeId: string,
  action: string,
  position?: { x: number; y: number; z: number; },
  connected?: boolean
): void {
  if (socket?.readyState !== WebSocket.OPEN) return;
  sendInteract(nodeId, 'puzzle-node', action === 'connect' ? 'connect' : 'move', position);
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
  stopInputLoop();
  socket?.close();
  socket = null;
  playerId = null;
  currentRoomCode = null;
}

export function isConnected(): boolean {
  return socket?.readyState === WebSocket.OPEN;
}

export function getPlayerId(): string | null {
  return playerId;
}

export function getRoomCode(): string | null {
  return currentRoomCode;
}

// Legacy export for compatibility
export function sendPosition(): void {
  // No longer needed - inputs are sent automatically
  // Position is computed server-side
}
