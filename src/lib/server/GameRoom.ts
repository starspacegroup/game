/// <reference types="@cloudflare/workers-types" />
/**
 * Cloudflare Durable Object for real-time multiplayer game room
 * Server-authoritative game state with 20 tick/sec simulation
 */

import type {
  PlayerState,
  AsteroidState,
  NpcState,
  LaserState,
  PuzzleNodeState,
  PowerUpState,
  WorldState,
  Vector3,
  ClientMessage,
  ServerMessage,
  InputMessage,
  RoomEvent,
  RoomPhase
} from '../shared/protocol';

import {
  SPHERE_RADIUS,
  TICK_RATE,
  TICK_INTERVAL,
  MAX_PLAYERS,
  ASTEROID_COUNT
} from '../shared/protocol';

import {
  generateWorld,
  createPlayerState,
  respawnAsteroid,
  respawnPowerUp,
  respawnNpc
} from './worldGenerator';

interface PlayerSession {
  id: string;
  username: string;
  lastInput: InputMessage | null;
  lastPing: number;
}

interface StoredState {
  asteroids: AsteroidState[];
  npcs: NpcState[];
  puzzleNodes: PuzzleNodeState[];
  powerUps: PowerUpState[];
  players: PlayerState[];
  puzzleProgress: number;
  puzzleSolved: boolean;
  wave: number;
  tick: number;
}

// ==========================================
// Sphere math helpers (plain objects, no THREE.js)
// ==========================================

/** Project position onto sphere surface (mutating) */
function projectToSphereM(pos: Vector3): void {
  const len = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
  if (len < 0.001) { pos.x = 0; pos.y = 0; pos.z = SPHERE_RADIUS; return; }
  const scale = SPHERE_RADIUS / len;
  pos.x *= scale; pos.y *= scale; pos.z *= scale;
}

