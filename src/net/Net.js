/* ============================================================
   Net — client WebSocket manager for multiplayer rooms.
   Mirrors the server (worker/room.js) connection lifecycle:
     - connect to /api/room/CODE/ws, receive identity + reconnect token
     - answer server pings with pong (liveness)
     - on drop, auto-reconnect with the token (exponential backoff) to
       reclaim the same slot within the server's grace window
   Emits events the lobby/game subscribe to. Gameplay input/snapshot
   messages ride on send()/onInput — wired in the sync layer.
   ============================================================ */
export class Net {
  constructor() {
    this.ws = null;
    this.code = null;
    this.token = null;      // reconnect token from the server
    this.self = null;       // { id, slot, host }
    this.opts = { name: '냥', color: 0 };
    this.status = 'idle';   // idle | connecting | open | reconnecting | closed
    this._backoff = 500;
    this._want = false;     // whether we intend to stay connected
    this._pingT = null;
    this.handlers = {};     // event → [fn]
  }

  on(evt, fn) { (this.handlers[evt] ||= []).push(fn); return this; }
  _emit(evt, data) { (this.handlers[evt] || []).forEach(fn => { try { fn(data); } catch (e) { console.error('[net]', evt, e); } }); }

  connect(code, opts = {}) {
    this.code = (code || '').toUpperCase();
    Object.assign(this.opts, opts);
    this._want = true;
    this._open();
  }

  _url() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const q = new URLSearchParams({ name: this.opts.name, color: String(this.opts.color), animal: String(this.opts.animal || 0) });
    if (this.token) q.set('token', this.token);   // reconnect → reclaim slot
    return `${proto}://${location.host}/api/room/${this.code}/ws?${q}`;
  }

  _open() {
    this._setStatus(this.token ? 'reconnecting' : 'connecting');
    let ws;
    try { ws = new WebSocket(this._url()); } catch (e) { this._scheduleReconnect(); return; }
    this.ws = ws;
    ws.onopen = () => { this._backoff = 500; this._setStatus('open'); this._startPing(); };
    ws.onmessage = (ev) => this._onMessage(ev);
    ws.onclose = () => { this._stopPing(); if (this._want) this._scheduleReconnect(); else this._setStatus('closed'); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }

  _onMessage(ev) {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    switch (msg.t) {
      case 'welcome':
        this.token = msg.token;
        this.self = { id: msg.you, slot: msg.slot, host: msg.host };
        this._emit('welcome', msg);
        break;
      case 'presence': this._emit('presence', msg); break;
      case 'start': this._emit('start', msg); break;
      case 'input': this._emit('input', msg); break;
      case 'full': this._want = false; this._emit('full', msg); break;
      case 'ping': this.send({ t: 'pong' }); break;   // liveness
      case 'pong': break;
      default: this._emit(msg.t, msg);
    }
  }

  _startPing() {
    this._stopPing();
    this._pingT = setInterval(() => this.send({ t: 'ping' }), 4000);
  }
  _stopPing() { if (this._pingT) { clearInterval(this._pingT); this._pingT = null; } }

  _scheduleReconnect() {
    this._setStatus('reconnecting');
    const wait = Math.min(this._backoff, 8000);
    this._backoff = Math.min(this._backoff * 2, 8000);
    setTimeout(() => { if (this._want) this._open(); }, wait + Math.random() * 250);
  }

  send(obj) { if (this.ws && this.ws.readyState === WebSocket.OPEN) { this.ws.send(JSON.stringify(obj)); return true; } return false; }

  // lobby actions
  setColor(color) { this.opts.color = color; this.send({ t: 'setColor', color }); }
  setAnimal(animal) { this.opts.animal = animal; this.send({ t: 'setAnimal', animal }); }
  setReady(ready) { this.send({ t: 'setReady', ready }); }
  setName(name) { this.opts.name = name; this.send({ t: 'setName', name }); }
  setConfig(count, rounds) { this.send({ t: 'config', count, rounds }); }
  start() { this.send({ t: 'start' }); }
  toLobby() { this.send({ t: 'lobby' }); }
  input(input) { this.send({ t: 'input', input }); }
  snapshot(s) { this.send({ t: 'snap', s }); }

  close() { this._want = false; this._stopPing(); try { this.ws && this.ws.close(); } catch {} this._setStatus('closed'); }

  _setStatus(s) { if (this.status !== s) { this.status = s; this._emit('status', s); } }
}
