import * as THREE from 'three';

/* Thin requestAnimationFrame driver with clamped delta time.
   The physics fixed-step accumulation lives in Game.tick(); this
   just guarantees a sane dt and a crash-safe frame boundary. */
export class GameLoop {
  constructor(tick) {
    this.tick = tick;
    this.clock = new THREE.Clock();
    this.running = false;
    this._frame = this._frame.bind(this);
  }
  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    requestAnimationFrame(this._frame);
  }
  stop() { this.running = false; }
  _frame() {
    if (!this.running) return;
    requestAnimationFrame(this._frame);
    const dt = Math.min(0.033, this.clock.getDelta());
    try { this.tick(dt); }
    catch (e) { console.error('[loop]', e); }
  }
}
