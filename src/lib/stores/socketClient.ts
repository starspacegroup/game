import { gameState } from './gameState.svelte';
import { authState } from './authState.svelte';
import { deathReplay } from './deathReplay.svelte';
import { world, projectToSphere, sphereDistance, getPlayerFrame, transportTangent, reorthogonalizePlayerUp, SPHERE_RADIUS } from '$lib/game/world';
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
const INPUT_SEND_RATE = 33; // Send inputs every 33ms (match server tick rate)

// ==========================================
// Server reconciliation — input history buffer
// ==========================================
// Each entry records the input we sent + the predicted position *after* applying it.
// When the server echoes back lastProcessedInput, we compare its authoritative position
// against our prediction at that tick. If they match (within tolerance), prediction is
// good. If not, we snap to the server position and replay all inputs the server hasn't
// processed yet, giving us an authoritative-but-responsive result.

interface InputHistoryEntry {
  seq: number;
  moveX: number;
  moveY: number;
  boost: boolean;
  dt: number; // deltaTime used for this input's physics step
  /** World-space velocity vector — used for frame-independent replay */
  velX: number;
  velY: number;
  velZ: number;
}

const INPUT_BUFFER_SIZE = 128;
const inputHistory: InputHistoryEntry[] = [];
// Reconciliation error threshold — chord distance on sphere.
// Must be large enough to absorb floating-point difference between
// server (plain-object math) and client (THREE.js math) tangent frames.
const RECONCILE_THRESHOLD = 3.0;

/**
 * Record an input that was sent to the server, for later reconciliation.
 * Called from the game loop (GameWorld) after applying local prediction.
 */
export function recordInput(seq: number, moveX: number, moveY: number, boost: boolean, dt: number, velX = 0, velY = 0, velZ = 0): void {
  inputHistory.push({ seq, moveX, moveY, boost, dt, velX, velY, velZ });
  // Trim old entries
  if (inputHistory.length > INPUT_BUFFER_SIZE) {
    inputHistory.splice(0, inputHistory.length - INPUT_BUFFER_SIZE);
  }
}

/**
 * Replay unprocessed inputs on top of a server-authoritative position.
 * Uses world-space velocity directly — matches what the server does,
 * and avoids corrupting world.playerUp during replay.
 */
function replayInputs(fromPos: THREE.Vector3, startAfterSeq: number): THREE.Vector3 {
  const pos = fromPos.clone();
  for (const entry of inputHistory) {
    if (entry.seq <= startAfterSeq) continue;

    // Apply world-space velocity directly (same as server)
    pos.x += entry.velX * entry.dt;
    pos.y += entry.velY * entry.dt;
    pos.z += entry.velZ * entry.dt;
    projectToSphere(pos);
  }
  return pos;
}

// Input state tracking
let inputInterval: ReturnType<typeof setInterval> | null = null;
let currentInput: Omit<InputMessage, 'type' | 'tick'> = {
  thrust: false,
  brake: false,
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
  velX: 0,
  velY: 0,
  velZ: 0
};

