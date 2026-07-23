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
    if (p.knockdown > 0) { p.moveMag = 0; return; }   // downed → wait to get up
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
    // steer via the movement controller (respects contacts) → no jitter when
    // cats bump; low moveMag = a slow amble
    p.moveDir.set(gx, gz); p.moveMag = 0.28;
    p.faceTarget = Math.atan2(gx, gz);
  }

  _combat(p, dt) {
    p.botTimer -= dt;
    const A = this.game.actions;
    const R = ARENA.radius;
    const me = p.pos(), myD = Math.hypot(me.x, me.z);
    let tgt = null, td = 1e9;
    for (const o of this.game.players) {
      if (o === p || !o.alive) continue;
      const op = o.pos(), d = Math.hypot(op.x - me.x, op.z - me.z);
      if (d < td) { td = d; tgt = o; }
    }
    const nearEdge = myD > R - 2.2;

    // carrying a victim → drag them to the rim, then hurl them off (a reliable
    // ring-out: throwing from the centre just drops them back inside)
    if (p.grabbing && p.grabbing.alive) {
      const outD = Math.max(0.5, myD), ox = me.x / outD, oz = me.z / outD;
      if (myD > R - 3.2 || p.grip < 0.28) {
        p.facing = Math.atan2(ox, oz); p.faceTarget = p.facing; p.moveMag = 0;
        A.throw(p); return;
      }
      p.moveDir.set(ox, oz); p.moveMag = 0.7; p.faceTarget = Math.atan2(ox, oz);
      return;
    }

    // mid-combo: complete a flying kick (jump→dash) once airborne
    if (p._fk > 0 && !nearEdge) {
      p._fk -= dt;
      if (!p.onGround && p.dashCd <= 0 && tgt) {
        const tp = tgt.pos(); p.facing = Math.atan2(tp.x - me.x, tp.z - me.z); p.faceTarget = p.facing;
        A.dash(p); p._fk = 0;
      } else if (p._fk <= 0) p._fk = 0;
    }

    let gx, gz;
    if (nearEdge) { gx = -me.x; gz = -me.z; }              // recover from the edge
    else if (tgt) {
      // hunt, but flank to the CENTRE side of the target so a hit shoves them
      // outward toward the rim (this is what actually produces ring-outs)
      const tp = tgt.pos(), tpD = Math.hypot(tp.x, tp.z);
      if (tpD > 3.5) { const ox = tp.x / tpD, oz = tp.z / tpD; gx = (tp.x - ox * 1.4) - me.x; gz = (tp.z - oz * 1.4) - me.z; }
      else { gx = tp.x - me.x; gz = tp.z - me.z; }
    } else { gx = Math.cos(p.wanderA); gz = Math.sin(p.wanderA); p.wanderA += (Math.random() - 0.5) * 0.4; }
    const gl = Math.hypot(gx, gz) || 1;
    p.moveDir.set(gx / gl, gz / gl);
    p.moveMag = nearEdge ? 0.95 : 0.72;                     // committed pursuit, weaker than a full player
    p.faceTarget = Math.atan2(gx, gz);

    if (p.botTimer <= 0 && tgt && !nearEdge) {
      p.botTimer = 0.65 + Math.random() * 0.6;              // act more often = more aggressive
      const tp = tgt.pos(), tgtD = Math.hypot(tp.x, tp.z);
      const dirx = (tp.x - me.x) / td, dirz = (tp.z - me.z) / td;
      p.facing = Math.atan2(dirx, dirz);                    // aim at the target
      // will this hit shove the target outward (toward the rim)? if so, commit
      const outward = (dirx * tp.x + dirz * tp.z) > 0;      // pushing them away from centre
      const finisher = tgtD > R * 0.5 && outward;
      if (td < ABIL.punchReach + 0.3 && p.punchCd <= 0 && Math.random() < 0.82) A.punch(p);   // jab up close
      else if (td < 1.7 && p.grabCd <= 0 && Math.random() < 0.4) A.grab(p);                     // or grab
      else if (td < 5 && p.dashCd <= 0 && (finisher || Math.random() < 0.5)) A.dash(p);         // dash-shove / finish
      // flying kick from mid range — only if the lunge lands me back inside (no self-ring-out)
      else if (td > 2.5 && td < 6.5 && p.dashCd <= 0 && p.onGround && Math.random() < 0.3) {
        const landD = Math.hypot(me.x + dirx * 5.4, me.z + dirz * 5.4);
        if (landD < R - 1.5) { A.jump(p); p._fk = 0.25; }
      }
    }
  }
}
