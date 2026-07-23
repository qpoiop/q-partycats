/* ============================================================
   Multiplayer — host-authoritative gameplay sync over the DO relay.

   Host: runs the one true simulation (all cats in one physics world).
     - applies the local human's input to players[0]
     - applies each remote client's input to their slot's player
     - broadcasts compact snapshots (~20Hz) → DO fans out
   Client: does NOT simulate.
     - sends its own input each frame
     - applies incoming snapshots (smoothed) to every cat, so it sees the
       real interaction (pushes/grabs/knockbacks) happening in the host world

   players[0] is always the LOCAL cat (keeps all players[0] assumptions);
   identity across the wire is player.slot, not the array index.
   ============================================================ */
const PHASES = ['home', 'lobby', 'countdown', 'playing', 'ceremony', 'results'];
const phaseCode = s => Math.max(0, PHASES.indexOf(s));
const phaseName = c => PHASES[c] || 'playing';

export class Multiplayer {
  constructor(game) { this.game = game; this.reset(); }

  reset() {
    this.on = false; this.isHost = false; this.net = null;
    this.localSlot = 0; this.bySlot = {};
    this.remote = {};        // slot → latest {mx,mz,mag,a:[]}
    this.localActions = [];  // queued local action names this frame
    this._latest = null;     // client: latest snapshot
    this._snapAcc = 0; this.snapDt = 1 / 20;
  }

  /** Called once the match roster is built (players[] ready). */
  begin(net, { isHost, localSlot }) {
    this.on = true; this.net = net; this.isHost = isHost; this.localSlot = localSlot;
    this.bySlot = {}; for (const p of this.game.players) this.bySlot[p.slot] = p;
    this.remote = {}; this._latest = null; this._snapAcc = 0;
    net.on('input', m => { if (this.isHost) this.remote[m.slot] = m.input; });
    net.on('snap', m => { if (!this.isHost) this._latest = m.s; });
  }

  end() { this.on = false; }

  queueAction(name) { this.localActions.push(name); }

  // ---------------- HOST ----------------
  applyLocalAndRemote() {
    const g = this.game, A = g.actions;
    // local human (players[0]) — actions drained from the queue
    const me = g.players[0];
    if (me && me.alive) for (const a of this.localActions) A[a] && A[a](me);
    this.localActions.length = 0;
    // remote clients → their slot's player
    for (const p of g.players) {
      if (p.control !== 'remote') continue;
      const inp = this.remote[p.slot];
      if (!inp) { p.moveMag = 0; continue; }
      p.moveDir.set(inp.mx || 0, inp.mz || 0); p.moveMag = inp.mag || 0;
      if (inp.a) for (const a of inp.a) A[a] && A[a](p);
      inp.a = null;   // consume edge actions once
    }
  }

  maybeSnapshot(dt) {
    this._snapAcc += dt;
    if (this._snapAcc < this.snapDt) return;
    this._snapAcc = 0;
    const g = this.game, m = g.match;
    const p = g.players.map(pl => {
      const t = pl.body.translation();
      let f = 0;
      if (pl.alive) f |= 1; if (pl.knockdown > 0) f |= 2; if (pl.celebrating) f |= 4; if (!pl.group.visible) f |= 8;
      return [pl.slot, +t.x.toFixed(2), +t.y.toFixed(2), +t.z.toFixed(2), +pl.facing.toFixed(2), f, pl.score];
    });
    const h = [phaseCode(g.state), m.roundNum, m.roundActive ? 1 : 0, +g.safeRadius.toFixed(1), g.champion ? g.champion.slot : -1];
    this.net.snapshot({ h, p });
  }

  // ---------------- CLIENT ----------------
  sendInput() {
    const g = this.game, me = g.players[0];
    let mx = 0, mz = 0, mag = 0;
    if (me && me.alive && !me.grabbedBy) {
      const mv = g.input.humanMove();
      if (mv) { mx = +mv.x.toFixed(3); mz = +mv.z.toFixed(3); mag = mv.mag; }
    }
    const a = this.localActions.length ? this.localActions.slice() : null;
    this.localActions.length = 0;
    this.net.input({ mx, mz, mag, a });
  }

  applySnapshot(dt) {
    const s = this._latest, g = this.game;
    if (!s) return;
    const [phase, round, active, safeR, champSlot] = s.h;
    g.state = phaseName(phase);
    g.match.roundNum = round; g.match.roundActive = !!active; g.safeRadius = safeR;
    g.champion = champSlot >= 0 ? (this.bySlot[champSlot] || null) : null;
    const k = Math.min(1, dt * 16);   // smoothing toward the latest snapshot
    for (const row of s.p) {
      const [slot, x, y, z, fac, f, score] = row;
      const pl = this.bySlot[slot]; if (!pl) continue;
      pl.score = score;
      pl.alive = !!(f & 1); pl.knockdown = (f & 2) ? 1 : 0; pl.celebrating = !!(f & 4);
      pl.group.visible = !(f & 8);
      const c = pl.body.translation();
      pl.body.setTranslation({ x: c.x + (x - c.x) * k, y: c.y + (y - c.y) * k, z: c.z + (z - c.z) * k }, true);
      let df = fac - pl.facing; while (df > Math.PI) df -= 6.283; while (df < -Math.PI) df += 6.283;
      pl.facing += df * k;
    }
  }
}
