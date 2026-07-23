import * as THREE from 'three';

/* ============================================================
   Input — unifies desktop (keyboard + mouse drag) and mobile
   (virtual stick + action pads) into a single intent the game
   reads each frame via `humanMove()`. Ability presses are routed
   straight to Actions on the local player.
   ============================================================ */
export class Input {
  constructor(game) {
    this.game = game;
    this.keys = {};
    this.joyVec = null;
    this._bindKeyboard();
    this._bindStick();
    this._bindCameraDrag();
    this._bindActionButtons();
  }

  _local() { const p = this.game.players[0]; return (this.game.state === 'playing' && p && p.alive) ? p : null; }

  _bindKeyboard() {
    addEventListener('keydown', e => {
      if (this.game.state !== 'playing') return;
      const k = e.key.toLowerCase(); this.keys[k] = true;
      const p = this._local(); if (!p) return;
      const a = this.game.actions;
      if (k === ' ') { e.preventDefault(); a.jump(p); }
      if (k === 'shift') a.dash(p);
      if (k === 'q') a.slam(p);
      if (k === 'e') a.grab(p);
    });
    addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });
  }

  humanKeyMove() {
    const { f, r } = this.game.cameraRig.forwardRight();
    const k = this.keys;
    const fw = (k['w'] || k['arrowup'] ? 1 : 0) - (k['s'] || k['arrowdown'] ? 1 : 0);
    const sd = (k['d'] || k['arrowright'] ? 1 : 0) - (k['a'] || k['arrowleft'] ? 1 : 0);
    if (fw || sd) {
      const v = new THREE.Vector3().addScaledVector(f, fw).addScaledVector(r, sd).normalize();
      return { x: v.x, z: v.z, mag: 1 };
    }
    return null;
  }

  /** Current human movement intent (stick beats keyboard). */
  humanMove() { return this.joyVec || this.humanKeyMove(); }

  _bindStick() {
    const zone = document.querySelector('#stickZone');
    const stick = document.querySelector('#stick');
    const knob = stick.querySelector('.knob');
    let id = null, origin = null;
    zone.addEventListener('pointerdown', e => {
      id = e.pointerId; origin = { x: e.clientX, y: e.clientY };
      stick.style.display = 'block';
      stick.style.left = (e.clientX - 66) + 'px'; stick.style.top = (e.clientY - 66) + 'px';
      knob.style.transform = 'translate(0,0)'; zone.setPointerCapture(e.pointerId);
    });
    zone.addEventListener('pointermove', e => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - origin.x, dy = e.clientY - origin.y;
      const max = 55, d = Math.hypot(dx, dy);
      if (d > max) { dx = dx / d * max; dy = dy / d * max; }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      const { f, r } = this.game.cameraRig.forwardRight();
      const mag = Math.min(1, d / max);
      const v = new THREE.Vector3().addScaledVector(f, -dy / max).addScaledVector(r, dx / max);
      if (v.lengthSq() > 0) { v.normalize(); this.joyVec = { x: v.x, z: v.z, mag }; }
    });
    const end = e => { if (e.pointerId !== id) return; id = null; this.joyVec = null; stick.style.display = 'none'; };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  _bindCameraDrag() {
    const canvas = this.game.engine.canvas;
    let dragId = null, dragX = 0;
    canvas.addEventListener('pointerdown', e => { if (e.clientX > innerWidth * 0.5) { dragId = e.pointerId; dragX = e.clientX; } });
    canvas.addEventListener('pointermove', e => { if (e.pointerId !== dragId) return; this.game.cameraRig.rotate(e.clientX - dragX); dragX = e.clientX; });
    canvas.addEventListener('pointerup', e => { if (e.pointerId === dragId) dragId = null; });
    canvas.addEventListener('wheel', e => this.game.cameraRig.zoom(e.deltaY), { passive: true });
  }

  _bindActionButtons() {
    document.querySelectorAll('.abtn').forEach(b => {
      const act = b.dataset.act;
      b.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        const p = this._local(); if (!p) return;
        const a = this.game.actions;
        if (act === 'jump') a.jump(p);
        if (act === 'dash') a.dash(p);
        if (act === 'slam') a.slam(p);
        if (act === 'grab') a.grab(p);
      });
    });
  }
}
