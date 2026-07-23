import * as THREE from 'three';
import { ABIL, MOVE, GRAB } from '../config.js';

const V = (x, y, z) => ({ x, y, z });

/* ============================================================
   Actions — all player abilities in one place. Pure operations
   on a Player; expressed as target velocities (from config) so
   they read intuitively and tune predictably. New abilities are
   added here and bound in Input/Bot.
   ============================================================ */
export class Actions {
  constructor(game) {
    this.game = game;
    this.RBType = game.physics.RAPIER.RigidBodyType;
  }

  jump(p) {
    if (p.grabbedBy || p.knockdown > 0 || !p.alive || !p.onGround) return;
    const v = p.vel();
    p.body.setLinvel(V(v.x, ABIL.jumpVel, v.z), true);
    p.onGround = false; p.squash = ABIL.jumpSquash;
    this.game.fx.dust(p.pos(), p.hex, 10, 0.5);
  }

  dash(p) {
    if (p.grabbedBy || p.knockdown > 0 || !p.alive) return;
    if (p.grabbing) { this.throw(p); return; }
    if (p.dashCd > 0) return;
    p.dashCd = ABIL.dashCd;

    let dir;
    if (p.moveMag > 0.12) {
      dir = new THREE.Vector3(p.moveDir.x, 0, p.moveDir.y).normalize();
      p.facing = Math.atan2(dir.x, dir.z); p.faceTarget = p.facing;
    } else dir = p.faceVec();

    const v = p.vel();
    if (p.onGround) {
      p.body.setLinvel(V(dir.x * ABIL.dashVel, v.y, dir.z * ABIL.dashVel), true);
      p.invuln = ABIL.dashInvuln; p.dashTimer = ABIL.dashTime; p.dashAir = false;
    } else {
      p.body.setLinvel(V(dir.x * ABIL.dashAirVel, ABIL.dashAirLift, dir.z * ABIL.dashAirVel), true);
      p.dashTimer = ABIL.dashTime + 0.02; p.dashAir = true;
    }
    // dash overrides current momentum → treat as self-knock window so
    // the steering controller doesn't fight the burst.
    p.knockTimer = Math.max(p.knockTimer, ABIL.dashTime);
    this.game.fx.dust(p.pos(), p.hex, 12, 0.6);
    this.game.fx.streak(p, dir);
  }

  slam(p) {
    if (p.grabbedBy || p.knockdown > 0 || p.grabbing || !p.alive) return;
    if (!p.onGround && !p.slamming) {
      p.slamming = true;
      const v = p.vel();
      p.body.setLinvel(V(v.x * 0.3, -ABIL.slamDownVel, v.z * 0.3), true);
    }
  }

  slamHit(p) {
    const pos = p.pos();
    this.game.fx.ring(pos, p.hex);
    this.game.fx.dust(pos, 0xffffff, 30, 1.6);
    this.game.fx.shake(1.0); this.game.fx.flash(0.28);
    for (const o of this.game.players) {
      if (o === p || !o.alive || o.invuln > 0) continue;
      const op = o.pos();
      const dx = op.x - pos.x, dz = op.z - pos.z, d = Math.hypot(dx, dz);
      if (d < ABIL.slamRadius) {
        const nx = dx / (d || 1), nz = dz / (d || 1);
        const pw = (1 - d / ABIL.slamRadius) * ABIL.slamKnockScale + ABIL.slamKnockBase;
        const om = o.mass();
        if (o.grabbedBy) this.releaseGrab(o.grabbedBy);
        o.hit(nx * pw * om, ABIL.slamKnockLift * om, nz * pw * om,
          { tumble: 1, axis: new THREE.Vector3(nz, 0.2, -nx) });
      }
    }
  }

  grab(p) {
    if (p.grabbedBy || p.knockdown > 0 || !p.alive) return;
    if (p.grabbing) { this.throw(p); return; }
    if (p.grabCd > 0) return;
    const dir = p.faceVec(), me = p.pos();
    let best = null, bd = GRAB.radius;
    for (const o of this.game.players) {
      if (o === p || !o.alive || o.invuln > 0 || o.grabbedBy) continue;
      const op = o.pos();
      const dx = op.x - me.x, dz = op.z - me.z, d = Math.hypot(dx, dz);
      if (d < bd) {
        const dot = (dx * dir.x + dz * dir.z) / (d || 1);
        if (dot > -0.15) { best = o; bd = d; }
      }
    }
    if (best) {
      // victim stays a DYNAMIC body — held by a spring (Player._carriedTick),
      // so it still collides with terrain and other cats (Party-Animals feel).
      p.grabbing = best; best.grabbedBy = p; p.grip = GRAB.gripMax; best.struggle = 0;
      this.game.fx.dust(best.pos(), best.hex, 8, 0.6);
    } else p.grabCd = 0.4;
  }

  throw(p) {
    const t = p.grabbing; if (!t) return;
    const dir = p.faceVec();
    t.body.setLinvel(V(dir.x * ABIL.throwVel, ABIL.throwLift, dir.z * ABIL.throwVel), true);
    t.knockTimer = MOVE.knockWindow;
    t.grabbedBy = null; p.grabbing = null; p.grabCd = GRAB.cd; p.grip = 0;
    t.tumble = 1; t.tumbleAxis.set(Math.random() - 0.5, 0.2, Math.random() - 0.5).normalize();
    this.game.fx.dust(t.pos(), t.hex, 16, 1); this.game.fx.shake(0.55); this.game.fx.flash(0.18);
  }

  /** Victim wins the tug-of-war: pops free and kicks the grabber back. */
  breakFree(grabber) {
    const t = grabber.grabbing; if (!t) return;
    const gp = grabber.pos(), tp = t.pos();
    let dx = tp.x - gp.x, dz = tp.z - gp.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    const tm = t.mass(), gm = grabber.mass();
    t.grabbedBy = null; grabber.grabbing = null;
    t.hit(dx * GRAB.victimPopVel * tm, 3.2 * tm, dz * GRAB.victimPopVel * tm, {});      // victim pops free
    grabber.hit(-dx * GRAB.breakKick * gm, 1.5 * gm, -dz * GRAB.breakKick * gm, {});    // grabber kicked back
    grabber.grabCd = GRAB.breakStun; t.grabCd = GRAB.cd; t.struggle = 0; grabber.grip = 0;
    this.game.fx.dust(tp, t.hex, 14, 1.1); this.game.fx.shake(0.4); this.game.fx.flash(0.12);
  }

  /** Silent release (elimination / attract respawn) — no kick. */
  releaseGrab(p) {
    const t = p.grabbing; if (!t) return;
    t.grabbedBy = null; p.grabbing = null; p.grabCd = GRAB.cd; p.grip = 0;
  }
}
