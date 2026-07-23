import * as THREE from 'three';
import { CAMERA, ARENA } from '../config.js';

/* ============================================================
   CameraRig — orbit camera that frames the whole arena.

   Distance is DERIVED (framingDistance) so the arena always fits at
   any aspect ratio — no hardcoded distances. It follows the centroid
   of the living cats (so everyone stays in frame and no one spawns
   shoved to the edge), and locks onto the local player's plunge into
   the sea. Reuses scratch vectors — no per-frame allocation.
   ============================================================ */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.az = Math.PI * 0.18;
    this.dist = 24;
    this.el = CAMERA.menuElevation;
    this.target = new THREE.Vector3(0, 1, 0);
    this.menuClock = 0;
    this._f = new THREE.Vector3();
    this._r = new THREE.Vector3();
    this._userDist = 0;   // wheel-zoom offset applied on top of framing
  }

  rotate(dx) { this.az -= dx * 0.006; }
  zoom(dy) { this._userDist = THREE.MathUtils.clamp(this._userDist + dy * 0.02, -8, 24); }

  /** Camera-relative forward/right on the ground plane (reused vectors). */
  forwardRight() {
    const f = this._f; this.camera.getWorldDirection(f); f.y = 0; f.normalize();
    this._r.set(f.z, 0, -f.x);
    return { f, r: this._r };
  }

  /** Distance so a sphere of `radius` fits the (tighter of v/h) FOV. */
  framingDistance(radius) {
    const cam = this.camera;
    const vFov = THREE.MathUtils.degToRad(cam.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * cam.aspect);
    return radius / Math.sin(Math.min(vFov, hFov) / 2);
  }

  update(dt, game) {
    const menu = game.state === 'home' || game.state === 'lobby' || game.state === 'results';
    const watching = game.state === 'playing' || game.state === 'countdown';
    const h = game.players[0];
    const falling = watching && h && (h.falling || (!h.alive && h.group.visible)) && h.pos().y < ARENA.doomY;

    if (menu) { this.menuClock += dt; this.az += dt * CAMERA.menuSpin; }
    const wantEl = menu ? CAMERA.menuElevation : (falling ? CAMERA.fallElevation : CAMERA.playElevation);
    this.el += (wantEl - this.el) * Math.min(1, dt * 2.5);

    // ---- framing target ----
    let fx = 0, fz = 0, fy = 1;
    if (falling) {
      const hp = h.pos(); fx = hp.x; fz = hp.z; fy = hp.y + 2.5;   // lock onto the plunge
    } else if (watching) {
      // centroid of the living cats, clamped near centre
      let n = 0, sx = 0, sz = 0;
      for (const p of game.players) { if (p.alive) { const q = p.pos(); sx += q.x; sz += q.z; n++; } }
      if (n) { fx = sx / n; fz = sz / n; }
      const fl = Math.hypot(fx, fz);
      if (fl > CAMERA.followClamp) { fx = fx / fl * CAMERA.followClamp; fz = fz / fl * CAMERA.followClamp; }
    }
    const lerp = Math.min(1, dt * CAMERA.followLerp);
    this.target.x += (fx - this.target.x) * lerp;
    this.target.z += (fz - this.target.z) * lerp;
    this.target.y += (fy - this.target.y) * Math.min(1, dt * (falling ? 4 : 2.5));

    // ---- derived distance ----
    const margin = menu ? CAMERA.framingMargin.menu : CAMERA.framingMargin.play;
    let wantDist = this.framingDistance(ARENA.radius * margin) + this._userDist;
    if (falling) wantDist *= 1.3;
    wantDist = THREE.MathUtils.clamp(wantDist, CAMERA.minDist, CAMERA.maxDist);
    this.dist += (wantDist - this.dist) * Math.min(1, dt * 2);

    const horiz = this.dist * Math.cos(this.el), cy = this.target.y + this.dist * Math.sin(this.el);
    const cam = this.camera;
    cam.position.set(this.target.x + horiz * Math.sin(this.az), cy, this.target.z + horiz * Math.cos(this.az));
    cam.lookAt(this.target.x, this.target.y, this.target.z);

    const s = game.fx.shakeAmt;
    if (s > 0) {
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
    }
  }
}