/** Chord distance between two 3D points */
function sphereDistance(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Angular distance between two position vectors (angle from sphere center).
 *  Works correctly for points at different radii (surface vs interior). */
function angularDistance(a: Vector3, b: Vector3): number {
  const lenA = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
  const lenB = Math.sqrt(b.x * b.x + b.y * b.y + b.z * b.z);
  if (lenA < 0.001 || lenB < 0.001) return Math.PI;
  const dot = (a.x * b.x + a.y * b.y + a.z * b.z) / (lenA * lenB);
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

/** Get tangent frame (east, north, normal) at a position on the sphere.
 *  Uses Y-up reference; switches to Z-up near the Y-axis poles. */
function getTangentFrame(pos: Vector3): { east: Vector3; north: Vector3; normal: Vector3; } {
  const len = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
  const normal = len > 0.001
    ? { x: pos.x / len, y: pos.y / len, z: pos.z / len }
    : { x: 0, y: 0, z: 1 };

  // Y-up everywhere; Z-up fallback near Y-poles
  let ux: number, uy: number, uz: number;
  if (Math.abs(normal.y) > 0.99) {
    ux = 0; uy = 0; uz = 1;
  } else {
    ux = 0; uy = 1; uz = 0;
  }

  // east = cross(ref, normal)
  let ex = uy * normal.z - uz * normal.y;
  let ey = uz * normal.x - ux * normal.z;
  let ez = ux * normal.y - uy * normal.x;
  const elen = Math.sqrt(ex * ex + ey * ey + ez * ez);
  if (elen > 0) { ex /= elen; ey /= elen; ez /= elen; }

  // north = cross(normal, east)
  const nx = normal.y * ez - normal.z * ey;
  const ny = normal.z * ex - normal.x * ez;
  const nz = normal.x * ey - normal.y * ex;

  return {
    east: { x: ex, y: ey, z: ez },
    north: { x: nx, y: ny, z: nz },
    normal
  };
}

/** Move a position on the sphere by dx (east) and dy (north) in tangent frame */
function moveSphere(pos: Vector3, dx: number, dy: number): void {
  const frame = getTangentFrame(pos);
  pos.x += frame.east.x * dx + frame.north.x * dy;
  pos.y += frame.east.y * dx + frame.north.y * dy;
  pos.z += frame.east.z * dx + frame.north.z * dy;
  projectToSphereM(pos);
}

/** Get direction vector from one sphere position to another */
function sphereDirection(from: Vector3, to: Vector3): { dx: number; dy: number; dz: number; dist: number; } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return { dx, dy, dz, dist };
}

/** Move position toward target on sphere surface by a given speed and deltaTime */
function moveToward(pos: Vector3, target: Vector3, speed: number, dt: number): void {
  const dir = sphereDirection(pos, target);
  if (dir.dist < 0.01) return;
  const step = Math.min(speed * dt, dir.dist);
  pos.x += (dir.dx / dir.dist) * step;
  pos.y += (dir.dy / dir.dist) * step;
  pos.z += (dir.dz / dir.dist) * step;
  projectToSphereM(pos);
}

/** Project an interior point to the sphere surface (returns new object) */
function projectToSurfaceV(pos: Vector3): Vector3 {
  const len = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
  if (len < 0.001) return { x: 0, y: 0, z: SPHERE_RADIUS };
  const scale = SPHERE_RADIUS / len;
  return { x: pos.x * scale, y: pos.y * scale, z: pos.z * scale };
}

export class GameRoom implements DurableObject {
  private state: DurableObjectState;
  private env: Record<string, unknown>;
  private sessions: Map<WebSocket, PlayerSession> = new Map();

  // Full world state
  private tick: number = 0;
  private players: Map<string, PlayerState> = new Map();
  private asteroids: AsteroidState[] = [];
  private npcs: NpcState[] = [];
  private lasers: LaserState[] = [];
  private puzzleNodes: PuzzleNodeState[] = [];
  private powerUps: PowerUpState[] = [];
  private puzzleProgress: number = 0;
  private puzzleSolved: boolean = false;
  private wave: number = 1;

  // Game loop
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private lastTickTime: number = 0;
  private worldInitialized: boolean = false;
  private roomCode: string = '';
  private roomStartTime: number = 0;
  private roomEnded: boolean = false;
  /** Tick at which all players died — endRoom triggers after a short delay */
  private allDeadSinceTick: number = 0;

  // Lobby phase
  private phase: RoomPhase = 'lobby';
  private hostId: string = '';
  private isPrivate: boolean = true;
  private lobbyPlayers: Map<string, { id: string; username: string; avatarUrl?: string; }> = new Map();

  /** Event log for post-game review */
  private eventLog: RoomEvent[] = [];

  constructor(state: DurableObjectState, env?: Record<string, unknown>) {
    this.state = state;
    this.env = env || {};

    // Restore game state from storage
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<StoredState>('worldState');
      if (stored) {
        this.asteroids = stored.asteroids;
        this.npcs = stored.npcs;
        this.puzzleNodes = stored.puzzleNodes;
        this.powerUps = stored.powerUps;
        this.puzzleProgress = stored.puzzleProgress;
        this.puzzleSolved = stored.puzzleSolved;
        this.wave = stored.wave;
        this.tick = stored.tick;
        this.worldInitialized = true;
        this.phase = 'playing'; // If world was stored, game was in progress

        // Restore players (they'll rejoin via WebSocket)
        for (const player of stored.players) {
          this.players.set(player.id, player);
        }

        // Re-assign converted NPCs to nearest nodes (fixes stale targets from old code)
        for (const npc of this.npcs) {
          if (npc.converted && !npc.destroyed) {
            npc.targetNodeId = this.findBestNodeForNpc(npc);
          }
        }
      }

      const roomCode = await this.state.storage.get<string>('roomCode');
      if (roomCode) this.roomCode = roomCode;

      const hostId = await this.state.storage.get<string>('hostId');
      if (hostId) this.hostId = hostId;

      const isPrivate = await this.state.storage.get<boolean>('isPrivate');
      if (isPrivate !== undefined) this.isPrivate = isPrivate;

      const phase = await this.state.storage.get<RoomPhase>('phase');
      if (phase) this.phase = phase;

      const roomEnded = await this.state.storage.get<boolean>('roomEnded');
      if (roomEnded) {
        this.roomEnded = true;
        // Room was ended before DO hibernated — clean up on restore
        this.notifyLobbyDelete();
        this.state.storage.deleteAll();
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request, url);
    }

    // HTTP endpoints for debugging/status
    if (url.pathname === '/status') {
      return Response.json({
        roomCode: this.roomCode,
        phase: this.phase,
        isPrivate: this.isPrivate,
        hostId: this.hostId,
        playerCount: this.phase === 'lobby' ? this.lobbyPlayers.size : this.players.size,
        tick: this.tick,
        players: this.phase === 'lobby'
          ? Array.from(this.lobbyPlayers.values()).map(p => ({
            id: p.id,
            username: p.username,
            score: 0,
            health: 100
          }))
          : Array.from(this.players.values()).map(p => ({
            id: p.id,
            username: p.username,
            score: p.score,
            health: p.health
          })),
        asteroidCount: this.asteroids.filter(a => !a.destroyed).length,
        npcCount: this.npcs.filter(n => !n.destroyed).length,
        puzzleProgress: this.puzzleProgress,
        puzzleSolved: this.puzzleSolved,
        wave: this.wave
      });
    }

    // HTTP: full state dump for superadmin dashboard
    if (url.pathname === '/admin-detail') {
      return Response.json({
        roomCode: this.roomCode,
        phase: this.phase,
        isPrivate: this.isPrivate,
        hostId: this.hostId,
        tick: this.tick,
        wave: this.wave,
        puzzleProgress: this.puzzleProgress,
        puzzleSolved: this.puzzleSolved,
        connectedSockets: this.state.getWebSockets().length,
        players: this.phase === 'lobby'
          ? Array.from(this.lobbyPlayers.values())
          : Array.from(this.players.values()).map(p => ({
            id: p.id,
            username: p.username,
            avatarUrl: p.avatarUrl,
            position: p.position,
            velocity: p.velocity,
            health: p.health,
            maxHealth: p.maxHealth,
            score: p.score,
            speed: p.speed,
            damageCooldownUntil: p.damageCooldownUntil,
            lastProcessedInput: p.lastProcessedInput
          })),
        asteroids: this.asteroids.map(a => ({
          id: a.id,
          position: a.position,
          radius: a.radius,
          health: a.health,
          maxHealth: a.maxHealth,
          destroyed: a.destroyed
        })),
        npcs: this.npcs.map(n => ({
          id: n.id,
          position: n.position,
          health: n.health,
          maxHealth: n.maxHealth,
          destroyed: n.destroyed,
          converted: n.converted,
          conversionProgress: n.conversionProgress,
          targetNodeId: n.targetNodeId
        })),
        lasers: this.lasers.map(l => ({
          id: l.id,
          ownerId: l.ownerId,
          life: l.life
        })),
        puzzleNodes: this.puzzleNodes.map(pn => ({
          id: pn.id,
          position: pn.position,
          targetPosition: pn.targetPosition,
          connected: pn.connected,
          color: pn.color
        })),
        powerUps: this.powerUps.map(pu => ({
          id: pu.id,
          position: pu.position,
          type: pu.type,
          collected: pu.collected
        })),
        eventLog: this.eventLog
      });
    }

    // HTTP: configure room (called by rooms API right after creation)
    if (url.pathname === '/configure' && request.method === 'POST') {
      const body = await request.json() as { hostId?: string; isPrivate?: boolean; roomCode?: string; };
      if (body.hostId) {
        this.hostId = body.hostId;
        this.state.storage.put('hostId', body.hostId);
      }
      if (body.isPrivate !== undefined) {
        this.isPrivate = body.isPrivate;
        this.state.storage.put('isPrivate', body.isPrivate);
      }
      if (body.roomCode) {
        this.roomCode = body.roomCode;
        this.state.storage.put('roomCode', body.roomCode);
      }
      this.phase = 'lobby';
      this.state.storage.put('phase', 'lobby');
      return Response.json({ success: true });
    }

    // Admin: terminate room and disconnect all players
    if (url.pathname === '/terminate' && request.method === 'POST') {
      this.stopGameLoop();

      for (const ws of this.state.getWebSockets()) {
        try {
          ws.close(1000, 'Room terminated by admin');
        } catch {
          // Already closed
        }
      }
      this.sessions.clear();
      this.players.clear();

      await this.state.storage.deleteAll();

      return Response.json({ success: true });
    }

    return new Response('Game Room Durable Object', { status: 200 });
  }

  private handleWebSocket(request: Request, url: URL): Response {
    // Check max players
    if (this.sessions.size >= MAX_PLAYERS) {
      return new Response('Room is full', { status: 503 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // Accept the WebSocket
    this.state.acceptWebSocket(server);

    // Extract room code from URL if provided
    const roomCode = url.searchParams.get('room');
    if (roomCode && !this.roomCode) {
      this.roomCode = roomCode;
      this.state.storage.put('roomCode', roomCode);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Initialize the world if this is the first player
   */
  private initializeWorld(): void {
    if (this.worldInitialized) return;

    const world = generateWorld(1);
    this.asteroids = world.asteroids;
    this.npcs = world.npcs;
    this.puzzleNodes = world.puzzleNodes;
    this.powerUps = world.powerUps;
    this.worldInitialized = true;
    this.roomStartTime = Date.now();

    // Persist initial state
    this.saveState();
  }

  /**
   * Start the game loop when first player joins
   */
  private startGameLoop(): void {
    if (this.tickInterval) return;

    this.lastTickTime = Date.now();
    this.tickInterval = setInterval(() => this.gameTick(), TICK_INTERVAL);
  }

  /**
   * Stop the game loop when all players leave
   */
  private stopGameLoop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  /**
   * Main game tick - runs at 20 ticks/sec
   */
  private gameTick(): void {
    if (this.roomEnded) return;

    const now = Date.now();
    const deltaTime = (now - this.lastTickTime) / 1000;
    this.lastTickTime = now;
    this.tick++;

    // Process player inputs
    this.updatePlayers(deltaTime);

    // Update world entities
    this.updateAsteroids(deltaTime);
    this.updateNpcs(deltaTime);
    this.updateLasers(deltaTime);

    // Check collisions
    this.handleCollisions();

    // Respawn destroyed entities
    this.handleRespawns();

    // Broadcast state to all players
    this.broadcastState();

    // Send room stats to dead players every 10 ticks (~333ms)
    if (this.tick % 10 === 0) {
      this.broadcastRoomStats();
    }

    // Check if all active players are dead (failsafe for endRoom)
    if (this.tick % 20 === 0) {
      this.checkAllDead();
    }

    // Periodic save (every 100 ticks = 5 seconds)
    if (this.tick % 100 === 0) {
      this.saveState();
    }
  }

  /**
   * Update player positions based on inputs (world-space velocity from client)
   */
  private updatePlayers(deltaTime: number): void {
    for (const [ws, session] of this.sessions) {
      const player = this.players.get(session.id);
      if (!player || player.health <= 0) continue;

      const input = session.lastInput;
      if (!input) {
        player.velocity.x = 0;
        player.velocity.y = 0;
        player.velocity.z = 0;
        if (player.shootCooldown > 0) player.shootCooldown -= deltaTime;
        continue;
      }

      // Track which client input we processed (for reconciliation)
      player.lastProcessedInput = input.tick;

      // Direct rotation from client
      player.rotation.z = input.rotateZ;

      // Use world-space velocity from client if available (new protocol).
      // This eliminates frame mismatch: the client computes the velocity
      // using its parallel-transported frame, and we apply it directly.
      const hasWorldVel = input.velX !== undefined && input.velY !== undefined && input.velZ !== undefined;

      if (hasWorldVel) {
        // Clamp velocity magnitude for anti-cheat
        const maxSpeed = player.speed * 2.0; // allow boost
        const velMag = Math.sqrt(input.velX * input.velX + input.velY * input.velY + input.velZ * input.velZ);
        let vx = input.velX, vy = input.velY, vz = input.velZ;
        if (velMag > maxSpeed) {
          const scale = maxSpeed / velMag;
          vx *= scale; vy *= scale; vz *= scale;
        }

        // Apply world-space velocity directly
        player.position.x += vx * deltaTime;
        player.position.y += vy * deltaTime;
        player.position.z += vz * deltaTime;
        projectToSphereM(player.position);

        // Store velocity for broadcast
        player.velocity.x = vx;
        player.velocity.y = vy;
        player.velocity.z = vz;
      } else {
        // Fallback: old protocol (rotateX/rotateY as tangent-frame components)
        const speed = player.speed * (input.brake ? 1.8 : 1);
        let moveX = input.rotateX;
        let moveY = input.rotateY;
        const moveMag = Math.sqrt(moveX * moveX + moveY * moveY);
        if (moveMag > 1) { moveX /= moveMag; moveY /= moveMag; }
        const dx = moveX * speed * deltaTime;
        const dy = moveY * speed * deltaTime;
        if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
          moveSphere(player.position, dx, dy);
        }
        player.velocity.x = moveX * speed;
        player.velocity.y = moveY * speed;
        player.velocity.z = 0;
      }

      // Update shoot cooldown
      if (player.shootCooldown > 0) {
        player.shootCooldown -= deltaTime;
      }
    }
  }

  /**
   * Update asteroid positions and rotations (drift on sphere surface)
   */
  private updateAsteroids(deltaTime: number): void {
    for (const asteroid of this.asteroids) {
      if (asteroid.destroyed) continue;

      // Drift on sphere surface using velocity as tangent-plane components
      moveSphere(asteroid.position, asteroid.velocity.x * deltaTime, asteroid.velocity.y * deltaTime);

      // Update rotation
      asteroid.rotation.x += asteroid.rotationSpeed.x * deltaTime;
      asteroid.rotation.y += asteroid.rotationSpeed.y * deltaTime;
      asteroid.rotation.z += asteroid.rotationSpeed.z * deltaTime;
    }
  }

  /**
   * Update NPC AI and positions (sphere movement)
   */
  private updateNpcs(deltaTime: number): void {
    const playerArray = Array.from(this.players.values()).filter(p => p.health > 0);

    for (const npc of this.npcs) {
      if (npc.destroyed) continue;

      if (npc.converted) {
        this.updateConvertedNpc(npc, deltaTime);
        continue;
      }

      // Handle conversion animation
      if (npc.conversionProgress > 0 && npc.conversionProgress < 1) {
        npc.conversionProgress += deltaTime * 2;
        if (npc.conversionProgress >= 1) {
          npc.converted = true;
          npc.conversionProgress = 1;
          npc.velocity = { x: 0, y: 0, z: 0 };
          npc.targetNodeId = this.findBestNodeForNpc(npc);

          this.logEvent('npc-converted', undefined, `NPC ${npc.id} converted to ally`);

          this.broadcast({
            type: 'npc-converted',
            npcId: npc.id,
            convertedBy: '',
            targetNodeId: npc.targetNodeId || ''
          });
        }
        npc.rotation.z += deltaTime * 10;
        continue;
      }

      // Hostile NPCs chase nearest player
      this.updateHostileNpc(npc, playerArray, deltaTime);

      // Move NPC on sphere surface
      if (Math.abs(npc.velocity.x) > 0.01 || Math.abs(npc.velocity.y) > 0.01) {
        moveSphere(npc.position, npc.velocity.x * deltaTime, npc.velocity.y * deltaTime);
      }

      // Update shoot cooldown
      if (npc.shootCooldown > 0) {
        npc.shootCooldown -= deltaTime;
      }
    }
  }

  private updateConvertedNpc(npc: NpcState, deltaTime: number): void {
    // Reassign if we have no target or the current target is already connected
    const currentTarget = npc.targetNodeId ? this.puzzleNodes.find(n => n.id === npc.targetNodeId) : null;
    if (!currentTarget || currentTarget.connected) {
      this.reassignConvertedNpc(npc);
      if (!npc.targetNodeId) return; // No unconnected nodes left
    }

    const targetNode = this.puzzleNodes.find(n => n.id === npc.targetNodeId)!;

    // NPC stays on the sphere surface.
    // Orbit the surface point directly above the puzzle node.
    const surfaceTarget = projectToSurfaceV(targetNode.position);
    const dist = sphereDistance(npc.position, surfaceTarget);

    if (dist > npc.orbitDistance + 2) {
      // Navigate on sphere surface toward the point above the node
      const navSpeed = 6 * 3;
      moveToward(npc.position, surfaceTarget, navSpeed, deltaTime);

      // Face toward target
      const dir = sphereDirection(npc.position, surfaceTarget);
      const frame = getTangentFrame(npc.position);
      const localX = dir.dx * frame.east.x + dir.dy * frame.east.y + dir.dz * frame.east.z;
      const localY = dir.dx * frame.north.x + dir.dy * frame.north.y + dir.dz * frame.north.z;
      npc.rotation.z = Math.atan2(localX, -localY);
    } else {
      // Orbit on sphere surface above the node
      npc.orbitAngle += deltaTime * 1.5;
      const frame = getTangentFrame(surfaceTarget);
      const ox = Math.cos(npc.orbitAngle) * npc.orbitDistance;
      const oy = Math.sin(npc.orbitAngle) * npc.orbitDistance;
      npc.position.x = surfaceTarget.x + frame.east.x * ox + frame.north.x * oy;
      npc.position.y = surfaceTarget.y + frame.east.y * ox + frame.north.y * oy;
      npc.position.z = surfaceTarget.z + frame.east.z * ox + frame.north.z * oy;
      projectToSphereM(npc.position);

      npc.rotation.z = npc.orbitAngle + Math.PI / 2;
      npc.velocity.x = 0;
      npc.velocity.y = 0;

      // Generate hints while orbiting
      npc.shootCooldown -= deltaTime;
      if (npc.shootCooldown <= 0) {
        npc.shootCooldown = 4 + Math.random() * 3;

        const hint = this.generateHint(targetNode);
        this.broadcast({
          type: 'hint',
          nodeId: targetNode.id,
          hint,
          fromNpcId: npc.id
        });

        // Help push node toward target (inside sphere)
        if (!targetNode.connected) {
          const tdx = targetNode.targetPosition.x - targetNode.position.x;
          const tdy = targetNode.targetPosition.y - targetNode.position.y;
          const tdz = targetNode.targetPosition.z - targetNode.position.z;
          targetNode.position.x += tdx * 0.01;
          targetNode.position.y += tdy * 0.01;
          targetNode.position.z += tdz * 0.01;
          this.checkPuzzleProgress();
        }
      }
    }
  }

  private updateHostileNpc(npc: NpcState, players: PlayerState[], deltaTime: number): void {
    if (players.length === 0) return;

    // Find nearest player
    let nearestPlayer: PlayerState | null = null;
    let nearestDist = Infinity;

    for (const player of players) {
      const dist = sphereDistance(npc.position, player.position);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestPlayer = player;
      }
    }

    if (!nearestPlayer) return;

    const dir = sphereDirection(npc.position, nearestPlayer.position);
    const speed = 6;

    // Project direction into tangent plane for movement
    const frame = getTangentFrame(npc.position);
    const localDx = dir.dx * frame.east.x + dir.dy * frame.east.y + dir.dz * frame.east.z;
    const localDy = dir.dx * frame.north.x + dir.dy * frame.north.y + dir.dz * frame.north.z;
    const localDist = Math.sqrt(localDx * localDx + localDy * localDy);

    if (localDist > 0.01) {
      if (dir.dist > 2.5) {
        // Chase
        npc.velocity.x = (localDx / localDist) * speed;
        npc.velocity.y = (localDy / localDist) * speed;
      } else {
        // Circle tightly when close
        npc.velocity.x = (-localDy / localDist) * speed * 0.8;
        npc.velocity.y = (localDx / localDist) * speed * 0.8;
      }
    }

    // Point towards player (atan2(east, -north) so the cone nose faces target)
    npc.rotation.z = Math.atan2(localDx, -localDy);

    // Shoot at player if in range
    if (nearestDist < 40 && npc.shootCooldown <= 0) {
      // Fire direction: 3D vector toward player
      const fireDir = dir.dist > 0
        ? { x: dir.dx / dir.dist, y: dir.dy / dir.dist, z: dir.dz / dir.dist }
        : { x: 0, y: 0, z: 1 };
      this.createNpcLaser(npc.id, npc.position, fireDir);
      npc.shootCooldown = 5 + Math.random() * 2;
    }
  }

  /**
   * Update laser positions and lifetime (move along direction, project to sphere)
   */
  private updateLasers(deltaTime: number): void {
    for (let i = this.lasers.length - 1; i >= 0; i--) {
      const laser = this.lasers[i];

      laser.position.x += laser.direction.x * laser.speed * deltaTime;
      laser.position.y += laser.direction.y * laser.speed * deltaTime;
      laser.position.z += laser.direction.z * laser.speed * deltaTime;

      // Project back to sphere surface
      projectToSphereM(laser.position);

      // Parallel-transport direction to stay tangent to sphere at new position.
      // This makes lasers travel along great circles instead of slowing down.
      const len = Math.sqrt(laser.position.x ** 2 + laser.position.y ** 2 + laser.position.z ** 2);
      if (len > 0.001) {
        const nx = laser.position.x / len, ny = laser.position.y / len, nz = laser.position.z / len;
        const dot = laser.direction.x * nx + laser.direction.y * ny + laser.direction.z * nz;
        laser.direction.x -= dot * nx;
        laser.direction.y -= dot * ny;
        laser.direction.z -= dot * nz;
        // Re-normalize direction
        const dLen = Math.sqrt(laser.direction.x ** 2 + laser.direction.y ** 2 + laser.direction.z ** 2);
        if (dLen > 0.001) {
          laser.direction.x /= dLen;
          laser.direction.y /= dLen;
          laser.direction.z /= dLen;
        }
      }

      laser.life -= deltaTime;

      if (laser.life <= 0) {
        this.lasers.splice(i, 1);
      }
    }
  }

  /**
   * Handle all collision detection (using chord distance on sphere)
   */
  private handleCollisions(): void {
    // Player vs Power-ups
    for (const player of this.players.values()) {
      if (player.health <= 0) continue;

      for (const powerUp of this.powerUps) {
        if (powerUp.collected) continue;

        const dist = sphereDistance(player.position, powerUp.position);
        if (dist < 1 + powerUp.radius) {
          this.collectPowerUp(player, powerUp);
        }
      }

      // Player vs Puzzle Nodes (angular proximity — player on surface, nodes inside)
      for (const node of this.puzzleNodes) {
        if (node.connected) continue;

        // Project node to surface, then check distance from player
        const surfaceNode = projectToSurfaceV(node.position);
        const dist = sphereDistance(player.position, surfaceNode);
        if (dist < 1 + node.radius + 20) {
          this.interactPuzzleNode(node);
        }
      }

      // Player vs hostile NPCs - deal damage, teleport away, grant invincibility
      for (const npc of this.npcs) {
        if (npc.destroyed || npc.converted || npc.conversionProgress > 0) continue;
        if (Date.now() < player.damageCooldownUntil) continue;

        const dist = sphereDistance(player.position, npc.position);
        if (dist < 1 + npc.radius + 0.5) {
          this.damagePlayer(player.id, 25);
          // Teleport player to a safe position away from all NPCs
          this.teleportPlayerToSafety(player);
          // 1-second invincibility
          player.damageCooldownUntil = Date.now() + 1000;
          break; // Only one NPC collision per frame
        }
      }
    }

    // Lasers vs targets
    for (let i = this.lasers.length - 1; i >= 0; i--) {
      const laser = this.lasers[i];
      let hit = false;

      // Player lasers vs NPCs → conversion
      if (this.players.has(laser.ownerId)) {
        for (const npc of this.npcs) {
          if (npc.destroyed || npc.converted || npc.conversionProgress > 0) continue;

          const dist = sphereDistance(laser.position, npc.position);
          if (dist < laser.radius + npc.radius + 1.0) {
            npc.conversionProgress = 0.01;
            const owner = this.players.get(laser.ownerId);
            if (owner) owner.score += 25;
            hit = true;
            break;
          }
        }
      }

      // NPC lasers vs players
      if (!hit && !this.players.has(laser.ownerId)) {
        for (const player of this.players.values()) {
          if (player.health <= 0) continue;
          if (Date.now() < player.damageCooldownUntil) continue;

          const dist = sphereDistance(laser.position, player.position);
          if (dist < laser.radius + 1) {
            this.damagePlayer(player.id, 15);
            hit = true;
            break;
          }
        }
      }

      if (hit) {
        this.lasers.splice(i, 1);
      }
    }
  }

  /**
   * Respawn destroyed entities
   */
  private handleRespawns(): void {
    // Respawn asteroids
    const activeAsteroids = this.asteroids.filter(a => !a.destroyed);
    if (activeAsteroids.length < ASTEROID_COUNT * 0.8) {
      const toRespawn = ASTEROID_COUNT - activeAsteroids.length;
      for (let i = 0; i < Math.min(toRespawn, 5); i++) {
        const newAsteroid = respawnAsteroid();
        const destroyedIdx = this.asteroids.findIndex(a => a.destroyed);
        if (destroyedIdx >= 0) {
          this.asteroids[destroyedIdx] = newAsteroid;
        } else {
          this.asteroids.push(newAsteroid);
        }
      }
    }

    // Respawn power-ups
    const activePowerUps = this.powerUps.filter(p => !p.collected);
    if (activePowerUps.length < 50) {
      const newPowerUp = respawnPowerUp();
      const collectedIdx = this.powerUps.findIndex(p => p.collected);
      if (collectedIdx >= 0) {
        this.powerUps[collectedIdx] = newPowerUp;
      } else {
        this.powerUps.push(newPowerUp);
      }
    }

    // Respawn NPCs based on wave
    const activeNpcs = this.npcs.filter(n => !n.destroyed && !n.converted);
    const targetNpcCount = Math.max(1, 3 - this.players.size + this.wave);
    if (activeNpcs.length < targetNpcCount && this.players.size > 0) {
      // Spawn far from all players (off-screen)
      const playerArray = Array.from(this.players.values());
      const randomPlayer = playerArray[Math.floor(Math.random() * playerArray.length)];
      const newNpc = respawnNpc(randomPlayer.position);

      const destroyedIdx = this.npcs.findIndex(n => n.destroyed);
      if (destroyedIdx >= 0) {
        this.npcs[destroyedIdx] = newNpc;
      } else {
        this.npcs.push(newNpc);
      }
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;

    try {
      const data = JSON.parse(message) as ClientMessage;
      await this.handleMessage(ws, data);
    } catch (e) {
      console.error('Failed to parse WebSocket message:', e);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const session = this.sessions.get(ws);
    if (session) {
      this.sessions.delete(ws);

      // Remove from lobby players if in lobby phase
      if (this.phase === 'lobby') {
        this.lobbyPlayers.delete(session.id);
        this.broadcastLobbyState();
      }

      // Keep player state (for potential rejoin) but mark as disconnected
      // Don't remove from this.players to preserve state

      // Broadcast player left to all other players
      this.broadcast({
        type: 'player-left',
        playerId: session.id,
        playerCount: this.sessions.size
      } as ServerMessage);

      this.logEvent('player-left', session.username, `left the game`);

      if (this.sessions.size === 0) {
        // No players remain — end the room properly
        this.stopGameLoop();

        if (!this.roomEnded) {
          // Check if all players were dead (game over but endRoom hadn't fired yet)
          const anyAlive = Array.from(this.players.values()).some(p => p.health > 0);
          if (!anyAlive && this.players.size > 0 && this.phase === 'playing') {
            // End the room (which archives it in the lobby)
            this.endRoom('All players eliminated');
          } else {
            // Players left voluntarily — just delete from lobby
            this.saveState();
            this.notifyLobbyDelete();
          }
        } else {
          // Room already ended — ensure lobby knows (archive may have failed earlier)
          const duration = this.roomStartTime > 0
            ? Math.round((Date.now() - this.roomStartTime) / 1000)
            : 0;
          const playerList = Array.from(this.players.values()).map(p => ({
            id: p.id, username: p.username, score: p.score
          }));
          this.notifyLobbyArchive(duration, playerList);
        }
      } else if (!this.roomEnded) {
        // Still players remaining — notify lobby of updated count
        this.notifyLobby();
      }
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  private async handleMessage(ws: WebSocket, data: ClientMessage): Promise<void> {
    switch (data.type) {
      case 'join': {
        const playerId = data.id;
        const username = data.username || 'Player';

        // Kick any existing session for the same player ID (prevents
        // the same Discord account from joining on multiple devices).
        for (const [existingWs, existingSession] of this.sessions) {
          if (existingSession.id === playerId && existingWs !== ws) {
            this.send(existingWs, {
              type: 'error',
              code: 'duplicate-session',
              message: 'You joined from another device. This session has been disconnected.'
            });
            try {
              existingWs.close(4009, 'duplicate-session');
            } catch {
              // Already closed
            }
            this.sessions.delete(existingWs);
          }
        }

        this.sessions.set(ws, {
          id: playerId,
          username,
          lastInput: null,
          lastPing: Date.now()
        });

        // If in lobby phase, add to lobby players and broadcast lobby state
        if (this.phase === 'lobby') {
          this.lobbyPlayers.set(playerId, {
            id: playerId,
            username,
            avatarUrl: data.avatarUrl
          });

          // Set host if first player (in case configure wasn't called)
          if (!this.hostId) {
            this.hostId = playerId;
            this.state.storage.put('hostId', playerId);
          }

          // Send lobby state to the new player
          this.broadcastLobbyState();

          // Notify external lobby of updated player count
          this.notifyLobby();
          break;
        }

        // === Playing phase: full game join ===
        // Initialize world on first player
        this.initializeWorld();

        // Create or restore player state
        let player = this.players.get(playerId);
        if (!player) {
          player = createPlayerState(playerId, username);
          this.players.set(playerId, player);
        } else {
          // Restore player (rejoin)
          player.username = username;
          player.health = player.maxHealth; // Reset health on rejoin
        }

        // Store avatar URL if provided
        if (data.avatarUrl) {
          player.avatarUrl = data.avatarUrl;
        }

        // Start game loop if first player
        if (this.sessions.size === 1) {
          this.startGameLoop();
        }

        // Send full world state to the new player
        // Only include players with active sessions to avoid ghost duplicates
        const activePlayers = this.getActivePlayers();
        const worldState: WorldState = {
          tick: this.tick,
          players: activePlayers,
          asteroids: this.asteroids,
          npcs: this.npcs,
          lasers: this.lasers,
          puzzleNodes: this.puzzleNodes,
          powerUps: this.powerUps,
          puzzleProgress: this.puzzleProgress,
          puzzleSolved: this.puzzleSolved,
          wave: this.wave
        };

        this.send(ws, {
          type: 'welcome',
          playerId,
          roomCode: this.roomCode,
          state: worldState
        });

        // Broadcast new player to all others
        this.broadcast({
          type: 'player-joined',
          player,
          playerCount: this.sessions.size
        }, ws);

        this.logEvent('player-joined', username, `joined the crew`);

        // Notify lobby of updated player count
        this.notifyLobby();
        break;
      }

      case 'set-privacy': {
        const session = this.sessions.get(ws);
        if (!session || session.id !== this.hostId) break; // Only host can change
        if (this.phase !== 'lobby') break; // Only in lobby phase

        this.isPrivate = data.isPrivate;
        this.state.storage.put('isPrivate', data.isPrivate);

        // Broadcast updated lobby state
        this.broadcastLobbyState();

        // Notify external lobby (so public rooms appear/disappear)
        this.notifyLobby();
        break;
      }

      case 'start-game': {
        const session = this.sessions.get(ws);
        if (!session || session.id !== this.hostId) break; // Only host can start
        if (this.phase !== 'lobby') break; // Only from lobby phase

        // Transition to playing phase
        this.phase = 'playing';
        this.state.storage.put('phase', 'playing');

        // Initialize world
        this.initializeWorld();

        // Create player states for all lobby players
        for (const [pid, lobbyPlayer] of this.lobbyPlayers) {
          let player = this.players.get(pid);
          if (!player) {
            player = createPlayerState(pid, lobbyPlayer.username);
            this.players.set(pid, player);
          }
          if (lobbyPlayer.avatarUrl) {
            player.avatarUrl = lobbyPlayer.avatarUrl;
          }
        }

        // Start game loop
        this.startGameLoop();

        // Send game-started to all clients
        this.broadcast({ type: 'game-started' } as ServerMessage);

        // Send welcome with full world state to each player
        const allPlayers = this.getActivePlayers();
        for (const [clientWs, clientSession] of this.sessions) {
          const ws2: WorldState = {
            tick: this.tick,
            players: allPlayers,
            asteroids: this.asteroids,
            npcs: this.npcs,
            lasers: this.lasers,
            puzzleNodes: this.puzzleNodes,
            powerUps: this.powerUps,
            puzzleProgress: this.puzzleProgress,
            puzzleSolved: this.puzzleSolved,
            wave: this.wave
          };

          this.send(clientWs, {
            type: 'welcome',
            playerId: clientSession.id,
            roomCode: this.roomCode,
            state: ws2
          });
        }

        this.logEvent('game-started', this.hostId, 'host started the game');

        // Clear lobby players (they're now in this.players)
        this.lobbyPlayers.clear();

        // Notify external lobby of updated state
        this.notifyLobby();
        break;
      }

      case 'input': {
        const session = this.sessions.get(ws);
        if (session) {
          session.lastInput = data;
          session.lastPing = Date.now();
        }
        break;
      }

      case 'fire': {
        const session = this.sessions.get(ws);
        if (!session) return;

        const player = this.players.get(session.id);
        if (!player || player.health <= 0 || player.shootCooldown > 0) return;

        // Use the world-space fire direction sent by the client.
        // The client computes this using its parallel-transported frame,
        // which avoids the geographic-frame mismatch that causes direction
        // to depend on position on the sphere.
        let direction: Vector3;
        if (data.dirX !== undefined && data.dirY !== undefined && data.dirZ !== undefined) {
          const dLen = Math.sqrt(data.dirX * data.dirX + data.dirY * data.dirY + data.dirZ * data.dirZ);
          if (dLen > 0.001) {
            direction = { x: data.dirX / dLen, y: data.dirY / dLen, z: data.dirZ / dLen };
          } else {
            // Fallback: geographic frame
            const frame = getTangentFrame(player.position);
            direction = { x: frame.north.x, y: frame.north.y, z: frame.north.z };
          }
        } else {
          // Legacy client without direction fields
          const frame = getTangentFrame(player.position);
          const angle = player.rotation.z;
          const sinA = Math.sin(angle);
          const cosA = Math.cos(angle);
          direction = {
            x: -sinA * frame.east.x + cosA * frame.north.x,
            y: -sinA * frame.east.y + cosA * frame.north.y,
            z: -sinA * frame.east.z + cosA * frame.north.z
          };
        }

        this.createLaser(player.id, player.position, direction);
        player.shootCooldown = 0.15; // Match solo SHOOT_COOLDOWN
        break;
      }

      case 'interact': {
        const session = this.sessions.get(ws);
        if (!session) return;

        const player = this.players.get(session.id);
        if (!player || player.health <= 0) return;

        switch (data.targetType) {
          case 'puzzle-node': {
            const node = this.puzzleNodes.find(n => n.id === data.targetId);
            if (node && data.action === 'move' && data.position) {
              node.position = data.position;
              this.checkPuzzleProgress();
            }
            break;
          }
          case 'npc': {
            if (data.action === 'convert') {
              const npc = this.npcs.find(n => n.id === data.targetId);
              if (npc && !npc.converted && !npc.destroyed) {
                this.convertNpc(npc, player.id);
              }
            }
            break;
          }
        }
        break;
      }

      case 'chat': {
        const session = this.sessions.get(ws);
        if (!session) return;

        this.broadcast({
          type: 'chat-broadcast',
          sender: session.username,
          senderId: session.id,
          text: data.text,
          timestamp: Date.now()
        });
        break;
      }

      case 'respawn-request': {
        const session = this.sessions.get(ws);
        if (!session) return;

        const player = this.players.get(session.id);
        if (!player || player.health > 0) return; // Not dead, ignore

        // Only allow rejoin if at least one other player is alive
        const otherAlive = this.getActivePlayers().some(p => p.id !== session.id && p.health > 0);
        if (!otherAlive) return; // Can't rejoin a doomed room

        // Respawn the player
        player.health = player.maxHealth;
        player.position = { x: 0, y: 0, z: SPHERE_RADIUS };
        player.velocity = { x: 0, y: 0, z: 0 };

        this.broadcast({
          type: 'player-respawn',
          player
        });
        break;
      }
    }
  }

  // ==========================================
  // Helper Methods
  // ==========================================

  private createLaser(ownerId: string, position: Vector3, direction: Vector3): void {
    const laser: LaserState = {
      id: `laser_${this.tick}_${ownerId}`,
      ownerId,
      position: { ...position },
      direction,
      speed: 60,
      life: 2,
      radius: 0.3
    };
    this.lasers.push(laser);
  }

  private createNpcLaser(ownerId: string, position: Vector3, direction: Vector3): void {
    const laser: LaserState = {
      id: `laser_${this.tick}_${ownerId}`,
      ownerId,
      position: { ...position },
      direction,
      speed: 30,
      life: 1.4,
      radius: 0.2
    };
    this.lasers.push(laser);
  }

  private damagePlayer(playerId: string, damage: number): void {
    const player = this.players.get(playerId);
    if (!player) return;
    if (Date.now() < player.damageCooldownUntil) return;

    player.health = Math.max(0, player.health - damage);

    this.broadcast({
      type: 'player-hit',
      playerId,
      damage,
      health: player.health
    });

    if (player.health <= 0) {
      this.logEvent('player-died', player.username, `eliminated (took ${damage} damage)`);

      // Check if all active (connected) players are now dead
      const allDead = this.getActivePlayers().every(p => p.health <= 0);

      if (allDead && this.sessions.size > 0) {
        // Mark the tick when all players died; endRoom will fire after a delay
        // checked in gameTick via checkAllDead()
        if (this.allDeadSinceTick === 0) {
          this.allDeadSinceTick = this.tick;
          this.logEvent('all-eliminated', undefined, 'All crew eliminated');
        }
      } else {
        // Other players still alive — send room stats so dead player sees death screen
        // Player can manually request respawn via 'respawn-request' message
        this.sendRoomStatsToPlayer(playerId);
      }
    }
  }

  /** Teleport player a short distance away from NPCs */
  private teleportPlayerToSafety(player: PlayerState): void {
    // Generate candidates near the player (10-20 units away)
    let bestPos = this.randomSpherePositionNear(player.position, 10, 20);
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = this.randomSpherePositionNear(player.position, 10, 20);
      const tooClose = this.npcs.some(
        (n) => !n.destroyed && sphereDistance(candidate, n.position) < 8
      );
      if (!tooClose) {
        bestPos = candidate;
        break;
      }
    }
    player.position = bestPos;
    player.velocity = { x: 0, y: 0, z: 0 };
  }

  /** Generate a random position on the sphere near a given point */
  private randomSpherePositionNear(center: Vector3, minDist: number, maxDist: number): Vector3 {
    const { east, north } = getTangentFrame(center);
    const angle = Math.random() * Math.PI * 2;
    const dist = minDist + Math.random() * (maxDist - minDist);
    const pos = {
      x: center.x + east.x * Math.cos(angle) * dist + north.x * Math.sin(angle) * dist,
      y: center.y + east.y * Math.cos(angle) * dist + north.y * Math.sin(angle) * dist,
      z: center.z + east.z * Math.cos(angle) * dist + north.z * Math.sin(angle) * dist
    };
    projectToSphereM(pos);
    return pos;
  }

  private collectPowerUp(player: PlayerState, powerUp: PowerUpState): void {
    powerUp.collected = true;

    switch (powerUp.type) {
      case 'health':
        player.health = Math.min(player.maxHealth, player.health + 25);
        break;
      case 'speed':
        player.speed = 20;
        // Temporary boost matching solo mode (8 seconds)
        setTimeout(() => { player.speed = 12; }, 8000);
        break;
      case 'shield':
        player.health = Math.min(player.maxHealth + 50, player.health + 50);
        break;
      case 'multishot':
        // Handled client-side for visual effects
        break;
    }

    this.broadcast({
      type: 'power-up-collected',
      powerUpId: powerUp.id,
      playerId: player.id,
      powerUpType: powerUp.type
    });

    this.logEvent('power-up', player.username, `collected ${powerUp.type}`);
  }

  private interactPuzzleNode(node: PuzzleNodeState): void {
    const dx = node.targetPosition.x - node.position.x;
    const dy = node.targetPosition.y - node.position.y;
    const dz = node.targetPosition.z - node.position.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Lerp toward target (inside sphere, no surface projection)
    node.position.x += dx * 0.05;
    node.position.y += dy * 0.05;
    node.position.z += dz * 0.05;

    if (dist < 8) {
      node.position = { ...node.targetPosition };
      node.connected = true;
      this.checkPuzzleProgress();
    }
  }

  private convertNpc(npc: NpcState, convertedBy: string): void {
    npc.converted = true;
    npc.conversionProgress = 1;
    npc.velocity = { x: 0, y: 0, z: 0 };

    // Assign to nearest unconnected puzzle node using surface-projected distance,
    // preferring nodes not already targeted by other converted NPCs
    npc.targetNodeId = this.findBestNodeForNpc(npc);

    this.broadcast({
      type: 'npc-converted',
      npcId: npc.id,
      convertedBy,
      targetNodeId: npc.targetNodeId || ''
    });
  }

  /** Reassign a converted NPC to the nearest unconnected puzzle node */
  private reassignConvertedNpc(npc: NpcState): void {
    npc.targetNodeId = this.findBestNodeForNpc(npc);
  }

  /** Find the nearest unconnected puzzle node for a converted NPC.
   *  Prefers nodes not already targeted by other converted NPCs,
   *  but only if the untargeted node is within 1.5x the distance of the absolute nearest.
   *  Uses surface-projected chord distance for accurate travel distance. */
  private findBestNodeForNpc(npc: NpcState): string | null {
    // Collect node IDs already targeted by other converted NPCs
    const takenIds = new Set<string>();
    for (const other of this.npcs) {
      if (other === npc || other.destroyed || !other.converted) continue;
      if (other.targetNodeId) takenIds.add(other.targetNodeId);
    }

    let bestUntargeted: PuzzleNodeState | null = null;
    let bestUntargetedDist = Infinity;
    let bestOverall: PuzzleNodeState | null = null;
    let bestOverallDist = Infinity;

    // NPC is on sphere surface — project each node to surface and measure chord distance
    const npcLen = Math.sqrt(npc.position.x * npc.position.x + npc.position.y * npc.position.y + npc.position.z * npc.position.z);
    if (npcLen < 0.001) return null;

    for (const node of this.puzzleNodes) {
      if (node.connected) continue;

      const nodeLen = Math.sqrt(node.position.x * node.position.x + node.position.y * node.position.y + node.position.z * node.position.z);
      if (nodeLen < 0.001) continue;
      const scale = npcLen / nodeLen;
      const px = node.position.x * scale;
      const py = node.position.y * scale;
      const pz = node.position.z * scale;

      const dx = npc.position.x - px;
      const dy = npc.position.y - py;
      const dz = npc.position.z - pz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      // Track absolute nearest
      if (dist < bestOverallDist) {
        bestOverallDist = dist;
        bestOverall = node;
      }

      // Track nearest untargeted
      if (!takenIds.has(node.id) && dist < bestUntargetedDist) {
        bestUntargetedDist = dist;
        bestUntargeted = node;
      }
    }

    // Always prefer an untargeted node — each NPC should service a different node.
    // Only fall back to a targeted (shared) node if every unconnected node is already claimed.
    if (bestUntargeted) {
      return bestUntargeted.id;
    }
    return bestOverall?.id || null;
  }

  private checkPuzzleProgress(): void {
    const connectedCount = this.puzzleNodes.filter(n => n.connected).length;
    this.puzzleProgress = (connectedCount / this.puzzleNodes.length) * 100;
    this.puzzleSolved = this.puzzleProgress >= 100;

    if (this.puzzleSolved) {
      // Advance wave
      this.wave++;
      this.logEvent('wave-advance', undefined, `Wave ${this.wave} reached — puzzle solved!`);
    } else if (connectedCount > 0 && connectedCount % 3 === 0) {
      // Log milestone progress (every 3 nodes)
      this.logEvent('puzzle-progress', undefined, `${connectedCount}/${this.puzzleNodes.length} nodes aligned (${Math.round(this.puzzleProgress)}%)`);
    }
  }

  private broadcastState(): void {
    // Send per-player state with only nearby entities to reduce bandwidth
    const activePlayers = this.getActivePlayers();
    const ENTITY_SYNC_RADIUS = 100; // Only sync entities within this distance

    for (const [ws, session] of this.sessions) {
      const player = this.players.get(session.id);
      if (!player) continue;

      const stateMsg: ServerMessage = {
        type: 'state',
        tick: this.tick,
        players: activePlayers,
        lasers: this.lasers.filter(l =>
          sphereDistance(l.position, player.position) < ENTITY_SYNC_RADIUS
        ),
        // Send entity snapshots every 3 ticks (~100ms) — only nearby ones
        ...(this.tick % 3 === 0 && {
          asteroids: this.asteroids.filter(a =>
            !a.destroyed && sphereDistance(a.position, player.position) < ENTITY_SYNC_RADIUS
          ),
          npcs: this.npcs.filter(n =>
            !n.destroyed && (n.converted || sphereDistance(n.position, player.position) < ENTITY_SYNC_RADIUS)
          ),
          powerUps: this.powerUps.filter(p =>
            !p.collected && sphereDistance(p.position, player.position) < ENTITY_SYNC_RADIUS
          ),
          puzzleNodes: this.puzzleNodes
        }),
        puzzleProgress: this.puzzleProgress,
        puzzleSolved: this.puzzleSolved
      };

      this.send(ws, stateMsg);
    }
  }

  /**
   * Build a room-stats payload for dead players / spectators.
   */
  private buildRoomStats(): ServerMessage {
    const activePlayers = this.getActivePlayers();
    const aliveCount = activePlayers.filter(p => p.health > 0).length;
    return {
      type: 'room-stats',
      playerCount: this.sessions.size,
      aliveCount,
      players: activePlayers.map(p => ({
        id: p.id,
        username: p.username,
        score: p.score,
        health: p.health,
        maxHealth: p.maxHealth
      })),
      wave: this.wave,
      puzzleProgress: this.puzzleProgress,
      puzzleSolved: this.puzzleSolved,
      canRejoin: aliveCount > 0
    } as ServerMessage;
  }

  /**
   * Send room stats to a specific player (e.g. when they just died).
   */
  private sendRoomStatsToPlayer(playerId: string): void {
    for (const [ws, session] of this.sessions) {
      if (session.id === playerId) {
        this.send(ws, this.buildRoomStats());
        break;
      }
    }
  }

  /**
   * Broadcast room stats to all dead (connected) players so they see
   * real-time updates on the death screen.
   */
  private broadcastRoomStats(): void {
    const stats = this.buildRoomStats();
    for (const [ws, session] of this.sessions) {
      const player = this.players.get(session.id);
      if (player && player.health <= 0) {
        this.send(ws, stats);
      }
    }
  }

  private async saveState(): Promise<void> {
    const state: StoredState = {
      asteroids: this.asteroids,
      npcs: this.npcs,
      puzzleNodes: this.puzzleNodes,
      powerUps: this.powerUps,
      players: Array.from(this.players.values()),
      puzzleProgress: this.puzzleProgress,
      puzzleSolved: this.puzzleSolved,
      wave: this.wave,
      tick: this.tick
    };

    await this.state.storage.put('worldState', state);
  }

  // ==========================================
  // Event log
  // ==========================================

  /** Record a timestamped event for the post-game log */
  private logEvent(event: string, actor?: string, detail?: string): void {
    this.eventLog.push({
      time: Date.now(),
      event,
      actor,
      detail
    });
  }

  /**
   * End the room gracefully: stop simulation, broadcast the full event log
   * and final stats to all connected clients. The room stays alive so
   * clients can review the log at their leisure.
   */
  private endRoom(reason: string): void {
    if (this.roomEnded) return;
    this.roomEnded = true;
    this.stopGameLoop();

    this.logEvent('room-ended', undefined, reason);

    const duration = this.roomStartTime > 0
      ? Math.round((Date.now() - this.roomStartTime) / 1000)
      : 0;

    const playerList = Array.from(this.players.values()).map(p => ({
      id: p.id,
      username: p.username,
      score: p.score
    }));

    // Build the room-ended payload
    const msg: ServerMessage = {
      type: 'room-ended',
      reason,
      duration,
      finalWave: this.wave,
      finalPuzzleProgress: this.puzzleProgress,
      players: playerList,
      eventLog: this.eventLog
    };

    this.broadcast(msg);

    // Archive the room in the lobby (instead of deleting)
    this.notifyLobbyArchive(duration, playerList);

    // Persist ended flag so restoration doesn't revive the room
    this.state.storage.put('roomEnded', true);
  }

  /**
   * Periodic check: if all active players are dead for ~2 seconds (40 ticks),
   * end the room. This is a robust fallback that doesn't rely on setTimeout.
   */
  private checkAllDead(): void {
    if (this.roomEnded || this.sessions.size === 0) return;

    const activePlayers = this.getActivePlayers();
    if (activePlayers.length === 0) return;

    const allDead = activePlayers.every(p => p.health <= 0);

    if (allDead) {
      if (this.allDeadSinceTick === 0) {
        // First detection — start the countdown
        this.allDeadSinceTick = this.tick;
        this.logEvent('all-eliminated', undefined, 'All crew eliminated');
      } else if (this.tick - this.allDeadSinceTick >= 40) {
        // ~2 seconds have passed since all players died
        this.endRoom('All players eliminated');
      }
    } else {
      // Someone is alive (e.g. respawned) — reset the counter
      this.allDeadSinceTick = 0;
    }
  }

  /**
   * Terminate the room: broadcast game-over, close all connections,
   * notify lobby, and clear storage.
   */
  private terminateRoom(reason: string): void {
    this.stopGameLoop();

    // Broadcast termination to all connected clients
    this.broadcast({
      type: 'room-terminated',
      reason
    });

    // Close all WebSocket connections
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.close(1000, reason);
      } catch {
        // Already closed
      }
    }
    this.sessions.clear();
    this.players.clear();

    // Notify lobby to remove this room
    this.notifyLobbyDelete();

    // Clear all persisted state so the DO can be garbage-collected
    this.state.storage.deleteAll();
  }

  /**
   * Notify the GameLobby Durable Object to delete this room.
   */
  private notifyLobbyDelete(): void {
    const lobbyBinding = this.env.GAME_LOBBY as DurableObjectNamespace | undefined;
    if (!lobbyBinding) return;

    try {
      const lobbyId = lobbyBinding.idFromName('global');
      const lobby = lobbyBinding.get(lobbyId);

      lobby.fetch(new Request('https://internal/room-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', roomId: this.roomCode })
      })).catch(() => { /* best-effort */ });
    } catch {
      // Lobby binding unavailable — ignore
    }
  }

  /**
   * Notify the GameLobby to archive this room (move from active to past games).
   */
  private notifyLobbyArchive(
    duration: number,
    playerList: Array<{ id: string; username: string; score: number; }>
  ): void {
    const lobbyBinding = this.env.GAME_LOBBY as DurableObjectNamespace | undefined;
    if (!lobbyBinding) return;

    try {
      const lobbyId = lobbyBinding.idFromName('global');
      const lobby = lobbyBinding.get(lobbyId);

      lobby.fetch(new Request('https://internal/room-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'archive',
          archivedRoom: {
            id: this.roomCode,
            name: this.roomCode,
            endedAt: Date.now(),
            duration,
            finalWave: this.wave,
            finalPuzzleProgress: this.puzzleProgress,
            players: playerList,
            playerIds: playerList.map(p => p.id)
          }
        })
      })).catch(() => { /* best-effort */ });
    } catch {
      // Lobby binding unavailable — ignore
    }
  }

  /**
   * Notify the GameLobby Durable Object of this room's current state,
   * so lobby clients receive instant updates.
   */
  private notifyLobby(): void {
    const lobbyBinding = this.env.GAME_LOBBY as DurableObjectNamespace | undefined;
    if (!lobbyBinding) return;

    try {
      const lobbyId = lobbyBinding.idFromName('global');
      const lobby = lobbyBinding.get(lobbyId);

      const roomInfo = {
        id: this.roomCode,
        name: this.roomCode, // Will be enriched by the rooms API
        playerCount: this.phase === 'lobby' ? this.lobbyPlayers.size : this.sessions.size,
        createdAt: 0,
        createdBy: '',
        puzzleProgress: this.puzzleProgress,
        wave: this.wave,
        isPrivate: this.isPrivate,
        phase: this.phase
      };

      // Fire-and-forget — don't await in the hot path
      lobby.fetch(new Request('https://internal/room-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'upsert', room: roomInfo })
      })).catch(() => { /* best-effort */ });
    } catch {
      // Lobby binding unavailable — ignore
    }
  }

  // ==========================================
  // Utility Methods
  // ==========================================

  private generateHint(node: PuzzleNodeState): string {
    const hints = [
      () => {
        const dx = node.targetPosition.x - node.position.x;
        const dy = node.targetPosition.y - node.position.y;
        const dz = node.targetPosition.z - node.position.z;
        const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
        let dir: string;
        if (ax >= ay && ax >= az) dir = dx > 0 ? 'starboard' : 'port';
        else if (ay >= az) dir = dy > 0 ? 'skyward' : 'coreward';
        else dir = dz > 0 ? 'forward' : 'aft';
        return `Data suggests node should shift ${dir}...`;
      },
      () => {
        const dx = node.targetPosition.x - node.position.x;
        const dy = node.targetPosition.y - node.position.y;
        const dz = node.targetPosition.z - node.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < 10) return 'Node alignment nearly complete!';
        if (dist < 20) return 'Node getting closer to target...';
        return 'Node requires significant repositioning...';
      },
      () => {
        const connected = this.puzzleNodes.filter(n => n.connected).length;
        return `${connected}/${this.puzzleNodes.length} nodes aligned. Structure emerging...`;
      },
      () => {
        const dx = node.targetPosition.x - node.position.x;
        const dy = node.targetPosition.y - node.position.y;
        const dz = node.targetPosition.z - node.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const pct = Math.max(0, 100 - (dist / 2));
        return `Alignment: ${pct.toFixed(0)}% — vector correction needed`;
      },
      () => {
        return node.connected
          ? 'This node is locked in place. Well done!'
          : 'Approaching node will enable alignment...';
      },
      () => {
        const dx = node.targetPosition.x - node.position.x;
        const dy = node.targetPosition.y - node.position.y;
        const dz = node.targetPosition.z - node.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        return `Distance to target: ${dist.toFixed(1)} units`;
      },
      () => 'Detecting geometric resonance... icosahedral symmetry?',
      () => {
        const nearbyNodes = this.puzzleNodes.filter(n => {
          if (n.id === node.id) return false;
          const dx = node.targetPosition.x - n.targetPosition.x;
          const dy = node.targetPosition.y - n.targetPosition.y;
          const dz = node.targetPosition.z - n.targetPosition.z;
          return Math.sqrt(dx * dx + dy * dy + dz * dz) < 100;
        });
        return `This node connects to ${nearbyNodes.length} others in the structure`;
      }
    ];

    return hints[Math.floor(Math.random() * hints.length)]();
  }

  /**
   * Get only players with active WebSocket sessions.
   * This prevents ghost duplicates from stored players whose sessions ended.
   */
  private getActivePlayers(): PlayerState[] {
    const activeIds = new Set<string>();
    for (const session of this.sessions.values()) {
      activeIds.add(session.id);
    }
    return Array.from(this.players.values()).filter(p => activeIds.has(p.id));
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // WebSocket might be closed
    }
  }

  private broadcast(message: ServerMessage, exclude?: WebSocket): void {
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

  /**
   * Broadcast current lobby state (player list, privacy, host) to all connected clients.
   */
  private broadcastLobbyState(): void {
    const msg: ServerMessage = {
      type: 'lobby-state',
      roomCode: this.roomCode,
      hostId: this.hostId,
      isPrivate: this.isPrivate,
      players: Array.from(this.lobbyPlayers.values())
    };
    this.broadcast(msg);
  }
}
