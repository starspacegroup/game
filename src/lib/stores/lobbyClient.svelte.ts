/**
 * Lobby WebSocket client — connects to the GameLobby Durable Object
 * and exposes a reactive list of active rooms that updates in real time.
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
  playerIds: string[];
}

interface LobbyMessage {
  type: 'rooms' | 'archived-rooms';
  rooms: LobbyRoomInfo[] | ArchivedRoomInfo[];
}

let socket: WebSocket | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY = 2000;
const MAX_RECONNECT_DELAY = 30000;

/** Reactive state — import and read from components */
let _rooms = $state<LobbyRoomInfo[]>([]);
let _archivedRooms = $state<ArchivedRoomInfo[]>([]);
let _connected = $state(false);

/** Track deleted room IDs in sessionStorage so they survive page refresh */
const DELETED_ROOMS_KEY = 'starspace_deleted_rooms';

function getDeletedRoomIds(): Set<string> {
  try {
    const stored = sessionStorage.getItem(DELETED_ROOMS_KEY);
    if (!stored) return new Set();
    const parsed = JSON.parse(stored) as Array<{ id: string; ts: number; }>;
    const now = Date.now();
    // Only keep entries less than 5 minutes old
    const valid = parsed.filter(e => now - e.ts < 300_000);
    return new Set(valid.map(e => e.id));
  } catch {
    return new Set();
  }
}

function addDeletedRoomId(roomId: string): void {
  try {
    const stored = sessionStorage.getItem(DELETED_ROOMS_KEY);
    const entries: Array<{ id: string; ts: number; }> = stored ? JSON.parse(stored) : [];
    const now = Date.now();
    // Prune old entries and add new one
    const valid = entries.filter(e => now - e.ts < 300_000 && e.id !== roomId);
    valid.push({ id: roomId, ts: now });
    sessionStorage.setItem(DELETED_ROOMS_KEY, JSON.stringify(valid));
  } catch {
    // sessionStorage unavailable — best-effort
  }
}

/** Filter out rooms that the user has deleted in this session */
function filterDeletedRooms(rooms: LobbyRoomInfo[]): LobbyRoomInfo[] {
  const deleted = getDeletedRoomIds();
  if (deleted.size === 0) return rooms;
  return rooms.filter(r => !deleted.has(r.id));
}

export const lobbyState = {
  get rooms() { return _rooms; },
  set rooms(val: LobbyRoomInfo[]) { _rooms = val; },
  get archivedRooms() { return _archivedRooms; },
  get connected() { return _connected; }
};

/**
 * Optimistically remove a room from the local lobby list (e.g. after deletion).
 * Also persists the deletion to sessionStorage so it survives page refresh.
 */
export function removeRoomFromLobby(roomId: string): void {
  _rooms = _rooms.filter(r => r.id !== roomId);
  addDeletedRoomId(roomId);
}

/**
 * Get archived rooms filtered to only those the given user participated in.
 */
export function getMyPastGames(userId: string): ArchivedRoomInfo[] {
  if (!userId) return [];
  return _archivedRooms.filter(r => r.playerIds.includes(userId));
}

export function connectLobby(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return; // Already connected
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/api/game/lobby`;

  socket = new WebSocket(url);

  socket.onopen = () => {
    _connected = true;
    reconnectAttempts = 0;
  };

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string) as LobbyMessage;
      if (msg.type === 'rooms') {
        _rooms = filterDeletedRooms(msg.rooms as LobbyRoomInfo[]);
      } else if (msg.type === 'archived-rooms') {
        _archivedRooms = msg.rooms as ArchivedRoomInfo[];
      }
    } catch {
      // Ignore malformed messages
    }
  };

  socket.onclose = () => {
    _connected = false;
    socket = null;
    scheduleReconnect();
  };

  socket.onerror = () => {
    // onclose will fire after this
  };
}

export function disconnectLobby(): void {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // Prevent reconnecting
  if (socket) {
    socket.close();
    socket = null;
  }
  _connected = false;
}

/**
 * Force-reconnect the lobby WebSocket to get a fresh room list.
 * Used after deleting a room to verify the deletion propagated.
 */
export function reconnectLobby(): void {
  // Reset reconnect counter so we can reconnect
  reconnectAttempts = 0;
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (socket) {
    socket.close();
    socket = null;
  }
  _connected = false;
  // Small delay to allow the server to fully process the delete
  setTimeout(() => connectLobby(), 500);
}

function scheduleReconnect(): void {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
  reconnectAttempts++;
  const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts - 1), MAX_RECONNECT_DELAY);
  reconnectTimeout = setTimeout(() => {
    connectLobby();
  }, delay);
}
