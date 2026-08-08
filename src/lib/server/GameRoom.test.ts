import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GameRoom } from './GameRoom';

function createState(sockets: WebSocket[] = []) {
  const values = new Map<string, unknown>();
  let alarm: number | null = null;
  let ready = Promise.resolve();
  const storage = {
    get: vi.fn(async (key: string) => values.get(key)),
    put: vi.fn(async (key: string, value: unknown) => { values.set(key, value); }),
    deleteAll: vi.fn(async () => { values.clear(); }),
    getAlarm: vi.fn(async () => alarm),
    setAlarm: vi.fn(async (value: number) => { alarm = value; }),
    deleteAlarm: vi.fn(async () => { alarm = null; })
  };
  const state = {
    storage,
    getWebSockets: vi.fn(() => sockets),
    blockConcurrencyWhile: vi.fn((callback: () => Promise<void>) => { ready = callback(); }),
    acceptWebSocket: vi.fn()
  };
  return { state: state as unknown as DurableObjectState, storage, ready: () => ready };
}

describe('GameRoom storage lifecycle', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('terminates sockets, deletes storage, and cancels the alarm', async () => {
    const socket = { close: vi.fn() } as unknown as WebSocket;
    const mock = createState([socket]);
    const room = new GameRoom(mock.state);
    await mock.ready();

    const response = await room.fetch(new Request('https://internal/terminate', { method: 'POST' }));

    expect(response.status).toBe(200);
    expect(socket.close).toHaveBeenCalledWith(1000, 'Room terminated by admin');
    expect(mock.storage.deleteAll).toHaveBeenCalledOnce();
    expect(mock.storage.deleteAlarm).toHaveBeenCalledOnce();
  });

  it('reclaims an idle hibernated room based on live socket count', async () => {
    const mock = createState([]);
    const room = new GameRoom(mock.state);
    await mock.ready();
    (room as unknown as { lastActivity: number }).lastActivity = Date.now() - 24 * 60 * 60 * 1000;

    await room.alarm();

    expect(mock.state.getWebSockets).toHaveBeenCalled();
    expect(mock.storage.deleteAll).toHaveBeenCalledOnce();
    expect(mock.storage.deleteAlarm).toHaveBeenCalledOnce();
    expect(mock.storage.setAlarm).toHaveBeenCalledOnce();
  });

  it('schedules cleanup when a hibernated socket has no in-memory session', async () => {
    const mock = createState([]);
    const room = new GameRoom(mock.state);
    await mock.ready();
    mock.storage.setAlarm.mockClear();
    mock.storage.getAlarm.mockResolvedValue(null);

    await room.webSocketClose({} as WebSocket);

    expect(mock.storage.put).toHaveBeenCalledWith('lastActivity', expect.any(Number));
    expect(mock.storage.setAlarm).toHaveBeenCalledOnce();
  });
});
