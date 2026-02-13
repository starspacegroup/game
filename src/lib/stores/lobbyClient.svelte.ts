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

export const lobbyState = {
  get rooms() { return _rooms; },
  get archivedRooms() { return _archivedRooms; },
  get connected() { return _connected; }
};

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
        _rooms = msg.rooms as LobbyRoomInfo[];
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

function scheduleReconnect(): void {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
  reconnectAttempts++;
  const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts - 1), MAX_RECONNECT_DELAY);
  reconnectTimeout = setTimeout(() => {
    connectLobby();
  }, delay);
}
