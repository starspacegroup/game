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

interface LobbyMessage {
  type: 'rooms';
  rooms: LobbyRoomInfo[];
}

let socket: WebSocket | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY = 2000;
const MAX_RECONNECT_DELAY = 30000;

/** Reactive state — import and read from components */
let _rooms = $state<LobbyRoomInfo[]>([]);
let _connected = $state(false);

export const lobbyState = {
  get rooms() { return _rooms; },
  get connected() { return _connected; }
};

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
        _rooms = msg.rooms;
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
