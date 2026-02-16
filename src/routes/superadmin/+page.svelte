<script lang="ts">
  let { data } = $props();

  // ── Realtime state (populated via WebSocket) ──

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rooms = $state<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let archivedRooms = $state<any[]>([]);
  let lobbyClients = $state(0);
  let kvKeyCount = $state(0);
  let fetchedAt = $state(Date.now());
  let errors = $state<string[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let roomDetails = $state<Record<string, any>>({});

  let connected = $state(false);
  let reconnecting = $state(false);
  let deleting = $state<string | null>(null);
  let deleteError = $state<string | null>(null);

  // Drill-down state
  let selectedRoomId = $state<string | null>(null);
  let selectedArchivedId = $state<string | null>(null);
  let activeTab = $state<'players' | 'entities' | 'puzzle' | 'events'>('players');
  let archivedTab = $state<'players' | 'events'>('players');

  // View mode
  let viewMode = $state<'overview' | 'detail'>('overview');

  // ── WebSocket connection ──

  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/api/game/admin-ws`);

    ws.onopen = () => {
      connected = true;
      reconnecting = false;
      errors = [];
      // Subscribe to ALL rooms for real-time data
      ws?.send(JSON.stringify({ type: 'subscribe-all' }));
      // Re-subscribe to currently selected room for extra detail
      if (selectedRoomId) {
        ws?.send(JSON.stringify({ type: 'subscribe-room', roomId: selectedRoomId }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      } catch { /* ignore malformed */ }
    };

    ws.onclose = () => {
      connected = false;
      scheduleReconnect();
    };

    ws.onerror = () => {
      connected = false;
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnecting = true;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 2000);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleMessage(msg: any) {
    switch (msg.type) {
      case 'admin-rooms':
        rooms = msg.rooms ?? [];
        archivedRooms = msg.archivedRooms ?? archivedRooms;
        lobbyClients = msg.lobbyClients ?? 0;
        kvKeyCount = msg.kvKeyCount ?? 0;
        fetchedAt = msg.fetchedAt ?? Date.now();
        break;

      case 'admin-all-details':
        // Bulk update: all room details at once
        if (msg.details) {
          roomDetails = { ...roomDetails, ...msg.details };
        }
        fetchedAt = msg.fetchedAt ?? Date.now();
        break;

      case 'room-detail':
        roomDetails = { ...roomDetails, [msg.roomId]: msg.detail };
        fetchedAt = msg.fetchedAt ?? Date.now();
        break;

      case 'room-detail-error':
        errors = [...errors.filter(e => !e.startsWith(`Room ${msg.roomId}`)),
          `Room ${msg.roomId}: ${msg.error}`];
        break;

      case 'archived-rooms':
        archivedRooms = msg.rooms ?? [];
        break;
    }
  }

  // Connect on mount, disconnect on destroy
  $effect(() => {
    connect();
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (ws) { ws.onclose = null; ws.close(); ws = null; }
    };
  });

  // Subscribe / unsubscribe to room detail when selection changes
  $effect(() => {
    const roomId = selectedRoomId;
    if (!roomId || !ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({ type: 'subscribe-room', roomId }));

    return () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'unsubscribe-room', roomId }));
      }
    };
  });

  // ── Derived state ──

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roomsWithDetails = $derived(
    rooms.map((r: any) => ({ ...r, detail: roomDetails[r.id] ?? null }))
  );

  const totalPlayers = $derived(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    roomsWithDetails.reduce((sum: number, r: any) =>
      sum + (r.detail?.players?.length ?? r.playerCount ?? 0), 0)
  );

  const totalEntities = $derived(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    roomsWithDetails.reduce((sum: number, r: any) => {
      if (!r.detail) return sum;
      const d = r.detail;
      return sum +
        (d.asteroids?.filter((a: any) => !a.destroyed).length ?? 0) +
        (d.npcs?.filter((n: any) => !n.destroyed).length ?? 0) +
        (d.lasers?.length ?? 0) +
        (d.powerUps?.filter((p: any) => !p.collected).length ?? 0);
    }, 0)
  );

  const selectedRoom = $derived(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    selectedRoomId ? roomsWithDetails.find((r: any) => r.id === selectedRoomId) : null
  );

  const selectedArchived = $derived(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    selectedArchivedId ? archivedRooms.find((r: any) => r.id === selectedArchivedId) : null
  );

  function selectRoom(roomId: string) {
    selectedRoomId = roomId;
    selectedArchivedId = null;
    activeTab = 'players';
    viewMode = 'detail';
  }

  function selectArchived(roomId: string) {
    selectedArchivedId = roomId;
    selectedRoomId = null;
    archivedTab = 'players';
    viewMode = 'detail';
  }

  function backToOverview() {
    viewMode = 'overview';
    selectedRoomId = null;
    selectedArchivedId = null;
  }

  async function deleteRoom(roomId: string) {
    if (!confirm(`Delete room ${roomId}? All players will be disconnected.`)) return;
    deleting = roomId;
    deleteError = null;
    try {
      const res = await fetch('/api/game/rooms', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, userId: data.user.id })
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        deleteError = err.error || 'Failed to delete';
      } else {
        if (selectedRoomId === roomId) {
          selectedRoomId = null;
          viewMode = 'overview';
        }
      }
    } catch (e) {
      deleteError = String(e);
    }
    deleting = null;
  }

  function formatTime(ms: number): string {
    return new Date(ms).toLocaleString();
  }

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s}s`;
  }

  function formatAge(ms: number): string {
    const diff = Math.round((Date.now() - ms) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  function formatPos(p: { x: number; y: number; z: number } | undefined): string {
    if (!p) return '—';
    return `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`;
  }

  function phaseBadge(phase: string): string {
    switch (phase) {
      case 'playing': return 'badge-playing';
      case 'lobby': return 'badge-lobby';
      case 'ended': return 'badge-ended';
      default: return '';
    }
  }

  function healthBar(health: number, max: number): number {
    return max > 0 ? (health / max) * 100 : 0;
  }
</script>

<div class="admin-page">
  <header>
    <div class="header-top">
      <h1>Superadmin Dashboard</h1>
      <span class="user-info">{data.user.username}</span>
    </div>
    <div class="controls">
      <span class="connection-status" class:connected class:reconnecting>
        {connected ? 'LIVE' : reconnecting ? 'RECONNECTING...' : 'DISCONNECTED'}
      </span>
      <button class="btn-refresh" onclick={() => ws?.send(JSON.stringify({ type: 'refresh' }))} disabled={!connected}>Refresh</button>
      {#if viewMode === 'detail'}
        <button class="btn-back" onclick={backToOverview}>← All Servers</button>
      {/if}
      <span class="timestamp">Updated: {formatTime(fetchedAt)}</span>
    </div>
  </header>

  <!-- Summary Stats -->
  <div class="stats">
    <div class="stat-card">
      <div class="stat-value">{rooms.length}</div>
      <div class="stat-label">Active Rooms</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">{totalPlayers}</div>
      <div class="stat-label">Players Online</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">{totalEntities}</div>
      <div class="stat-label">Active Entities</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">{kvKeyCount}</div>
      <div class="stat-label">KV Keys</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">{lobbyClients}</div>
      <div class="stat-label">Lobby WS Clients</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">{archivedRooms.length}</div>
      <div class="stat-label">Archived Games</div>
    </div>
  </div>

  <!-- Errors -->
  {#if errors.length > 0}
    <section class="errors">
      <h2>Errors ({errors.length})</h2>
      {#each errors as error}
        <div class="error-item">{error}</div>
      {/each}
    </section>
  {/if}

  {#if deleteError}
    <div class="error-item">Delete failed: {deleteError}</div>
  {/if}

  {#if viewMode === 'overview'}
    <!-- ═══════ OVERVIEW MODE: All servers at a glance ═══════ -->

    <!-- Active Rooms — Full Real-time View -->
    <section class="overview-section">
      <h2>Active Rooms ({roomsWithDetails.length})</h2>
      {#if roomsWithDetails.length === 0}
        <p class="empty">No active rooms</p>
      {:else}
        <div class="overview-grid">
          {#each roomsWithDetails as room}
            {@const d = room.detail}
            <div class="server-card" class:has-detail={!!d}>
              <div class="server-card-header">
                <span class="badge {phaseBadge(d?.phase ?? room.phase)}">
                  {d?.phase ?? room.phase}
                </span>
                <button class="server-name" onclick={() => selectRoom(room.id)}>
                  {room.name}
                </button>
                {#if d?.isPrivate ?? room.isPrivate}
                  <span class="private-tag">PRIVATE</span>
                {/if}
                <span class="server-age">{formatAge(room.createdAt)}</span>
                <button
                  class="btn-delete-mini"
                  onclick={() => deleteRoom(room.id)}
                  disabled={deleting === room.id}
                  title="Delete room"
                >✕</button>
              </div>

              <!-- Key metrics bar -->
              <div class="server-metrics">
                <div class="metric">
                  <span class="metric-val">{d?.players?.length ?? room.playerCount ?? 0}</span>
                  <span class="metric-lbl">Players</span>
                </div>
                <div class="metric">
                  <span class="metric-val">{d?.wave ?? '—'}</span>
                  <span class="metric-lbl">Wave</span>
                </div>
                <div class="metric">
                  <span class="metric-val">{d?.puzzleProgress != null ? `${Math.round(d.puzzleProgress)}%` : '—'}</span>
                  <span class="metric-lbl">Puzzle</span>
                </div>
                <div class="metric">
                  <span class="metric-val">{d?.tick ?? '—'}</span>
                  <span class="metric-lbl">Tick</span>
                </div>
                <div class="metric">
                  <span class="metric-val">{d?.connectedSockets ?? '—'}</span>
                  <span class="metric-lbl">Sockets</span>
                </div>
                {#if d}
                  <div class="metric">
                    <span class="metric-val">{d.asteroids?.filter((a: any) => !a.destroyed).length ?? 0}</span>
                    <span class="metric-lbl">Asteroids</span>
                  </div>
                  <div class="metric">
                    <span class="metric-val">{d.npcs?.filter((n: any) => !n.destroyed).length ?? 0}</span>
                    <span class="metric-lbl">NPCs</span>
                  </div>
                  <div class="metric">
                    <span class="metric-val">{d.lasers?.length ?? 0}</span>
                    <span class="metric-lbl">Lasers</span>
                  </div>
                  <div class="metric">
                    <span class="metric-val">{d.powerUps?.filter((p: any) => !p.collected).length ?? 0}</span>
                    <span class="metric-lbl">Power-Ups</span>
                  </div>
                {/if}
              </div>

              <!-- Players inline -->
              {#if d?.players && d.players.length > 0}
                <div class="server-players">
                  <table class="mini-table">
                    <thead>
                      <tr>
                        <th></th>
                        <th>Player</th>
                        <th>Health</th>
                        <th>Score</th>
                        <th>Speed</th>
                        <th>Position</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each d.players as p}
                        <tr>
                          <td>
                            {#if p.avatarUrl}
                              <img src={p.avatarUrl} alt="" class="player-avatar-sm" />
                            {/if}
                          </td>
                          <td class="player-name-cell">{p.username}</td>
                          <td>
                            <div class="health-inline">
                              <div class="health-bar-sm-container">
                                <div class="health-bar-sm" style="width: {healthBar(p.health ?? 0, p.maxHealth ?? 100)}%"></div>
                              </div>
                              <span>{Math.round(p.health ?? 0)}/{p.maxHealth ?? 100}</span>
                            </div>
                          </td>
                          <td class="score-cell">{p.score ?? 0}</td>
                          <td>{p.speed != null ? p.speed.toFixed(1) : '—'}</td>
                          <td class="mono pos-cell">{formatPos(p.position)}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {:else if d && d.players?.length === 0}
                <div class="server-empty-note">No players connected</div>
              {/if}

              <!-- Puzzle progress bar -->
              {#if d && d.puzzleProgress != null}
                <div class="puzzle-bar-row">
                  <span class="puzzle-bar-label">Puzzle</span>
                  <div class="puzzle-bar-container">
                    <div class="puzzle-bar-fill" style="width: {Math.round(d.puzzleProgress)}%"></div>
                  </div>
                  <span class="puzzle-bar-pct">{Math.round(d.puzzleProgress)}%</span>
                  {#if d.puzzleSolved}
                    <span class="puzzle-solved-badge">SOLVED</span>
                  {/if}
                </div>
              {/if}

              <!-- NPC conversion summary -->
              {#if d?.npcs && d.npcs.some((n: any) => n.converted && !n.destroyed)}
                <div class="npc-summary">
                  <span class="npc-converted">{d.npcs.filter((n: any) => n.converted && !n.destroyed).length} converted NPCs</span>
                  <span class="npc-hostile">{d.npcs.filter((n: any) => !n.converted && !n.destroyed).length} hostile</span>
                </div>
              {/if}

              <!-- Recent events -->
              {#if d?.eventLog && d.eventLog.length > 0}
                <div class="server-events">
                  <span class="events-label">Recent Events</span>
                  <div class="events-mini-list">
                    {#each d.eventLog.slice(-3).reverse() as evt}
                      <div class="event-mini">
                        <span class="event-mini-type">{evt.event}</span>
                        {#if evt.actor}<span class="event-mini-actor">{evt.actor}</span>{/if}
                        {#if evt.detail}<span class="event-mini-detail">{evt.detail}</span>{/if}
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}

              <div class="server-card-footer">
                <button class="btn-detail" onclick={() => selectRoom(room.id)}>Full Detail →</button>
                <span class="server-id mono">{room.id}</span>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <!-- Archived Games -->
    <section class="overview-section">
      <h2>Archived Games ({archivedRooms.length})</h2>
      {#if archivedRooms.length === 0}
        <p class="empty">No archived games yet</p>
      {:else}
        <div class="archived-table-container">
          <table class="archived-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Players</th>
                <th>Final Wave</th>
                <th>Puzzle</th>
                <th>Duration</th>
                <th>Ended</th>
                <th>Events</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {#each archivedRooms as room}
                <tr class="archived-row" onclick={() => selectArchived(room.id)}>
                  <td class="archived-name">{room.name}</td>
                  <td>
                    {#each room.players as p}
                      <span class="archived-player">{p.username} ({p.score})</span>
                    {/each}
                  </td>
                  <td>{room.finalWave}</td>
                  <td>{Math.round(room.finalPuzzleProgress)}%</td>
                  <td>{formatDuration(room.duration)}</td>
                  <td>{formatAge(room.endedAt)}</td>
                  <td>{room.eventLog?.length ?? 0}</td>
                  <td><button class="btn-detail-sm" onclick={() => selectArchived(room.id)}>View →</button></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>

  {:else}
    <!-- ═══════ DETAIL MODE: Single room deep-dive ═══════ -->

    {#if selectedRoom}
      {@const d = selectedRoom.detail}
      <div class="detail-panel-full">
        <div class="detail-header">
          <h2>{selectedRoom.name}</h2>
          <button
            class="btn-delete"
            onclick={() => deleteRoom(selectedRoom.id)}
            disabled={deleting === selectedRoom.id}
          >
            {deleting === selectedRoom.id ? 'Deleting...' : 'Delete Room'}
          </button>
        </div>

        <!-- Room metadata -->
        <div class="detail-grid">
          <div class="detail-field">
            <span class="field-label">Room ID</span>
            <span class="field-value mono">{selectedRoom.id}</span>
          </div>
          <div class="detail-field">
            <span class="field-label">Phase</span>
            <span class="field-value">
              <span class="badge {phaseBadge(d?.phase ?? selectedRoom.phase)}">{d?.phase ?? selectedRoom.phase}</span>
            </span>
          </div>
          <div class="detail-field">
            <span class="field-label">Host ID</span>
            <span class="field-value mono">{d?.hostId || selectedRoom.createdById || '—'}</span>
          </div>
          <div class="detail-field">
            <span class="field-label">Created By</span>
            <span class="field-value">{selectedRoom.createdBy}</span>
          </div>
          <div class="detail-field">
            <span class="field-label">Created</span>
            <span class="field-value">{formatTime(selectedRoom.createdAt)}</span>
          </div>
          <div class="detail-field">
            <span class="field-label">Private</span>
            <span class="field-value">{(d?.isPrivate ?? selectedRoom.isPrivate) ? 'Yes' : 'No'}</span>
          </div>
          <div class="detail-field">
            <span class="field-label">Tick</span>
            <span class="field-value mono">{d?.tick ?? '—'}</span>
          </div>
          <div class="detail-field">
            <span class="field-label">Wave</span>
            <span class="field-value">{d?.wave ?? '—'}</span>
          </div>
          <div class="detail-field">
            <span class="field-label">Puzzle</span>
            <span class="field-value">{d?.puzzleProgress != null ? `${Math.round(d.puzzleProgress)}%` : '—'} {d?.puzzleSolved ? '(SOLVED)' : ''}</span>
          </div>
          <div class="detail-field">
            <span class="field-label">WS Connections</span>
            <span class="field-value">{d?.connectedSockets ?? '—'}</span>
          </div>
        </div>

        {#if d}
          <!-- Tabs -->
          <div class="tabs">
            <button class="tab" class:active={activeTab === 'players'} onclick={() => activeTab = 'players'}>
              Players ({d.players.length})
            </button>
            <button class="tab" class:active={activeTab === 'entities'} onclick={() => activeTab = 'entities'}>
              Entities ({(d.asteroids?.filter((a: any) => !a.destroyed).length ?? 0) + (d.npcs?.filter((n: any) => !n.destroyed).length ?? 0) + (d.lasers?.length ?? 0) + (d.powerUps?.filter((p: any) => !p.collected).length ?? 0)})
            </button>
            <button class="tab" class:active={activeTab === 'puzzle'} onclick={() => activeTab = 'puzzle'}>
              Puzzle ({d.puzzleNodes?.length ?? 0})
            </button>
            <button class="tab" class:active={activeTab === 'events'} onclick={() => activeTab = 'events'}>
              Events ({d.eventLog?.length ?? 0})
            </button>
          </div>

          <div class="tab-content">
            <!-- Players Tab -->
            {#if activeTab === 'players'}
              {#if d.players.length === 0}
                <p class="empty">No players</p>
              {:else}
                {#each d.players as p}
                  <div class="entity-card">
                    <div class="entity-header">
                      {#if p.avatarUrl}
                        <img src={p.avatarUrl} alt="" class="player-avatar" />
                      {/if}
                      <span class="entity-name">{p.username}</span>
                      <span class="entity-id mono">{p.id}</span>
                    </div>
                    <div class="entity-details">
                      {#if p.maxHealth}
                        <div class="health-row">
                          <span class="field-label">Health</span>
                          <div class="health-bar-container">
                            <div class="health-bar" style="width: {healthBar(p.health, p.maxHealth)}%"></div>
                          </div>
                          <span class="field-value">{Math.round(p.health)}/{p.maxHealth}</span>
                        </div>
                      {/if}
                      <div class="entity-stats">
                        <span>Score: <strong>{p.score}</strong></span>
                        {#if p.speed != null}<span>Speed: {p.speed.toFixed(1)}</span>{/if}
                        {#if p.position}<span>Pos: {formatPos(p.position)}</span>{/if}
                        {#if p.velocity}<span>Vel: {formatPos(p.velocity)}</span>{/if}
                        {#if p.lastProcessedInput != null}<span>Last Input: {p.lastProcessedInput}</span>{/if}
                        {#if p.damageCooldownUntil && p.damageCooldownUntil > Date.now()}
                          <span class="invincible">INVINCIBLE</span>
                        {/if}
                      </div>
                    </div>
                  </div>
                {/each}
              {/if}

            <!-- Entities Tab -->
            {:else if activeTab === 'entities'}
              <h3>Asteroids ({d.asteroids?.filter((a: any) => !a.destroyed).length ?? 0} alive / {d.asteroids?.length ?? 0} total)</h3>
              <div class="entity-table">
                <table>
                  <thead>
                    <tr><th>ID</th><th>HP</th><th>Radius</th><th>Position</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {#each d.asteroids ?? [] as a}
                      <tr class:destroyed={a.destroyed}>
                        <td class="mono">{a.id}</td>
                        <td>{a.health}/{a.maxHealth}</td>
                        <td>{a.radius.toFixed(1)}</td>
                        <td class="mono">{formatPos(a.position)}</td>
                        <td>{a.destroyed ? 'DESTROYED' : 'alive'}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>

              <h3>NPCs ({d.npcs?.filter((n: any) => !n.destroyed).length ?? 0} alive / {d.npcs?.length ?? 0} total)</h3>
              <div class="entity-table">
                <table>
                  <thead>
                    <tr><th>ID</th><th>HP</th><th>Converted</th><th>Conv%</th><th>Target Node</th><th>Position</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {#each d.npcs ?? [] as n}
                      <tr class:destroyed={n.destroyed} class:converted={n.converted}>
                        <td class="mono">{n.id}</td>
                        <td>{n.health}/{n.maxHealth}</td>
                        <td>{n.converted ? 'YES' : 'no'}</td>
                        <td>{Math.round(n.conversionProgress * 100)}%</td>
                        <td class="mono">{n.targetNodeId ?? '—'}</td>
                        <td class="mono">{formatPos(n.position)}</td>
                        <td>{n.destroyed ? 'DESTROYED' : n.converted ? 'ALLIED' : 'hostile'}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>

              <h3>Lasers ({d.lasers?.length ?? 0} active)</h3>
              {#if d.lasers && d.lasers.length > 0}
                <div class="entity-table">
                  <table>
                    <thead>
                      <tr><th>ID</th><th>Owner</th><th>Life</th></tr>
                    </thead>
                    <tbody>
                      {#each d.lasers as l}
                        <tr>
                          <td class="mono">{l.id}</td>
                          <td class="mono">{l.ownerId}</td>
                          <td>{l.life.toFixed(2)}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}

              <h3>Power-Ups ({d.powerUps?.filter((p: any) => !p.collected).length ?? 0} available / {d.powerUps?.length ?? 0} total)</h3>
              <div class="entity-table">
                <table>
                  <thead>
                    <tr><th>ID</th><th>Type</th><th>Position</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {#each d.powerUps ?? [] as pu}
                      <tr class:destroyed={pu.collected}>
                        <td class="mono">{pu.id}</td>
                        <td><span class="pu-type pu-{pu.type}">{pu.type}</span></td>
                        <td class="mono">{formatPos(pu.position)}</td>
                        <td>{pu.collected ? 'COLLECTED' : 'available'}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>

            <!-- Puzzle Tab -->
            {:else if activeTab === 'puzzle'}
              <div class="puzzle-summary">
                <span>Progress: <strong>{Math.round(d.puzzleProgress)}%</strong></span>
                <span>Solved: <strong>{d.puzzleSolved ? 'YES' : 'No'}</strong></span>
                <span>Connected: <strong>{d.puzzleNodes?.filter((n: any) => n.connected).length ?? 0}/{d.puzzleNodes?.length ?? 0}</strong></span>
              </div>
              <div class="entity-table">
                <table>
                  <thead>
                    <tr><th>ID</th><th>Color</th><th>Connected</th><th>Position</th><th>Target</th></tr>
                  </thead>
                  <tbody>
                    {#each d.puzzleNodes ?? [] as pn}
                      <tr class:connected={pn.connected}>
                        <td class="mono">{pn.id}</td>
                        <td><span class="color-swatch" style="background:{pn.color}"></span> {pn.color}</td>
                        <td>{pn.connected ? 'YES' : 'no'}</td>
                        <td class="mono">{formatPos(pn.position)}</td>
                        <td class="mono">{formatPos(pn.targetPosition)}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>

            <!-- Events Tab -->
            {:else if activeTab === 'events'}
              {#if !d.eventLog || d.eventLog.length === 0}
                <p class="empty">No events recorded</p>
              {:else}
                <div class="event-list">
                  {#each [...d.eventLog].reverse() as evt}
                    <div class="event-item">
                      <span class="event-time">{formatTime(evt.time)}</span>
                      <span class="event-type">{evt.event}</span>
                      {#if evt.actor}<span class="event-actor">{evt.actor}</span>{/if}
                      {#if evt.detail}<span class="event-detail">{evt.detail}</span>{/if}
                    </div>
                  {/each}
                </div>
              {/if}
            {/if}
          </div>
        {:else}
          <p class="empty">Loading room details from Durable Object...</p>
        {/if}
      </div>

    {:else if selectedArchived}
      <div class="detail-panel-full">
        <div class="detail-header">
          <h2>{selectedArchived.name}</h2>
          <span class="badge badge-ended">ended</span>
        </div>

        <div class="detail-grid">
          <div class="detail-field">
            <span class="field-label">Room ID</span>
            <span class="field-value mono">{selectedArchived.id}</span>
          </div>
          <div class="detail-field">
            <span class="field-label">Ended</span>
            <span class="field-value">{formatTime(selectedArchived.endedAt)}</span>
          </div>
          <div class="detail-field">
            <span class="field-label">Duration</span>
            <span class="field-value">{formatDuration(selectedArchived.duration)}</span>
          </div>
          <div class="detail-field">
            <span class="field-label">Final Wave</span>
            <span class="field-value">{selectedArchived.finalWave}</span>
          </div>
          <div class="detail-field">
            <span class="field-label">Final Puzzle</span>
            <span class="field-value">{Math.round(selectedArchived.finalPuzzleProgress)}%</span>
          </div>
          <div class="detail-field">
            <span class="field-label">Player Count</span>
            <span class="field-value">{selectedArchived.players.length}</span>
          </div>
        </div>

        <!-- Tabs for archived room -->
        <div class="tabs">
          <button class="tab" class:active={archivedTab === 'players'} onclick={() => archivedTab = 'players'}>
            Players ({selectedArchived.players.length})
          </button>
          <button class="tab" class:active={archivedTab === 'events'} onclick={() => archivedTab = 'events'}>
            Event Log ({selectedArchived.eventLog?.length ?? 0})
          </button>
        </div>

        <div class="tab-content">
          {#if archivedTab === 'players'}
            {#each selectedArchived.players as p}
              <div class="entity-card">
                <div class="entity-header">
                  <span class="entity-name">{p.username}</span>
                  <span class="entity-id mono">{p.id}</span>
                </div>
                <div class="entity-stats">
                  <span>Score: <strong>{p.score}</strong></span>
                </div>
              </div>
            {/each}

            {#if selectedArchived.playerIds.length > 0}
              <h3>Discord IDs</h3>
              <div class="id-list">
                {#each selectedArchived.playerIds as pid}
                  <span class="mono">{pid}</span>
                {/each}
              </div>
            {/if}

          {:else if archivedTab === 'events'}
            {#if !selectedArchived.eventLog || selectedArchived.eventLog.length === 0}
              <p class="empty">No event log available for this game (archived before logging was enabled)</p>
            {:else}
              <div class="event-list">
                {#each [...selectedArchived.eventLog].reverse() as evt}
                  <div class="event-item">
                    <span class="event-time">{formatTime(evt.time)}</span>
                    <span class="event-type">{evt.event}</span>
                    {#if evt.actor}<span class="event-actor">{evt.actor}</span>{/if}
                    {#if evt.detail}<span class="event-detail">{evt.detail}</span>{/if}
                  </div>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .admin-page {
    min-height: 100vh;
    background: var(--color-bg);
    color: var(--color-text);
    font-family: var(--hud-font);
    padding: var(--spacing-xl);
  }

  header {
    margin-bottom: var(--spacing-xl);
    border-bottom: 1px solid var(--color-text-dim);
    padding-bottom: var(--spacing-lg);
  }

  .header-top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: var(--spacing-md);
  }

  h1 { font-size: var(--font-2xl); color: var(--color-primary); margin: 0; }
  h2 { font-size: var(--font-lg); color: var(--color-secondary); margin: var(--spacing-lg) 0 var(--spacing-md); }
  h3 { font-size: var(--font-md); color: var(--color-text-dim); margin: var(--spacing-lg) 0 var(--spacing-sm); }

  .user-info { color: var(--color-text-dim); font-size: var(--font-sm); }

  .controls {
    display: flex; align-items: center; gap: var(--spacing-md); flex-wrap: wrap;
  }
  .timestamp { color: var(--color-text-dim); font-size: var(--font-xs); margin-left: auto; }

  /* Connection status */
  .connection-status { font-size: var(--font-xs); font-weight: bold; padding: 2px 10px; border: 1px solid; text-transform: uppercase; letter-spacing: 0.05em; }
  .connection-status.connected { color: var(--color-primary); border-color: var(--color-primary); }
  .connection-status.reconnecting { color: var(--color-warning); border-color: var(--color-warning); animation: pulse 1s ease-in-out infinite; }
  .connection-status:not(.connected):not(.reconnecting) { color: var(--color-danger); border-color: var(--color-danger); }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

  /* Stats */
  .stats { display: flex; gap: var(--spacing-md); flex-wrap: wrap; margin-bottom: var(--spacing-lg); }
  .stat-card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); padding: var(--spacing-md) var(--spacing-lg); min-width: 120px; text-align: center; }
  .stat-value { font-size: var(--font-2xl); color: var(--color-primary); font-weight: bold; }
  .stat-label { font-size: var(--font-xs); color: var(--color-text-dim); margin-top: var(--spacing-xs); }

  /* ── Overview mode ── */
  .overview-section { margin-bottom: var(--spacing-xl); }
  .overview-grid { display: flex; flex-direction: column; gap: var(--spacing-lg); }

  /* Server cards */
  .server-card {
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.08);
    padding: var(--spacing-md) var(--spacing-lg);
    transition: border-color 0.15s;
  }
  .server-card.has-detail { border-color: rgba(255,255,255,0.15); }
  .server-card:hover { border-color: var(--color-secondary); }

  .server-card-header {
    display: flex; align-items: center; gap: var(--spacing-sm); margin-bottom: var(--spacing-sm);
  }
  .server-name {
    font-weight: bold; font-size: var(--font-md); color: var(--color-primary);
    background: none; border: none; cursor: pointer; font-family: var(--hud-font);
    padding: 0; text-decoration: underline; text-decoration-color: transparent;
    transition: text-decoration-color 0.15s;
  }
  .server-name:hover { text-decoration-color: var(--color-primary); }
  .server-age { font-size: 0.7rem; color: var(--color-text-dim); opacity: 0.6; margin-left: auto; }

  .btn-delete-mini {
    background: rgba(255,68,68,0.15); color: var(--color-danger); border: 1px solid rgba(255,68,68,0.3);
    width: 24px; height: 24px; font-size: 0.75rem; cursor: pointer; display: flex;
    align-items: center; justify-content: center; font-family: var(--hud-font);
  }
  .btn-delete-mini:hover { background: rgba(255,68,68,0.3); }
  .btn-delete-mini:disabled { opacity: 0.4; cursor: not-allowed; }

  /* Metrics bar */
  .server-metrics {
    display: flex; flex-wrap: wrap; gap: var(--spacing-sm); margin-bottom: var(--spacing-sm);
    padding: var(--spacing-xs) 0;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  .metric {
    display: flex; flex-direction: column; align-items: center;
    min-width: 64px; padding: var(--spacing-xs) var(--spacing-sm);
    background: rgba(255,255,255,0.03);
  }
  .metric-val { font-size: var(--font-sm); color: var(--color-primary); font-weight: bold; }
  .metric-lbl { font-size: 0.6rem; color: var(--color-text-dim); text-transform: uppercase; }

  /* Mini player table in overview */
  .server-players { margin: var(--spacing-sm) 0; overflow-x: auto; }
  .mini-table { width: 100%; border-collapse: collapse; font-size: var(--font-xs); }
  .mini-table th {
    text-align: left; padding: var(--spacing-xs) var(--spacing-sm);
    border-bottom: 1px solid rgba(255,255,255,0.1);
    color: var(--color-text-dim); font-weight: normal; text-transform: uppercase; font-size: 0.6rem;
  }
  .mini-table td {
    padding: var(--spacing-xs) var(--spacing-sm);
    border-bottom: 1px solid rgba(255,255,255,0.03);
    white-space: nowrap;
  }
  .player-avatar-sm { width: 18px; height: 18px; border-radius: 50%; }
  .player-name-cell { color: var(--color-primary); font-weight: bold; }
  .score-cell { color: var(--color-secondary); font-weight: bold; }
  .pos-cell { font-size: 0.7rem; }

  /* Health bar inline */
  .health-inline { display: flex; align-items: center; gap: 4px; }
  .health-bar-sm-container { width: 60px; height: 6px; background: rgba(255,255,255,0.1); }
  .health-bar-sm { height: 100%; background: var(--color-primary); transition: width 0.3s; }

  /* Puzzle progress bar */
  .puzzle-bar-row {
    display: flex; align-items: center; gap: var(--spacing-sm);
    margin: var(--spacing-xs) 0; font-size: var(--font-xs);
  }
  .puzzle-bar-label { color: var(--color-text-dim); text-transform: uppercase; font-size: 0.6rem; min-width: 40px; }
  .puzzle-bar-container { flex: 1; max-width: 300px; height: 6px; background: rgba(255,255,255,0.1); }
  .puzzle-bar-fill { height: 100%; background: var(--color-secondary); transition: width 0.5s; }
  .puzzle-bar-pct { color: var(--color-secondary); font-weight: bold; min-width: 32px; }
  .puzzle-solved-badge { color: var(--color-primary); font-weight: bold; font-size: 0.7rem; border: 1px solid var(--color-primary); padding: 0 4px; }

  /* NPC summary */
  .npc-summary {
    display: flex; gap: var(--spacing-md); font-size: var(--font-xs);
    margin: var(--spacing-xs) 0; padding: var(--spacing-xs) 0;
  }
  .npc-converted { color: var(--color-primary); }
  .npc-hostile { color: var(--color-danger); }

  /* Recent events in overview */
  .server-events {
    margin: var(--spacing-xs) 0;
    padding: var(--spacing-xs) 0;
    border-top: 1px solid rgba(255,255,255,0.05);
  }
  .events-label {
    font-size: 0.6rem; color: var(--color-text-dim); text-transform: uppercase; margin-bottom: 2px; display: block;
  }
  .events-mini-list { display: flex; flex-direction: column; gap: 1px; }
  .event-mini {
    display: flex; gap: var(--spacing-sm); font-size: 0.7rem;
    padding: 1px var(--spacing-xs);
    background: rgba(255,255,255,0.02);
  }
  .event-mini-type { color: var(--color-secondary); font-weight: bold; min-width: 80px; }
  .event-mini-actor { color: var(--color-primary); }
  .event-mini-detail { color: var(--color-text-dim); }

  /* Server card footer */
  .server-card-footer {
    display: flex; justify-content: space-between; align-items: center;
    margin-top: var(--spacing-sm); padding-top: var(--spacing-xs);
    border-top: 1px solid rgba(255,255,255,0.05);
  }
  .server-id { font-size: 0.65rem; opacity: 0.4; }
  .server-empty-note { font-size: var(--font-xs); color: var(--color-text-dim); font-style: italic; padding: var(--spacing-xs) 0; }

  .btn-detail {
    background: rgba(68,136,255,0.15); color: var(--color-secondary); border: 1px solid rgba(68,136,255,0.3);
    padding: 3px 10px; font-family: var(--hud-font); font-size: 0.7rem; cursor: pointer;
  }
  .btn-detail:hover { background: rgba(68,136,255,0.3); }
  .btn-detail-sm {
    background: rgba(68,136,255,0.1); color: var(--color-secondary); border: 1px solid rgba(68,136,255,0.2);
    padding: 2px 8px; font-family: var(--hud-font); font-size: 0.65rem; cursor: pointer;
  }
  .btn-detail-sm:hover { background: rgba(68,136,255,0.25); }

  /* Archived table */
  .archived-table-container { overflow-x: auto; }
  .archived-table { width: 100%; border-collapse: collapse; font-size: var(--font-xs); }
  .archived-table th {
    text-align: left; padding: var(--spacing-xs) var(--spacing-sm);
    border-bottom: 1px solid var(--color-text-dim);
    color: var(--color-text-dim); font-weight: normal; text-transform: uppercase; font-size: 0.65rem;
  }
  .archived-table td {
    padding: var(--spacing-xs) var(--spacing-sm);
    border-bottom: 1px solid rgba(255,255,255,0.03);
  }
  .archived-row { cursor: pointer; transition: background 0.15s; }
  .archived-row:hover { background: rgba(255,255,255,0.03); }
  .archived-name { color: var(--color-text); font-weight: bold; }
  .archived-player { display: inline-block; margin-right: 8px; color: var(--color-text-dim); font-size: 0.7rem; }

  /* ── Detail mode ── */
  .detail-panel-full {
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.08);
    padding: var(--spacing-lg);
  }

  .detail-header { display: flex; justify-content: space-between; align-items: center; }
  .detail-header h2 { margin: 0; }
  .detail-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: var(--spacing-sm); margin: var(--spacing-md) 0; }
  .detail-field { background: rgba(255,255,255,0.03); padding: var(--spacing-sm) var(--spacing-md); }
  .field-label { display: block; font-size: 0.65rem; color: var(--color-text-dim); text-transform: uppercase; margin-bottom: 2px; }
  .field-value { font-size: var(--font-sm); word-break: break-all; }

  /* Tabs */
  .tabs { display: flex; gap: 2px; margin: var(--spacing-lg) 0 0; border-bottom: 1px solid rgba(255,255,255,0.1); }
  .tab {
    background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-bottom: none;
    color: var(--color-text-dim); padding: var(--spacing-sm) var(--spacing-lg);
    font-family: var(--hud-font); font-size: var(--font-xs); cursor: pointer;
  }
  .tab:hover { color: var(--color-text); }
  .tab.active { color: var(--color-primary); border-color: var(--color-primary); background: rgba(0,255,136,0.05); }
  .tab-content { padding: var(--spacing-md) 0; }

  /* Entity cards */
  .entity-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); padding: var(--spacing-md); margin-bottom: var(--spacing-sm); }
  .entity-header { display: flex; align-items: center; gap: var(--spacing-sm); margin-bottom: var(--spacing-sm); }
  .entity-name { color: var(--color-primary); font-weight: bold; }
  .entity-id { font-size: 0.7rem; opacity: 0.5; }
  .entity-details { margin-top: var(--spacing-sm); }
  .entity-stats { display: flex; flex-wrap: wrap; gap: var(--spacing-md); font-size: var(--font-xs); color: var(--color-text-dim); }
  .player-avatar { width: 24px; height: 24px; border-radius: 50%; }

  /* Health bar */
  .health-row { display: flex; align-items: center; gap: var(--spacing-sm); margin-bottom: var(--spacing-xs); }
  .health-bar-container { flex: 1; height: 8px; background: rgba(255,255,255,0.1); max-width: 200px; }
  .health-bar { height: 100%; background: var(--color-primary); transition: width 0.3s; }
  .invincible { color: var(--color-warning); font-weight: bold; font-size: 0.75rem; }

  /* Entity tables */
  .entity-table { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: var(--font-xs); }
  th { text-align: left; padding: var(--spacing-xs) var(--spacing-sm); border-bottom: 1px solid var(--color-text-dim); color: var(--color-text-dim); font-weight: normal; text-transform: uppercase; font-size: 0.65rem; white-space: nowrap; }
  td { padding: var(--spacing-xs) var(--spacing-sm); border-bottom: 1px solid rgba(255,255,255,0.03); white-space: nowrap; }
  tr.destroyed { opacity: 0.35; }
  tr.converted { color: var(--color-primary); }
  tr.connected td { color: var(--color-primary); }

  .mono { font-family: monospace; font-size: 0.8rem; }

  /* Badge */
  .badge { padding: 1px 8px; font-size: 0.65rem; text-transform: uppercase; white-space: nowrap; }
  .badge-playing { color: var(--color-primary); border: 1px solid var(--color-primary); }
  .badge-lobby { color: var(--color-warning); border: 1px solid var(--color-warning); }
  .badge-ended { color: var(--color-text-dim); border: 1px solid var(--color-text-dim); }

  /* Power-up types */
  .pu-type { padding: 1px 6px; font-size: 0.7rem; text-transform: uppercase; }
  .pu-health { color: #ff4444; }
  .pu-speed { color: #44aaff; }
  .pu-multishot { color: #ffaa00; }
  .pu-shield { color: #44ffaa; }

  /* Puzzle */
  .puzzle-summary { display: flex; gap: var(--spacing-xl); margin-bottom: var(--spacing-md); font-size: var(--font-sm); }
  .color-swatch { display: inline-block; width: 12px; height: 12px; vertical-align: middle; border: 1px solid rgba(255,255,255,0.2); }

  /* Events */
  .event-list { display: flex; flex-direction: column; gap: 1px; }
  .event-item { display: flex; gap: var(--spacing-md); padding: var(--spacing-xs) var(--spacing-sm); font-size: var(--font-xs); background: rgba(255,255,255,0.02); }
  .event-time { color: var(--color-text-dim); font-size: 0.7rem; white-space: nowrap; font-family: monospace; }
  .event-type { color: var(--color-secondary); font-weight: bold; min-width: 120px; }
  .event-actor { color: var(--color-primary); }
  .event-detail { color: var(--color-text-dim); }

  /* ID list */
  .id-list { display: flex; flex-direction: column; gap: 2px; font-size: 0.8rem; }

  /* Buttons */
  .btn-refresh { background: rgba(68,136,255,0.2); color: var(--color-secondary); border: 1px solid var(--color-secondary); padding: 4px 12px; font-family: var(--hud-font); font-size: var(--font-xs); cursor: pointer; }
  .btn-refresh:hover { background: rgba(68,136,255,0.4); }
  .btn-back { background: rgba(255,255,255,0.08); color: var(--color-text); border: 1px solid rgba(255,255,255,0.2); padding: 4px 12px; font-family: var(--hud-font); font-size: var(--font-xs); cursor: pointer; }
  .btn-back:hover { background: rgba(255,255,255,0.15); }
  .btn-delete { background: rgba(255,68,68,0.2); color: var(--color-danger); border: 1px solid var(--color-danger); padding: 4px 14px; font-family: var(--hud-font); font-size: var(--font-xs); cursor: pointer; }
  .btn-delete:hover { background: rgba(255,68,68,0.4); }
  .btn-delete:disabled { opacity: 0.5; cursor: not-allowed; }
  .private-tag { font-size: 0.65rem; color: var(--color-warning); border: 1px solid var(--color-warning); padding: 0 4px; }

  /* Errors */
  .errors { margin-bottom: var(--spacing-lg); }
  .error-item { background: rgba(255,68,68,0.1); border: 1px solid var(--color-danger); color: var(--color-danger); padding: var(--spacing-sm) var(--spacing-md); margin-bottom: var(--spacing-xs); font-size: var(--font-xs); }
  .empty { color: var(--color-text-dim); font-style: italic; }

  @media (max-width: 900px) {
    .server-metrics { gap: var(--spacing-xs); }
    .metric { min-width: 50px; }
  }
</style>
