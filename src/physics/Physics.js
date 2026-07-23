import RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS, ARENA, BODY } from '../config.js';

/* ============================================================
   Physics — Rapier world wrapper. Owns the fixed-step world,
   the arena collider, and shared helpers (body factory, ground
   raycast). Systems talk to Rapier only through here.
   ============================================================ */
export class Physics {
  static async init() {
    await RAPIER.init();
    return new Physics();
  }

  constructor() {
    this.RAPIER = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: PHYSICS.gravity, z: 0 });
    this.world.timestep = PHYSICS.timestep;
    this._ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this._acc = 0;
    this._buildArena();
  }

  _buildArena() {
    const w = this.world;
    const pb = w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.6, 0));
    w.createCollider(
      RAPIER.ColliderDesc.cylinder(0.6, ARENA.radius)
        .setFriction(PHYSICS.platformFriction)
        .setRestitution(PHYSICS.platformRestitution),
      pb,
    );
  }

  /** Create a locked-upright dynamic capsule for a character. */
  createCharacterBody(x, y, z) {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .lockRotations()
      .setLinearDamping(BODY.linearDamping)
      .setCcdEnabled(true);
    const body = this.world.createRigidBody(desc);
    this.world.createCollider(
      RAPIER.ColliderDesc.capsule(BODY.capHalfHeight, BODY.capRadius)
        .setFriction(PHYSICS.bodyFriction)
        .setRestitution(PHYSICS.bodyRestitution)
        .setDensity(BODY.density),
      body,
    );
    return body;
  }

  removeBody(body) { this.world.removeRigidBody(body); }

  /** True if there is ground within `dist` below the body's centre. */
  grounded(body, dist) {
    const t = body.translation();
    this._ray.origin.x = t.x; this._ray.origin.y = t.y; this._ray.origin.z = t.z;
    const hit = this.world.castRay(this._ray, dist, true, undefined, undefined, undefined, body);
    return !!hit;
  }

  /** Accumulate real dt and advance the world in fixed substeps. */
  step(dt) {
    this._acc += dt;
    let n = 0;
    while (this._acc >= this.world.timestep && n < PHYSICS.maxSubsteps) {
      this.world.step();
      this._acc -= this.world.timestep;
      n++;
    }
  }
}
