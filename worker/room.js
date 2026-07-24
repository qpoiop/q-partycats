/* ============================================================
   Room — a Cloudflare Durable Object: one authoritative instance
   per room code. Owns the connected players and the strict
   connection lifecycle:
     - join (create/assign a slot + a reconnect token)
     - heartbeat ping/pong → evict zombie connections
     - graceful close → free the slot, broadcast presence
     - reconnect (same token within a grace window → reclaim slot)
   Game-state sync (inputs → authoritative sim → snapshots) is a
   later layer that plugs into broadcast(); this file is the
   connection substrate it will ride on.
   ============================================================ */

const HEARTBEAT_MS = 5000;    // server pings this often
const PONG_TIMEOUT_MS = 12000; // no pong within → zombie, evict
const RECONNECT_GRACE_MS = 15000; // keep a dropped slot this long for reconnect
const MAX_PLAYERS = 4;

const now = () => Date.now();
const uid = () => crypto.randomUUID();

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.code = null;
    // slot index → { id, token, name, color, ws|null, alive, lastPong, dropAt }
    this.slots = new Map();
    this.hostId = null;
    this.config = { count: MAX_PLAYERS, rounds: 3 };
    this.phase = 'lobby';          // lobby | playing
    this._alarmSet = false;
    this._ensureAlarm();
  }

  // ---- HTTP entry: upgrade WebSocket ----
  async fetch(request) {
    const url = new URL(request.url);
    this.code = url.searchParams.get('code') || this.code;
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this._accept(server, {
      name: (url.searchParams.get('name') || '냥').slice(0, 12),
      color: parseInt(url.searchParams.get('color') || '0', 10) || 0,
      animal: parseInt(url.searchParams.get('animal') || '0', 10) || 0,
      token: url.searchParams.get('token') || null,   // present → reconnect attempt
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  _accept(ws, opts) {
    ws.accept();

    // reconnect: reclaim the held slot if the token matches and is in grace
    let slotIdx = null, entry = null;
    if (opts.token) {
      for (const [i, e] of this.slots) if (e.token === opts.token) { slotIdx = i; entry = e; break; }
    }
    if (entry) {
      entry.ws = ws; entry.alive = true; entry.lastPong = now(); entry.dropAt = 0;
    } else {
      slotIdx = this._freeSlot();
      if (slotIdx === null) { this._send(ws, { t: 'full' }); ws.close(1013, 'room full'); return; }
      const wantAnimal = (opts.animal >= 0 && opts.animal < 6) ? opts.animal : slotIdx % 6;
      entry = { id: uid(), token: uid(), name: opts.name, color: this._pickColor(opts.color), animal: this._pickAnimal(wantAnimal), ready: false, ws, alive: true, lastPong: now(), dropAt: 0, slot: slotIdx };
      this.slots.set(slotIdx, entry);
      if (!this.hostId) this.hostId = entry.id;
    }

    ws.addEventListener('message', (ev) => this._onMessage(entry, ev));
    ws.addEventListener('close', () => this._onClose(entry));
    ws.addEventListener('error', () => this._onClose(entry));

    // welcome: identity + reconnect token + current room snapshot
    this._send(ws, {
      t: 'welcome', you: entry.id, slot: slotIdx, token: entry.token,
      host: this.hostId === entry.id, code: this.code,
      heartbeat: HEARTBEAT_MS, config: this.config, phase: this.phase,
    });
    this._broadcastPresence();
  }

  _onMessage(entry, ev) {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    entry.lastPong = now();          // any traffic counts as liveness
    switch (msg.t) {
      case 'pong': entry.alive = true; break;
      case 'ping': this._send(entry.ws, { t: 'pong' }); break;
      case 'setColor': if (this._colorFree(msg.color, entry)) { entry.color = msg.color; this._broadcastPresence(); } break;
      case 'setAnimal': { const a = msg.animal | 0; if (a >= 0 && a < 6 && this._animalFree(a, entry)) { entry.animal = a; this._broadcastPresence(); } break; }
      case 'setReady': entry.ready = !!msg.ready; this._broadcastPresence(); break;
      case 'setName': entry.name = String(msg.name || '').slice(0, 12) || entry.name; this._broadcastPresence(); break;
      case 'config': if (entry.id === this.hostId) { this.config = { count: msg.count | 0 || this.config.count, rounds: msg.rounds | 0 || this.config.rounds }; this._broadcastPresence(); } break;
      case 'start': if (entry.id === this.hostId && this.phase === 'lobby' && this._allReady()) { this.phase = 'playing'; this._broadcast({ t: 'start', config: this.config, roster: this._roster(), hostSlot: this._slotOf(this.hostId) }); } break;
      case 'lobby': if (entry.id === this.hostId) { this.phase = 'lobby'; this._broadcast({ t: 'toLobby' }); } break;
      // host-authoritative relay: inputs go to the host, snapshots go to everyone else
      case 'input': { const h = this._hostWs(); if (h) this._send(h, { t: 'input', slot: entry.slot, input: msg.input }); break; }
      case 'snap': if (entry.id === this.hostId) this._broadcast({ t: 'snap', s: msg.s }, entry.id); break;
      default: break;
    }
  }

  _onClose(entry) {
    if (entry.ws) { try { entry.ws.close(); } catch {} entry.ws = null; }
    entry.alive = false;
    entry.dropAt = now();            // start the reconnect grace window
    this._broadcastPresence();
  }

  // ---- heartbeat / zombie sweep (Durable Object alarm) ----
  async alarm() {
    this._alarmSet = false;
    const t = now();
    for (const [i, e] of [...this.slots]) {
      if (e.ws) {
        // evict zombies: connected but silent past the pong timeout
        if (t - e.lastPong > PONG_TIMEOUT_MS) {
          try { e.ws.close(1001, 'timeout'); } catch {}
          e.ws = null; e.alive = false; e.dropAt = t;
        } else {
          this._send(e.ws, { t: 'ping', now: t });   // liveness probe
        }
      } else if (e.dropAt && t - e.dropAt > RECONNECT_GRACE_MS) {
        // grace expired → free the slot for good
        this.slots.delete(i);
        if (this.hostId === e.id) this.hostId = this._anyId();
      }
    }
    this._broadcastPresence();
    if (this.slots.size > 0) this._ensureAlarm();   // keep sweeping while anyone is here
  }

  _ensureAlarm() {
    if (this._alarmSet) return;
    this._alarmSet = true;
    this.state.storage.setAlarm(now() + HEARTBEAT_MS);
  }

  // ---- helpers ----
  _hostWs() { for (const e of this.slots.values()) if (e.id === this.hostId) return e.ws; return null; }
  _slotOf(id) { for (const [i, e] of this.slots) if (e.id === id) return i; return -1; }
  _roster() { return [...this.slots.entries()].sort((a, b) => a[0] - b[0]).map(([slot, e]) => ({ slot, color: e.color, animal: e.animal, name: e.name, connected: !!e.ws })); }
  _allReady() { let any = false; for (const e of this.slots.values()) { if (!e.ws) continue; any = true; if (!e.ready) return false; } return any; }
  _freeSlot() { for (let i = 0; i < MAX_PLAYERS; i++) if (!this.slots.has(i)) return i; return null; }
  _anyId() { for (const e of this.slots.values()) return e.id; return null; }
  _colorFree(c, self) { for (const e of this.slots.values()) if (e !== self && e.color === c) return false; return true; }
  _pickColor(pref) { if (this._colorFree(pref, null)) return pref; for (let c = 0; c < MAX_PLAYERS; c++) if (this._colorFree(c, null)) return c; return pref; }
  _animalFree(a, self) { for (const e of this.slots.values()) if (e !== self && e.animal === a) return false; return true; }
  _pickAnimal(pref) { if (this._animalFree(pref, null)) return pref; for (let a = 0; a < 6; a++) if (this._animalFree(a, null)) return a; return pref; }

  _presence() {
    const players = [...this.slots.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([slot, e]) => ({ slot, id: e.id, name: e.name, color: e.color, animal: e.animal, ready: e.ready, connected: !!e.ws, host: e.id === this.hostId }));
    return { t: 'presence', code: this.code, phase: this.phase, config: this.config, host: this.hostId, players };
  }
  _broadcastPresence() { this._broadcast(this._presence()); }

  _broadcast(obj, exceptId = null) {
    const s = JSON.stringify(obj);
    for (const e of this.slots.values()) if (e.ws && e.id !== exceptId) { try { e.ws.send(s); } catch { this._onClose(e); } }
  }
  _send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch {} }
}
