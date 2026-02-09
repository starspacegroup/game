/**
 * Shared protocol types for client-server communication
 * Used by both Cloudflare Workers (server) and browser (client)
 */

// ============================================
// Shared Entity Types (no THREE.js dependency)
// ============================================

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Euler3 {
  x: number;
  y: number;
  z: number;
}

export interface PlayerState {
  id: string;
  username: string;
  position: Vector3;
  velocity: Vector3;
  rotation: Euler3;
  health: number;
  maxHealth: number;
  score: number;
  speed: number;
  shootCooldown: number;
}

export interface AsteroidState {
  id: string;
  position: Vector3;
  velocity: Vector3;
  rotation: Euler3;
  rotationSpeed: Vector3;
  radius: number;
  health: number;
  maxHealth: number;
  destroyed: boolean;
}

export interface NpcState {
  id: string;
  position: Vector3;
  velocity: Vector3;
  rotation: Euler3;
  radius: number;
  health: number;
  maxHealth: number;
  shootCooldown: number;
  destroyed: boolean;
  converted: boolean;
  conversionProgress: number;
  targetNodeId: string | null;
  orbitAngle: number;
  orbitDistance: number;
}

export interface LaserState {
  id: string;
  ownerId: string;
  position: Vector3;
  direction: Vector3;
  speed: number;
  life: number;
  radius: number;
}

export interface PuzzleNodeState {
  id: string;
  position: Vector3;
  targetPosition: Vector3;
  radius: number;
  connected: boolean;
  color: string;
}

export type PowerUpType = 'health' | 'speed' | 'multishot' | 'shield';

export interface PowerUpState {
  id: string;
  position: Vector3;
  type: PowerUpType;
  radius: number;
  collected: boolean;
}

// ============================================
// Room & World State
// ============================================

export interface RoomMetadata {
  code: string;
  name: string;
  createdAt: number;
  createdBy: string;
  isPrivate: boolean;
  maxPlayers: number;
}

export interface WorldState {
  tick: number;
  players: PlayerState[];
  asteroids: AsteroidState[];
  npcs: NpcState[];
  lasers: LaserState[];
  puzzleNodes: PuzzleNodeState[];
  powerUps: PowerUpState[];
  puzzleProgress: number;
  puzzleSolved: boolean;
  wave: number;
  bounds: Vector3;
}

// ============================================
// Client -> Server Messages
// ============================================

export interface JoinMessage {
  type: 'join';
  id: string;
  username: string;
  roomCode?: string;
}

export interface InputMessage {
  type: 'input';
  tick: number;
  thrust: boolean;
  brake: boolean;
  rotateX: number;
  rotateY: number;
  rotateZ: number;
}

export interface FireMessage {
  type: 'fire';
  tick: number;
}

export interface InteractMessage {
  type: 'interact';
  targetId: string;
  targetType: 'puzzle-node' | 'npc' | 'power-up';
  action: 'move' | 'connect' | 'convert';
  position?: Vector3;
}

export interface ChatMessage {
  type: 'chat';
  text: string;
}

export type ClientMessage =
  | JoinMessage
  | InputMessage
  | FireMessage
  | InteractMessage
  | ChatMessage;

// ============================================
// Server -> Client Messages
// ============================================

export interface WelcomeMessage {
  type: 'welcome';
  playerId: string;
  roomCode: string;
  state: WorldState;
}

export interface StateMessage {
  type: 'state';
  tick: number;
  players: PlayerState[];
  asteroids?: AsteroidState[];
  npcs?: NpcState[];
  lasers: LaserState[];
  powerUps?: PowerUpState[];
  puzzleNodes?: PuzzleNodeState[];
  puzzleProgress: number;
  puzzleSolved: boolean;
}

export interface PlayerJoinedMessage {
  type: 'player-joined';
  player: PlayerState;
  playerCount: number;
}

export interface PlayerLeftMessage {
  type: 'player-left';
  playerId: string;
  playerCount: number;
}

export interface EntityDestroyedMessage {
  type: 'entity-destroyed';
  entityType: 'asteroid' | 'npc' | 'power-up';
  entityId: string;
  destroyedBy?: string;
  position: Vector3;
}

export interface PlayerHitMessage {
  type: 'player-hit';
  playerId: string;
  damage: number;
  health: number;
  attackerId?: string;
}

export interface PlayerRespawnMessage {
  type: 'player-respawn';
  player: PlayerState;
}

export interface PowerUpCollectedMessage {
  type: 'power-up-collected';
  powerUpId: string;
  playerId: string;
  powerUpType: PowerUpType;
}

export interface NpcConvertedMessage {
  type: 'npc-converted';
  npcId: string;
  convertedBy: string;
  targetNodeId: string;
}

export interface HintMessage {
  type: 'hint';
  nodeId: string;
  hint: string;
  fromNpcId: string;
}

export interface ChatBroadcastMessage {
  type: 'chat-broadcast';
  sender: string;
  senderId: string;
  text: string;
  timestamp: number;
}

export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

export type ServerMessage =
  | WelcomeMessage
  | StateMessage
  | PlayerJoinedMessage
  | PlayerLeftMessage
  | EntityDestroyedMessage
  | PlayerHitMessage
  | PlayerRespawnMessage
  | PowerUpCollectedMessage
  | NpcConvertedMessage
  | HintMessage
  | ChatBroadcastMessage
  | ErrorMessage;

// ============================================
// Utility Types
// ============================================

export interface WorldBounds {
  x: number;
  y: number;
  z: number;
}

export const DEFAULT_BOUNDS: WorldBounds = {
  x: 2116,
  y: 2116,
  z: 40
};

export const TICK_RATE = 20; // ticks per second
export const TICK_INTERVAL = 1000 / TICK_RATE; // 50ms
export const MAX_PLAYERS = 8;

// Entity counts
export const ASTEROID_COUNT = 600;
export const POWER_UP_COUNT = 100;
export const PUZZLE_NODE_COUNT = 12;
export const BASE_NPC_COUNT = 5;
