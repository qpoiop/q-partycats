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
    const watching = game.state === 'playing' || game.state === 'countdown';
    const h = game.players[0];
    const falling = watching && h && h.falling && h.pos().y < -2;

    if (menu) { this.menuClock += dt; this.az += dt * CAMERA.menuSpin; }
    const wantEl = menu ? CAMERA.menuElevation : (falling ? CAMERA.fallElevation : CAMERA.playElevation);
    this.el += (wantEl - this.el) * Math.min(1, dt * 2.5);

    // follow target (x/z drift + vertical descent while plunging)
    let fx = 0, fz = 0, fy = 1;
    if (watching && h && (h.alive || h.falling)) {
      const hp = h.pos();
      if (falling) { fx = hp.x; fz = hp.z; fy = hp.y + 2.5; }        // lock onto the falling cat
      else {
        fx = hp.x * CAMERA.followFactor; fz = hp.z * CAMERA.followFactor;
        const fl = Math.hypot(fx, fz);
        if (fl > CAMERA.followClamp) { fx = fx / fl * CAMERA.followClamp; fz = fz / fl * CAMERA.followClamp; }
      }
    }
    const lerp = Math.min(1, dt * CAMERA.followLerp);
    this.target.x += (fx - this.target.x) * lerp;
    this.target.z += (fz - this.target.z) * lerp;
    this.target.y += (fy - this.target.y) * Math.min(1, dt * (falling ? 4 : 2.5));

    const portrait = innerHeight > innerWidth;
    const set = menu ? CAMERA.menuDist : CAMERA.playDist;
    let wantDist = portrait ? set.portrait : set.landscape;
    if (falling) wantDist *= 1.25;   // pull back a touch to frame the drop
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