function generatePlayerId(): string {
  return `player_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Lerp a THREE.Vector3 toward a target on the sphere surface.
 * After lerping, re-projects to the sphere surface.
 */
function sphereLerp(local: THREE.Vector3, target: THREE.Vector3, factor: number): void {
  local.lerp(target, factor);
  projectToSphere(local);
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
        avatarUrl: authState.avatarUrl || undefined,
        roomCode: room
      });

      // Only start input loop if we're joining a game in progress.
      // For lobby phase, the 'game-started' handler will start it.
      if (gameState.phase === 'playing') {
        startInputLoop();
      }
    };

    socket.onclose = (event) => {
      console.log('[Starspace] Disconnected from server');
      gameState.mode = 'solo';
      socket = null;
      stopInputLoop();

      // If room was terminated by admin, return to welcome screen
      if (event.reason === 'Room terminated by admin') {
        gameState.phase = 'welcome';
        currentRoomCode = null;
        reconnectAttempts = MAX_RECONNECT_ATTEMPTS;
        return;
      }

      // If room was terminated because all players died, go to game-over
      if (event.reason === 'All players eliminated') {
        gameState.phase = 'gameover';
        currentRoomCode = null;
        reconnectAttempts = MAX_RECONNECT_ATTEMPTS;
        return;
      }

      // If kicked due to duplicate session (same user joined from another device),
      // don't reconnect — the other device has taken over.
      if (event.code === 4009 || event.reason === 'duplicate-session') {
        console.warn('[Starspace] Disconnected: you joined from another device.');
        gameState.phase = 'welcome';
        currentRoomCode = null;
        reconnectAttempts = MAX_RECONNECT_ATTEMPTS;
        return;
      }

      // Don't attempt to reconnect if the user has already left the game
      if (gameState.phase !== 'playing') {
        currentRoomCode = null;
        reconnectAttempts = MAX_RECONNECT_ATTEMPTS;
        return;
      }

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
  // Ignore messages if we've already left the game (prevents stale messages from overriding state)
  if (gameState.phase === 'gameover' || gameState.phase === 'welcome') {
    return;
  }

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

      // Transition to playing phase (handles joining a game already in progress)
      gameState.lobbyState = null;
      gameState.phase = 'playing';
      gameState.mode = 'multiplayer';
      startInputLoop();

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
        // Trigger 1-second invincibility blink on client
        world.player.damageCooldownUntil = Date.now() + 1000;
      }
      break;
    }

    case 'player-respawn': {
      if (data.player.id === playerId) {
        gameState.score = 0;
        gameState.health = data.player.health;
        world.player.health = data.player.health;
        world.player.position.set(data.player.position.x, data.player.position.y, data.player.position.z);
        inputHistory.length = 0; // Clear stale predictions
        // Clear death screen state
        deathReplay.reset();
        gameState.multiplayerDead = false;
        gameState.roomStats = null;
      }
      break;
    }

    case 'power-up-collected': {
      // Remove power-up from local state
      const pwrIdx = world.powerUps.findIndex(p => p.id === data.powerUpId);
      if (pwrIdx >= 0) {
        world.powerUps[pwrIdx].collected = true;
      }
      const durationMap: Record<string, number> = { speed: 8000, multishot: 10000, shield: 12000 };
      const dur = durationMap[data.powerUpType] || 10000;
      if (data.playerId === playerId) {
        // Apply buff + notification to local player
        const pType = data.powerUpType as 'health' | 'speed' | 'multishot' | 'shield';
        if (pType === 'health') {
          gameState.notifyPickup('health', '+25 HP restored');
        } else {
          gameState.addBuff(pType, dur);
          const detailMap: Record<string, string> = {
            speed: `Speed x1.7 for ${dur / 1000}s`,
            multishot: `Multi-shot for ${dur / 1000}s`,
            shield: `Shield for ${dur / 1000}s`,
          };
          gameState.notifyPickup(pType, detailMap[pType] || `Buff for ${dur / 1000}s`);
        }
      } else {
        // Track buff on other players
        if (data.powerUpType !== 'health') {
          const other = world.otherPlayers.find(p => p.id === data.playerId);
          if (other) {
            other.activeBuffs = other.activeBuffs.filter(b => b.type !== data.powerUpType);
            other.activeBuffs.push({ type: data.powerUpType, expiresAt: Date.now() + dur });
          }
        }
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
      if (data.destroyedBy === playerId && gameState.isAlive) {
        gameState.score += data.entityType === 'asteroid' ? 10 : 25;
      }
      break;
    }

    case 'npc-converted': {
      gameState.convertedNpcCount++;
      // Apply conversion state immediately so the NPC is recognized as an ally
      const convertedNpc = world.npcs.find(n => n.id === data.npcId);
      if (convertedNpc) {
        convertedNpc.converted = true;
        convertedNpc.conversionProgress = 1;
        convertedNpc.targetNodeId = data.targetNodeId || null;
      }
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

    case 'room-terminated': {
      console.log(`[Starspace] Room terminated: ${data.reason}`);
      // Prevent reconnection attempts
      reconnectAttempts = MAX_RECONNECT_ATTEMPTS;
      currentRoomCode = null;
      stopInputLoop();

      if (gameState.multiplayerDead) {
        // Death screen is showing — keep it up, mark room as closed
        // so the user can review stats and leave manually.
        if (gameState.roomStats) {
          gameState.roomStats.canRejoin = false;
          gameState.roomStats.roomClosed = true;
        }
      } else {
        // Not on death screen — go straight to game-over
        gameState.multiplayerDead = false;
        gameState.roomStats = null;
        gameState.phase = 'gameover';
      }
      break;
    }

    case 'room-ended': {
      console.log(`[Starspace] Room ended: ${data.reason}`);
      // Prevent reconnection attempts
      reconnectAttempts = MAX_RECONNECT_ATTEMPTS;
      currentRoomCode = null;
      stopInputLoop();

      // Store the full room-end payload for the death screen
      gameState.roomEndData = {
        reason: data.reason,
        duration: data.duration,
        finalWave: data.finalWave,
        finalPuzzleProgress: data.finalPuzzleProgress,
        players: data.players,
        eventLog: data.eventLog
      };

      // Ensure death screen is showing
      if (!gameState.multiplayerDead) {
        gameState.multiplayerDead = true;
      }
      // Mark room as closed so rejoin button disappears
      if (gameState.roomStats) {
        gameState.roomStats.canRejoin = false;
        gameState.roomStats.roomClosed = true;
      }
      break;
    }

    case 'room-stats': {
      gameState.roomStats = {
        playerCount: data.playerCount,
        aliveCount: data.aliveCount,
        players: data.players,
        wave: data.wave,
        puzzleProgress: data.puzzleProgress,
        puzzleSolved: data.puzzleSolved,
        canRejoin: data.canRejoin
      };
      break;
    }

    case 'lobby-state': {
      // We're in the waiting room. Update lobby state on gameState.
      currentRoomCode = data.roomCode;
      gameState.lobbyState = {
        roomCode: data.roomCode,
        hostId: data.hostId,
        isPrivate: data.isPrivate,
        players: data.players
      };
      // Ensure we're in lobby phase
      if (gameState.phase !== 'lobby') {
        gameState.phase = 'lobby';
      }
      break;
    }

    case 'game-started': {
      // Host started the game — transition from lobby to playing
      // The welcome message with full world state will follow immediately
      gameState.lobbyState = null;
      gameState.phase = 'playing';
      gameState.mode = 'multiplayer';
      // Start input sending loop
      startInputLoop();
      break;
    }
  }
}

/**
 * Apply full world state from server (on join)
 */
function applyFullState(state: import('$lib/shared/protocol').WorldState): void {
  // Apply players
  world.otherPlayers = [];
  for (const p of state.players) {
    if (p.id === playerId) {
      // This is us
      world.player.position.set(p.position.x, p.position.y, p.position.z);
      projectToSphere(world.player.position);
      world.player.velocity.set(p.velocity.x, p.velocity.y, p.velocity.z);
      world.player.rotation.set(p.rotation.x, p.rotation.y, p.rotation.z);
      world.player.health = p.health;
      world.player.maxHealth = p.maxHealth;
      world.player.score = p.score;
      world.player.speed = p.speed;
    } else {
      const pos = new THREE.Vector3(p.position.x, p.position.y, p.position.z);
      projectToSphere(pos);
      world.otherPlayers.push({
        id: p.id,
        username: p.username,
        position: pos,
        rotation: new THREE.Euler(p.rotation.x, p.rotation.y, p.rotation.z),
        health: p.health,
        maxHealth: p.maxHealth,
        activeBuffs: [],
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
    owner: l.ownerId === playerId ? 'player' : l.ownerId,
    radius: l.radius
  }));
}

/**
 * Apply incremental state updates from server
 * Uses smooth interpolation to avoid jitter — entities are simulated locally
 * and gently corrected toward server state each tick.
 */
function applyStateUpdate(data: StateMessage): void {
  const SNAP_THRESHOLD = 50; // Hard-snap if more than this far off (teleport/respawn)

  // Update players
  for (const serverPlayer of data.players) {
    if (serverPlayer.id === playerId) {
      // Server reconciliation:
      // Compare the server's authoritative position (which corresponds to
      // lastProcessedInput) against where our client-side prediction ended
      // up at that same input. If they agree, our prediction is valid. If
      // not, we snap to the server position and replay all inputs the server
      // hasn't processed yet.
      const serverPos = new THREE.Vector3(serverPlayer.position.x, serverPlayer.position.y, serverPlayer.position.z);
      projectToSphere(serverPos);

      const lastAck = serverPlayer.lastProcessedInput ?? 0;

      // Discard acknowledged inputs from the history buffer
      while (inputHistory.length > 0 && inputHistory[0].seq <= lastAck) {
        inputHistory.shift();
      }

      const errorDist = sphereDistance(world.player.position, serverPos);

      if (errorDist > SNAP_THRESHOLD) {
        // Major desync (teleport / respawn) — hard snap, clear buffer
        world.player.position.copy(serverPos);
        inputHistory.length = 0;
      } else if (errorDist > RECONCILE_THRESHOLD) {
        // Server disagrees with our prediction — reconcile.
        // Start from the server's authoritative position and replay
        // all inputs the server hasn't processed yet.
        const reconciled = replayInputs(serverPos, lastAck);
        world.player.position.copy(reconciled);
        projectToSphere(world.player.position);
      }
      // else: prediction matches server — no correction needed

      // Authoritative values from server (not position-related)
      world.player.health = serverPlayer.health;
      world.player.score = serverPlayer.score;
      world.player.speed = serverPlayer.speed;
      gameState.health = serverPlayer.health;
      gameState.score = serverPlayer.score;
    } else {
      // Other players — interpolate position for smooth movement
      const existing = world.otherPlayers.find(p => p.id === serverPlayer.id);
      if (existing) {
        // Interpolate on sphere surface
        sphereLerp(
          existing.position,
          new THREE.Vector3(serverPlayer.position.x, serverPlayer.position.y, serverPlayer.position.z),
          0.4
        );
        existing.rotation.set(serverPlayer.rotation.x, serverPlayer.rotation.y, serverPlayer.rotation.z);
        existing.username = serverPlayer.username;
        existing.health = serverPlayer.health;
        existing.maxHealth = serverPlayer.maxHealth;
        if (serverPlayer.avatarUrl) existing.avatarUrl = serverPlayer.avatarUrl;
        existing.lastUpdate = Date.now();
      } else {
        world.otherPlayers.push({
          id: serverPlayer.id,
          username: serverPlayer.username,
          avatarUrl: serverPlayer.avatarUrl,
          position: new THREE.Vector3(serverPlayer.position.x, serverPlayer.position.y, serverPlayer.position.z),
          rotation: new THREE.Euler(serverPlayer.rotation.x, serverPlayer.rotation.y, serverPlayer.rotation.z),
          health: serverPlayer.health,
          maxHealth: serverPlayer.maxHealth,
          activeBuffs: [],
          lastUpdate: Date.now()
        });
      }
    }
  }

  // Lasers: merge with local laser state instead of replacing
  // Keep locally-created lasers (client prediction), update server-known lasers
  if (data.lasers) {
    const serverLaserIds = new Set(data.lasers.map(l => l.id));

    // Update existing server lasers with fresh data
    for (const sl of data.lasers) {
      const local = world.lasers.find(l => l.id === sl.id);
      if (local) {
        // Gently correct position on sphere
        sphereLerp(
          local.position,
          new THREE.Vector3(sl.position.x, sl.position.y, sl.position.z),
          0.5
        );
        local.life = sl.life;
      } else if (sl.ownerId !== playerId) {
        // New server laser from another player/NPC — add it.
        // Skip lasers from self: the client prediction laser is already in flight.
        world.lasers.push({
          id: sl.id,
          position: new THREE.Vector3(sl.position.x, sl.position.y, sl.position.z),
          direction: new THREE.Vector3(sl.direction.x, sl.direction.y, sl.direction.z),
          speed: sl.speed,
          life: sl.life,
          owner: sl.ownerId,
          radius: sl.radius
        });
      }
    }

    // Remove local lasers that the server doesn't know about and are old
    // (keep recent client-predicted lasers for a few frames)
    world.lasers = world.lasers.filter(l => {
      if (serverLaserIds.has(l.id)) return true;
      // Keep client-predicted lasers (they have local IDs like laser_0, laser_1)
      if (l.id.startsWith('laser_') && !l.id.includes('_player') && !l.id.includes('_npc')) return l.life > 0;
      return l.life > 0;
    });
  }

  // Update full entity state periodically (every few ticks from server)
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
  const serverIds = new Set(serverAsteroids.map(a => a.id));

  for (const sa of serverAsteroids) {
    const local = world.asteroids.find(a => a.id === sa.id);
    if (local) {
      // Set interpolation target — game loop handles smooth per-frame convergence
      local._serverTarget = new THREE.Vector3(sa.position.x, sa.position.y, sa.position.z);
      local.velocity.set(sa.velocity.x, sa.velocity.y, sa.velocity.z);
      local.health = sa.health;
      local.destroyed = sa.destroyed;
    } else if (!sa.destroyed) {
      // New asteroid from server — add it
      world.asteroids.push({
        id: sa.id,
        position: new THREE.Vector3(sa.position.x, sa.position.y, sa.position.z),
        velocity: new THREE.Vector3(sa.velocity.x, sa.velocity.y, sa.velocity.z),
        rotation: new THREE.Euler(sa.rotation.x, sa.rotation.y, sa.rotation.z),
        rotationSpeed: new THREE.Vector3(sa.rotationSpeed.x, sa.rotationSpeed.y, sa.rotationSpeed.z),
        radius: sa.radius,
        health: sa.health,
        maxHealth: sa.maxHealth,
        puzzleIndex: null,
        destroyed: false
      });
    }
  }

  // Only mark nearby asteroids as destroyed if the server doesn't include them.
  // The server only sends entities within ~250 units, so distant entities
  // missing from the list are simply out of sync range, NOT destroyed.
  for (const local of world.asteroids) {
    if (!local.destroyed && !serverIds.has(local.id)) {
      // Only mark destroyed if it's close enough that the server SHOULD have included it
      if (sphereDistance(world.player.position, local.position) < 200) {
        local.destroyed = true;
      }
    }
  }
}

function syncNpcs(serverNpcs: NpcState[]): void {
  const serverIds = new Set(serverNpcs.map(n => n.id));

  for (const sn of serverNpcs) {
    const local = world.npcs.find(n => n.id === sn.id);
    if (local) {
      // Set interpolation target — game loop handles smooth per-frame convergence
      local._serverTarget = new THREE.Vector3(sn.position.x, sn.position.y, sn.position.z);
      local.velocity.set(sn.velocity.x, sn.velocity.y, sn.velocity.z);
      local.rotation.set(sn.rotation.x, sn.rotation.y, sn.rotation.z);
      local.health = sn.health;
      local.destroyed = sn.destroyed;
      local.converted = sn.converted;
      local.conversionProgress = sn.conversionProgress;
      local.targetNodeId = sn.targetNodeId;
      local.orbitAngle = sn.orbitAngle;
    } else if (!sn.destroyed) {
      // New NPC from server — add it
      world.npcs.push({
        id: sn.id,
        position: new THREE.Vector3(sn.position.x, sn.position.y, sn.position.z),
        velocity: new THREE.Vector3(sn.velocity.x, sn.velocity.y, sn.velocity.z),
        rotation: new THREE.Euler(sn.rotation.x, sn.rotation.y, sn.rotation.z),
        radius: sn.radius,
        health: sn.health,
        maxHealth: sn.maxHealth,
        shootCooldown: sn.shootCooldown,
        destroyed: false,
        converted: sn.converted,
        conversionProgress: sn.conversionProgress,
        targetNodeId: sn.targetNodeId,
        orbitAngle: sn.orbitAngle,
        orbitDistance: sn.orbitDistance,
        hintTimer: 3,
        hintData: null
      });
    }
  }

  // Only mark nearby NPCs as destroyed if the server doesn't include them.
  // The server only sends entities within its sync radius, so distant entities
  // missing from the list are simply out of sync range, NOT destroyed.
  // Never destroy converted NPCs — the server always syncs them, so if they're
  // missing it's a transient gap, not a real destruction.
  for (const local of world.npcs) {
    if (!local.destroyed && !local.converted && !serverIds.has(local.id)) {
      if (sphereDistance(world.player.position, local.position) < 200) {
        local.destroyed = true;
      }
    }
  }
}

function syncPowerUps(serverPowerUps: PowerUpState[]): void {
  for (const sp of serverPowerUps) {
    const local = world.powerUps.find(p => p.id === sp.id);
    if (local) {
      sphereLerp(
        local.position,
        new THREE.Vector3(sp.position.x, sp.position.y, sp.position.z),
        0.3
      );
      local.collected = sp.collected;
    } else if (!sp.collected) {
      // New power-up from server — add it
      world.powerUps.push({
        id: sp.id,
        position: new THREE.Vector3(sp.position.x, sp.position.y, sp.position.z),
        type: sp.type,
        radius: sp.radius,
        collected: false,
        bobPhase: Math.random() * Math.PI * 2
      });
    }
  }
}

function syncPuzzleNodes(serverNodes: PuzzleNodeState[]): void {
  for (const sn of serverNodes) {
    const local = world.puzzleNodes.find(n => n.id === sn.id);
    if (local) {
      // Puzzle nodes are inside the sphere — use plain lerp, NOT sphereLerp
      const target = new THREE.Vector3(sn.position.x, sn.position.y, sn.position.z);
      local.position.lerp(target, 0.3);
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
      const seq = inputSequence++;
      send({
        type: 'input',
        tick: seq,
        ...currentInput
      });

      // Record this input for server reconciliation.
      // dt = INPUT_SEND_RATE in seconds (matches the interval at which
      // inputs are sent and the server processes them).
      recordInput(
        seq,
        currentInput.rotateX,
        currentInput.rotateY,
        currentInput.brake,
        INPUT_SEND_RATE / 1000,
        currentInput.velX,
        currentInput.velY,
        currentInput.velZ
      );
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
export function sendFire(direction?: { x: number; y: number; z: number; }): void {
  if (socket?.readyState !== WebSocket.OPEN) return;
  send({
    type: 'fire',
    tick: inputSequence,
    dirX: direction?.x ?? 0,
    dirY: direction?.y ?? 0,
    dirZ: direction?.z ?? 0
  });
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

export function sendRespawnRequest(): void {
  if (socket?.readyState !== WebSocket.OPEN) return;
  send({ type: 'respawn-request' });
}

/** Host sends this to toggle room privacy (lobby phase only) */
export function sendSetPrivacy(isPrivate: boolean): void {
  if (socket?.readyState !== WebSocket.OPEN) return;
  send({ type: 'set-privacy', isPrivate });
}

/** Host sends this to start the game (lobby phase only) */
export function sendStartGame(): void {
  if (socket?.readyState !== WebSocket.OPEN) return;
  send({ type: 'start-game' });
}

export function disconnect(): void {
  // Prevent any reconnection attempts
  reconnectAttempts = MAX_RECONNECT_ATTEMPTS;
  currentRoomCode = null;

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  stopInputLoop();
  inputHistory.length = 0;
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

export function getRoomCode(): string | null {
  return currentRoomCode;
}

// Legacy export for compatibility
export function sendPosition(): void {
  // No longer needed - inputs are sent automatically
  // Position is computed server-side
}
