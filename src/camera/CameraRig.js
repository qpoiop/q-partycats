import * as THREE from 'three';
import { CAMERA } from '../config.js';

/* ============================================================
   CameraRig — orbit camera that gently spins in menus and follows
   the human player in combat. Distances/elevations come from
   config so the "how far back" feel is tunable alongside fog.
   ============================================================ */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.az = Math.PI * 0.18;
    this.dist = 22;
    this.el = CAMERA.menuElevation;
    this.target = new THREE.Vector3(0, 1, 0);
    this.menuClock = 0;
    this._f = new THREE.Vector3();
  }

  rotate(dx) { this.az -= dx * 0.006; }
  zoom(dy) { this.dist = THREE.MathUtils.clamp(this.dist + dy * 0.02, CAMERA.minDist, CAMERA.maxDist); }

  /** Camera-relative forward/right on the ground plane (for input). */
  forwardRight() {
    const f = this._f; this.camera.getWorldDirection(f); f.y = 0; f.normalize();
    return { f: f.clone(), r: new THREE.Vector3(f.z, 0, -f.x) };
  }

  update(dt, game) {
    const menu = game.state === 'home' || game.state === 'lobby' || game.state === 'results';
    if (menu) { this.menuClock += dt; this.az += dt * CAMERA.menuSpin; this.el += (CAMERA.menuElevation - this.el) * Math.min(1, dt * 2); }
    else this.el += (CAMERA.playElevation - this.el) * Math.min(1, dt * 2);

    // follow the human player during play
    let fx = 0, fz = 0;
    if (game.state === 'playing' || game.state === 'countdown') {
      const h = game.players[0];
      if (h && h.alive) { const hp = h.pos(); fx = hp.x * CAMERA.followFactor; fz = hp.z * CAMERA.followFactor; }
    }
    const fl = Math.hypot(fx, fz);
    if (fl > CAMERA.followClamp) { fx = fx / fl * CAMERA.followClamp; fz = fz / fl * CAMERA.followClamp; }
    this.target.x += (fx - this.target.x) * Math.min(1, dt * CAMERA.followLerp);
    this.target.z += (fz - this.target.z) * Math.min(1, dt * CAMERA.followLerp);

    const portrait = innerHeight > innerWidth;
    const set = menu ? CAMERA.menuDist : CAMERA.playDist;
    const wantDist = portrait ? set.portrait : set.landscape;
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
