import { ARENA, ABIL, GRAB } from '../config.js';

const V = (x, y, z) => ({ x, y, z });

/* ============================================================
   Bot — lightweight AI. Two personalities by game state:
   - menu/lobby/results: lively but non-violent ambient wander.
   - playing: seek the nearest rival, shove them outward, and
     scramble back from the edge.
   ============================================================ */
export class Bot {
  constructor(game) { this.game = game; }

  update(p, dt) {
    if (!p.alive) { p.moveMag = 0; return; }
    if (p.grabbedBy) { this._struggle(p, dt); return; }
    const st = this.game.state;
    if (st === 'home' || st === 'lobby' || st === 'results') return this._ambient(p, dt);
    this._combat(p, dt);
  }

  /* Grabbed: mash to build the escape meter, occasionally dash-burst free. */
  _struggle(p, dt) {
    p.moveMag = 0;
    p.addStruggle(GRAB.struggleGainMash * dt * 9);
    p._botKick = (p._botKick || 0) - dt;
    if (p._botKick <= 0) {
      p._botKick = 0.5 + Math.random() * 0.8;
      if (p.dashCd <= 0 && Math.random() < 0.4) { p.addStruggle(GRAB.struggleGainDash); p.dashCd = ABIL.dashCd * 0.5; }
    }
  }

  _ambient(p, dt) {
    const me = p.pos(), myD = Math.hypot(me.x, me.z);
    p.botTimer -= dt;
    if (p.botTimer <= 0) {
      p.botTimer = 3.5 + Math.random() * 4.0;
      if (Math.random() < 0.18 && p.onGround) this.game.actions.jump(p);
      else p.wanderA = Math.random() * 6.28;
    }
    p.wanderA += (Math.random() - 0.5) * 0.04;
    let gx = Math.cos(p.wanderA), gz = Math.sin(p.wanderA);
    if (myD > ARENA.radius * 0.5) { gx = -me.x; gz = -me.z; p.wanderA = Math.atan2(gz, gx); }
    const gl = Math.hypot(gx, gz) || 1; gx /= gl; gz /= gl;
    const v = p.vel();
    p.body.setLinvel(V(gx * 1.6, v.y, gz * 1.6), true);
    p.moveDir.set(gx, gz); p.moveMag = 1;
    p.faceTarget = Math.atan2(gx, gz);
  }

  _combat(p, dt) {
    p.botTimer -= dt;
    const me = p.pos(), myD = Math.hypot(me.x, me.z);
    let tgt = null, td = 1e9;
    for (const o of this.game.players) {
      if (o === p || !o.alive) continue;
      const op = o.pos(), d = Math.hypot(op.x - me.x, op.z - me.z);
      if (d < td) { td = d; tgt = o; }
    }
    let gx = 0, gz = 0;
    const nearEdge = myD > ARENA.radius - 2.4;
    if (nearEdge) { gx = -me.x; gz = -me.z; }
    else if (tgt) { const tp = tgt.pos(); gx = tp.x - me.x; gz = tp.z - me.z; }
    const gl = Math.hypot(gx, gz) || 1;
    p.wanderA += (Math.random() - 0.5) * 0.35;
    p.moveDir.set(gx / gl + Math.cos(p.wanderA) * 0.18, gz / gl + Math.sin(p.wanderA) * 0.18).normalize();
    p.moveMag = nearEdge ? 0.9 : 0.72;

    if (p.botTimer <= 0 && tgt) {
      p.botTimer = 1.6 + Math.random() * 1.6;
      const tp = tgt.pos(), tgtD = Math.hypot(tp.x, tp.z);
      if (td < 2.1 && tgtD > myD + 1.1 && !nearEdge) {
        if (td < 1.4 && p.grabCd <= 0 && Math.random() < 0.22) this.game.actions.grab(p);
        else if (p.dashCd <= 0 && Math.random() < 0.5) { p.facing = Math.atan2(gx, gz); p.faceTarget = p.facing; this.game.actions.dash(p); }
      } else if (td < 3.0 && p.onGround && Math.random() < 0.08) this.game.actions.jump(p);
      else if (!p.onGround && !p.slamming && td < ABIL.slamRadius && Math.random() < 0.22) this.game.actions.slam(p);
      if (p.grabbing) { const a = Math.atan2(me.x, me.z); p.facing = a; p.faceTarget = a; this.game.actions.throw(p); }
    }
  }
}
