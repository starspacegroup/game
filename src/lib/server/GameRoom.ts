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
  InputMessage
} from '../shared/protocol';

import {
  DEFAULT_BOUNDS,
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

export class GameRoom implements DurableObject {
  private state: DurableObjectState;
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
  private bounds = DEFAULT_BOUNDS;

  // Game loop
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private lastTickTime: number = 0;
  private worldInitialized: boolean = false;
  private roomCode: string = '';

  constructor(state: DurableObjectState) {
    this.state = state;

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

        // Restore players (they'll rejoin via WebSocket)
        for (const player of stored.players) {
          this.players.set(player.id, player);
        }
      }

      const roomCode = await this.state.storage.get<string>('roomCode');
      if (roomCode) this.roomCode = roomCode;
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
        playerCount: this.players.size,
        tick: this.tick,
        players: Array.from(this.players.values()).map(p => ({
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

    // Periodic save (every 100 ticks = 5 seconds)
    if (this.tick % 100 === 0) {
      this.saveState();
    }
  }

  /**
   * Update player positions based on inputs
   */
  private updatePlayers(deltaTime: number): void {
    for (const [ws, session] of this.sessions) {
      const player = this.players.get(session.id);
      if (!player || player.health <= 0) continue;

      const input = session.lastInput;
      if (!input) continue;

      // Direct rotation from client (client computes exact rotation)
      player.rotation.z = input.rotateZ;

      // Direct velocity mapping to match client physics
      // Client uses: velocity = moveInput * speed * (boost ? 1.8 : 1)
      const speed = player.speed * (input.brake ? 1.8 : 1);

      // Calculate direction from input
      // Client sends rotateX/rotateY as normalized move direction
      const moveX = input.rotateX;
      const moveY = input.rotateY;

      // Set velocity directly (matching client's immediate velocity model)
      player.velocity.x = moveX * speed;
      player.velocity.y = moveY * speed;

      // Update position
      player.position.x += player.velocity.x * deltaTime;
      player.position.y += player.velocity.y * deltaTime;

      // Wrap position
      this.wrapPosition(player.position);

      // Update shoot cooldown
      if (player.shootCooldown > 0) {
        player.shootCooldown -= deltaTime;
      }
    }
  }

  /**
   * Update asteroid positions and rotations
   */
  private updateAsteroids(deltaTime: number): void {
    for (const asteroid of this.asteroids) {
      if (asteroid.destroyed) continue;

      // Update position
      asteroid.position.x += asteroid.velocity.x * deltaTime;
      asteroid.position.y += asteroid.velocity.y * deltaTime;
      asteroid.position.z += asteroid.velocity.z * deltaTime;

      // Update rotation
      asteroid.rotation.x += asteroid.rotationSpeed.x * deltaTime;
      asteroid.rotation.y += asteroid.rotationSpeed.y * deltaTime;
      asteroid.rotation.z += asteroid.rotationSpeed.z * deltaTime;

      // Wrap position
      this.wrapPosition(asteroid.position);
    }
  }

  /**
   * Update NPC AI and positions
   */
  private updateNpcs(deltaTime: number): void {
    const playerArray = Array.from(this.players.values()).filter(p => p.health > 0);

    for (const npc of this.npcs) {
      if (npc.destroyed) continue;

      if (npc.converted) {
        // Converted NPCs orbit their target puzzle node and generate hints
        this.updateConvertedNpc(npc, deltaTime);
        continue;
      }

      // Handle conversion animation (matches solo: 0.5 second conversion)
      if (npc.conversionProgress > 0 && npc.conversionProgress < 1) {
        npc.conversionProgress += deltaTime * 2;
        if (npc.conversionProgress >= 1) {
          npc.converted = true;
          npc.conversionProgress = 1;
          // Find nearest unconnected puzzle node to orbit
          let nearestNode: PuzzleNodeState | null = null;
          let nearestDist = Infinity;
          for (const node of this.puzzleNodes) {
            if (node.connected) continue;
            const dist = this.wrappedDistance(npc.position, node.position);
            if (dist < nearestDist) {
              nearestDist = dist;
              nearestNode = node;
            }
          }
          npc.targetNodeId = nearestNode?.id || null;

          // Broadcast conversion event
          this.broadcast({
            type: 'npc-converted',
            npcId: npc.id,
            convertedBy: '',
            targetNodeId: npc.targetNodeId || ''
          });
        }
        // Spin in place during conversion
        npc.rotation.z += deltaTime * 10;
        continue;
      }

      // Hostile NPCs chase nearest player
      this.updateHostileNpc(npc, playerArray, deltaTime);

      // Update position
      npc.position.x += npc.velocity.x * deltaTime;
      npc.position.y += npc.velocity.y * deltaTime;
      npc.position.z += npc.velocity.z * deltaTime;

      // Update shoot cooldown
      if (npc.shootCooldown > 0) {
        npc.shootCooldown -= deltaTime;
      }

      this.wrapPosition(npc.position);
    }
  }

  private updateConvertedNpc(npc: NpcState, deltaTime: number): void {
    if (!npc.targetNodeId) return;

    const targetNode = this.puzzleNodes.find(n => n.id === npc.targetNodeId);
    if (!targetNode) return;

    const dx = targetNode.position.x - npc.position.x;
    const dy = targetNode.position.y - npc.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Navigate to the puzzle node if far away (matching solo behavior)
    if (dist > npc.orbitDistance + 2) {
      const navSpeed = 6 * 1.2;
      npc.velocity.x = (dx / dist) * navSpeed;
      npc.velocity.y = (dy / dist) * navSpeed;
      npc.position.x += npc.velocity.x * deltaTime;
      npc.position.y += npc.velocity.y * deltaTime;
      npc.rotation.z = Math.atan2(dy, dx) - Math.PI / 2;
    } else {
      // Orbit the puzzle node (matching solo orbit speed of 1.5)
      npc.orbitAngle += deltaTime * 1.5;
      npc.position.x = targetNode.position.x + Math.cos(npc.orbitAngle) * npc.orbitDistance;
      npc.position.y = targetNode.position.y + Math.sin(npc.orbitAngle) * npc.orbitDistance;
      npc.rotation.z = npc.orbitAngle + Math.PI / 2;
      npc.velocity.x = 0;
      npc.velocity.y = 0;

      // Generate hints while orbiting (matching solo: 4-7 seconds between hints)
      // Use shootCooldown as hint timer since converted NPCs don't shoot
      npc.shootCooldown -= deltaTime;
      if (npc.shootCooldown <= 0) {
        npc.shootCooldown = 4 + Math.random() * 3;

        // Generate a hint about this puzzle node
        const hint = this.generateHint(targetNode);

        // Broadcast hint to all players
        this.broadcast({
          type: 'hint',
          nodeId: targetNode.id,
          hint,
          fromNpcId: npc.id
        });

        // Help push the node toward its target (converted NPCs contribute to solving)
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

    this.wrapPosition(npc.position);
  }

  private updateHostileNpc(npc: NpcState, players: PlayerState[], deltaTime: number): void {
    if (players.length === 0) return;

    // Find nearest player
    let nearestPlayer: PlayerState | null = null;
    let nearestDist = Infinity;

    for (const player of players) {
      const dist = this.wrappedDistance(npc.position, player.position);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestPlayer = player;
      }
    }

    if (!nearestPlayer) return;

    // Chase the player (matching solo NPC_SPEED = 6)
    const dir = this.wrappedDirection(npc.position, nearestPlayer.position);
    const speed = 6;

    if (dir.dist > 2.5) {
      // Chase until very close
      npc.velocity.x = (dir.dx / dir.dist) * speed;
      npc.velocity.y = (dir.dy / dir.dist) * speed;
    } else {
      // Circle tightly when close (matching solo behavior)
      npc.velocity.x = (-dir.dy / dir.dist) * speed * 0.8;
      npc.velocity.y = (dir.dx / dir.dist) * speed * 0.8;
    }

    // Point towards player
    npc.rotation.z = Math.atan2(dir.dy, dir.dx) - Math.PI / 2;

    // Shoot at player if in range and cooldown ready (matching solo: range 40, rate 2.5)
    if (nearestDist < 40 && npc.shootCooldown <= 0) {
      this.createNpcLaser(npc.id, npc.position, { x: dir.dx / dir.dist, y: dir.dy / dir.dist, z: 0 });
      npc.shootCooldown = 2.5 + Math.random();
    }
  }

  /**
   * Update laser positions and lifetime
   */
  private updateLasers(deltaTime: number): void {
    for (let i = this.lasers.length - 1; i >= 0; i--) {
      const laser = this.lasers[i];

      laser.position.x += laser.direction.x * laser.speed * deltaTime;
      laser.position.y += laser.direction.y * laser.speed * deltaTime;
      laser.position.z += laser.direction.z * laser.speed * deltaTime;

      laser.life -= deltaTime;

      this.wrapPosition(laser.position);

      if (laser.life <= 0) {
        this.lasers.splice(i, 1);
      }
    }
  }

  /**
   * Handle all collision detection
   */
  private handleCollisions(): void {
    // Player vs Power-ups (use wrappedDistance for toroidal world)
    for (const player of this.players.values()) {
      if (player.health <= 0) continue;

      for (const powerUp of this.powerUps) {
        if (powerUp.collected) continue;

        const dist = this.wrappedDistance(player.position, powerUp.position);
        if (dist < 1 + powerUp.radius) {
          this.collectPowerUp(player, powerUp);
        }
      }

      // Player vs Puzzle Nodes
      for (const node of this.puzzleNodes) {
        if (node.connected) continue;

        const dist = this.wrappedDistance(player.position, node.position);
        if (dist < 1 + node.radius + 3) {
          // Interact with puzzle node - snap it closer to target
          this.interactPuzzleNode(node);
        }
      }

      // Player vs hostile NPCs - instant death (matches solo mode)
      for (const npc of this.npcs) {
        if (npc.destroyed || npc.converted || npc.conversionProgress > 0) continue;

        const dist = this.wrappedDistance(player.position, npc.position);
        if (dist < 1 + npc.radius + 0.5) {
          this.damagePlayer(player.id, player.health); // Instant death like solo
        }
      }
    }

    // Lasers vs targets
    for (let i = this.lasers.length - 1; i >= 0; i--) {
      const laser = this.lasers[i];
      let hit = false;

      // Player lasers vs NPCs → conversion (not damage, matching solo mechanic)
      if (this.players.has(laser.ownerId)) {
        for (const npc of this.npcs) {
          // Skip destroyed, converted, or already-converting NPCs
          if (npc.destroyed || npc.converted || npc.conversionProgress > 0) continue;

          const dist = this.wrappedDistance(laser.position, npc.position);
          if (dist < laser.radius + npc.radius + 1.0) {
            // Start conversion instead of dealing damage (matches solo)
            npc.conversionProgress = 0.01;
            // Award score to owner
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

          const dist = this.wrappedDistance(laser.position, player.position);
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
        const newAsteroid = respawnAsteroid(this.bounds);
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
      const newPowerUp = respawnPowerUp(this.bounds);
      const collectedIdx = this.powerUps.findIndex(p => p.collected);
      if (collectedIdx >= 0) {
        this.powerUps[collectedIdx] = newPowerUp;
      } else {
        this.powerUps.push(newPowerUp);
      }
    }

    // Respawn NPCs based on wave
    const activeNpcs = this.npcs.filter(n => !n.destroyed && !n.converted);
    const targetNpcCount = Math.max(2, 5 - this.players.size + this.wave);
    if (activeNpcs.length < targetNpcCount && this.players.size > 0) {
      // Spawn near a random player
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

      // Keep player state (for potential rejoin) but mark as disconnected
      // Don't remove from this.players to preserve state

      // Broadcast player left to all other players
      this.broadcast({
        type: 'player-left',
        playerId: session.id,
        playerCount: this.sessions.size
      } as ServerMessage);

      // Stop game loop if no players
      if (this.sessions.size === 0) {
        this.stopGameLoop();
        this.saveState();
      }
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  private async handleMessage(ws: WebSocket, data: ClientMessage): Promise<void> {
    switch (data.type) {
      case 'join': {
        // Initialize world on first player
        this.initializeWorld();

        const playerId = data.id;
        const username = data.username || 'Player';

        this.sessions.set(ws, {
          id: playerId,
          username,
          lastInput: null,
          lastPing: Date.now()
        });

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
          wave: this.wave,
          bounds: this.bounds
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

        // Create laser
        const direction = {
          x: -Math.sin(player.rotation.z) * Math.cos(player.rotation.x),
          y: Math.cos(player.rotation.z) * Math.cos(player.rotation.x),
          z: Math.sin(player.rotation.x)
        };

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

    player.health = Math.max(0, player.health - damage);

    this.broadcast({
      type: 'player-hit',
      playerId,
      damage,
      health: player.health
    });

    if (player.health <= 0) {
      // Player died - will respawn on next join or after delay
      // For now, just respawn immediately
      setTimeout(() => {
        if (this.sessions.size > 0) {
          player.health = player.maxHealth;
          player.position = { x: 0, y: 0, z: 0 };
          player.velocity = { x: 0, y: 0, z: 0 };

          this.broadcast({
            type: 'player-respawn',
            player
          });
        }
      }, 3000);
    }
  }

  private collectPowerUp(player: PlayerState, powerUp: PowerUpState): void {
    powerUp.collected = true;

    switch (powerUp.type) {
      case 'health':
        player.health = Math.min(player.maxHealth, player.health + 25);
        break;
      case 'speed':
        player.speed = 30;
        // Temporary boost matching solo mode (8 seconds)
        setTimeout(() => { player.speed = 20; }, 8000);
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
  }

  private interactPuzzleNode(node: PuzzleNodeState): void {
    // Move node closer to its target position (matching solo's lerp behavior)
    const dx = node.targetPosition.x - node.position.x;
    const dy = node.targetPosition.y - node.position.y;
    const dz = node.targetPosition.z - node.position.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Lerp toward target (matching solo's 0.05 factor)
    node.position.x += dx * 0.05;
    node.position.y += dy * 0.05;
    node.position.z += dz * 0.05;

    if (dist < 3) {
      // Close enough - snap to target and mark as connected (matching solo threshold of 3)
      node.position = { ...node.targetPosition };
      node.connected = true;
      this.checkPuzzleProgress();
    }
  }

  private convertNpc(npc: NpcState, convertedBy: string): void {
    npc.converted = true;
    npc.conversionProgress = 1;

    // Assign to nearest unconnected puzzle node
    let nearestNode: PuzzleNodeState | null = null;
    let nearestDist = Infinity;

    for (const node of this.puzzleNodes) {
      if (node.connected) continue;
      const dist = this.wrappedDistance(npc.position, node.position);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestNode = node;
      }
    }

    if (nearestNode) {
      npc.targetNodeId = nearestNode.id;
    }

    this.broadcast({
      type: 'npc-converted',
      npcId: npc.id,
      convertedBy,
      targetNodeId: npc.targetNodeId || ''
    });
  }

  private checkPuzzleProgress(): void {
    const connectedCount = this.puzzleNodes.filter(n => n.connected).length;
    this.puzzleProgress = (connectedCount / this.puzzleNodes.length) * 100;
    this.puzzleSolved = this.puzzleProgress >= 100;

    if (this.puzzleSolved) {
      // Advance wave
      this.wave++;
    }
  }

  private broadcastState(): void {
    // Send per-player state with only nearby entities to reduce bandwidth
    const activePlayers = this.getActivePlayers();
    const ENTITY_SYNC_RADIUS = 250; // Only sync entities within this distance

    for (const [ws, session] of this.sessions) {
      const player = this.players.get(session.id);
      if (!player) continue;

      const stateMsg: ServerMessage = {
        type: 'state',
        tick: this.tick,
        players: activePlayers,
        lasers: this.lasers.filter(l =>
          this.wrappedDistance(l.position, player.position) < ENTITY_SYNC_RADIUS
        ),
        // Send entity snapshots every 3 ticks (~100ms) — only nearby ones
        ...(this.tick % 3 === 0 && {
          asteroids: this.asteroids.filter(a =>
            !a.destroyed && this.wrappedDistance(a.position, player.position) < ENTITY_SYNC_RADIUS
          ),
          npcs: this.npcs.filter(n =>
            !n.destroyed && this.wrappedDistance(n.position, player.position) < ENTITY_SYNC_RADIUS
          ),
          powerUps: this.powerUps.filter(p =>
            !p.collected && this.wrappedDistance(p.position, player.position) < ENTITY_SYNC_RADIUS
          ),
          puzzleNodes: this.puzzleNodes
        }),
        puzzleProgress: this.puzzleProgress,
        puzzleSolved: this.puzzleSolved
      };

      this.send(ws, stateMsg);
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
  // Utility Methods
  // ==========================================

  private wrapPosition(pos: Vector3): void {
    if (pos.x > this.bounds.x) pos.x -= this.bounds.x * 2;
    else if (pos.x < -this.bounds.x) pos.x += this.bounds.x * 2;

    if (pos.y > this.bounds.y) pos.y -= this.bounds.y * 2;
    else if (pos.y < -this.bounds.y) pos.y += this.bounds.y * 2;
  }

  private generateHint(node: PuzzleNodeState): string {
    const hints = [
      () => {
        const dx = node.targetPosition.x - node.position.x;
        const dy = node.targetPosition.y - node.position.y;
        const dir = Math.abs(dx) > Math.abs(dy)
          ? (dx > 0 ? 'east' : 'west')
          : (dy > 0 ? 'north' : 'south');
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
        const angle = Math.atan2(
          node.targetPosition.y - node.position.y,
          node.targetPosition.x - node.position.x
        );
        const degrees = Math.round((angle * 180) / Math.PI);
        return `Vector correction: ${degrees}° from current position`;
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
          return Math.sqrt(dx * dx + dy * dy + dz * dz) < 35;
        });
        return `This node connects to ${nearbyNodes.length} others in the structure`;
      }
    ];

    return hints[Math.floor(Math.random() * hints.length)]();
  }

  private distance(a: Vector3, b: Vector3): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private wrappedDistance(a: Vector3, b: Vector3): number {
    const worldW = this.bounds.x * 2;
    const worldH = this.bounds.y * 2;

    let dx = Math.abs(a.x - b.x);
    let dy = Math.abs(a.y - b.y);

    if (dx > worldW / 2) dx = worldW - dx;
    if (dy > worldH / 2) dy = worldH - dy;

    return Math.sqrt(dx * dx + dy * dy + (a.z - b.z) ** 2);
  }

  private wrappedDirection(from: Vector3, to: Vector3): { dx: number; dy: number; dz: number; dist: number; } {
    const worldW = this.bounds.x * 2;
    const worldH = this.bounds.y * 2;

    let dx = to.x - from.x;
    let dy = to.y - from.y;
    const dz = to.z - from.z;

    if (dx > worldW / 2) dx -= worldW;
    else if (dx < -worldW / 2) dx += worldW;

    if (dy > worldH / 2) dy -= worldH;
    else if (dy < -worldH / 2) dy += worldH;

    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return { dx, dy, dz, dist };
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
}
