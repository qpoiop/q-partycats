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

  /** Punch (주먹치기) — the main attack: a quick forward jab that staggers. */
  punch(p) {
    if (p.grabbedBy || p.knockdown > 0 || !p.alive) return;
    if (p.grabbing) { this.throw(p); return; }
    if (p.punchCd > 0) return;
    p.punchCd = ABIL.punchCd; p.punching = ABIL.punchTime;   // drives the jab pose
    const dir = p.faceVec(), me = p.pos();
    let hit = false;
    for (const o of this.game.players) {
      if (o === p || !o.alive || o.invuln > 0 || o.grabbedBy) continue;
      const op = o.pos();
      const dx = op.x - me.x, dz = op.z - me.z, d = Math.hypot(dx, dz);
      if (d < ABIL.punchReach && d > 1e-3 && (dx * dir.x + dz * dir.z) / d > ABIL.punchArc) {
        const nx = dx / d, nz = dz / d, om = o.mass();
        o.hit(nx * ABIL.punchKnock * om, ABIL.punchLift * om, nz * ABIL.punchKnock * om,
          { tumble: 0.9, axis: new THREE.Vector3(nz, 0.2, -nx) });
        this.game.fx.dust(op, 0xffffff, 12, 0.9); hit = true;
      }
    }
    this.game.fx.shake(hit ? 0.5 : 0.15); if (hit) this.game.fx.flash(0.15);
  }

  /** Slide (슬라이딩) = grab pressed in mid-air → a low tackle lunge. */
  slide(p) {
    if (p.dashTimer > 0) return;
    let dir;
    if (p.moveMag > 0.12) { dir = new THREE.Vector3(p.moveDir.x, 0, p.moveDir.y).normalize(); p.facing = Math.atan2(dir.x, dir.z); p.faceTarget = p.facing; }
    else dir = p.faceVec();
    // slam down onto the ground so it reads as a low slide, not a hop
    p.body.setLinvel(V(dir.x * ABIL.slideVel, -9, dir.z * ABIL.slideVel), true);
    p.dashTimer = ABIL.slideTime; p.dashAir = false; p.invuln = 0.3; p.sliding = ABIL.slideTime;
    p.knockTimer = Math.max(p.knockTimer, ABIL.slideTime);
    this.game.fx.streak(p, dir); this.game.fx.dust(p.pos(), p.hex, 10, 0.7);
  }

  grab(p) {
    if (p.grabbedBy || p.knockdown > 0 || !p.alive) return;
    if (p.grabbing) { this.throw(p); return; }
    if (!p.onGround) { this.slide(p); return; }   // jump+grab → slide tackle
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
