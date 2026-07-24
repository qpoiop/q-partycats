import * as THREE from 'three';
import { Cat } from '../entities/Cat.js';

/* ============================================================
   LobbyView — live, animated character-select cats. Renders on a
   dedicated transparent overlay canvas (so the glass panel doesn't
   blur it), scissoring one idle-animating cat into each card's
   portrait rect. One cat per team colour; a gentle turn + the
   Sitting/Walking idle clip give it life.
   ============================================================ */
export class LobbyView {
  constructor(canvas, proto, teams) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.15));
    const d = new THREE.DirectionalLight(0xffffff, 2.1); d.position.set(2, 3, 3); this.scene.add(d);

    this.cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.cam.position.set(3.6, 2.35, 5.3); this.cam.lookAt(0, 1.45, 0);

    this.cats = teams.map(t => {
      const c = new Cat(proto, t.hex);
      c.model.scale.multiplyScalar(0.8);   // smaller in the select card (was filling it)
      c.model.visible = false;
      this.scene.add(c.model);
      if (c.walk) { c.walk.play(); c.walk.setEffectiveWeight(0.22); c.walk.timeScale = 0.55; }
      if (c.sit) { c.sit.play(); c.sit.setEffectiveWeight(0.65); }
      return c;
    });
    this._clock = new THREE.Clock();
  }

  /** cards: [{ el: portraitElement, colorIndex }] for the visible slots. */
  render(cards) {
    if (!cards || !cards.length) return;
    const dt = Math.min(0.05, this._clock.getDelta());
    const r = this.renderer;
    const w = innerWidth, h = innerHeight;
    if (r.domElement.clientWidth !== w || r.domElement.clientHeight !== h) r.setSize(w, h, true);
    // lively idle: each cat periodically pops up on its hind legs and waves its
    // paws + a little hop (offset per colour so they're not in lockstep).
    const now = performance.now() * 0.001;
    this.cats.forEach((c, i) => {
      const ph = i * 1.7;
      const cyc = ((now * 0.5 + ph) % 3);              // 3s cycle
      const wave = cyc < 1.1 ? Math.sin((cyc / 1.1) * Math.PI) : 0;   // wave ~1.1s of each cycle
      c.updateAnimation(dt, { speed: 0.2, onGround: true, cheer: wave });
      c.model.position.y = Math.abs(Math.sin(now * 3.2 + ph)) * 0.1 * (0.35 + wave);
    });

    r.clear();
    r.setScissorTest(true);
    const tt = performance.now() * 0.001;
    for (const card of cards) {
      const rect = card.el.getBoundingClientRect();
      if (rect.width < 6 || rect.height < 6) continue;
      const x = rect.left, y = h - rect.bottom, vw = rect.width, vh = rect.height;
      this.cam.aspect = vw / vh; this.cam.updateProjectionMatrix();
      for (const c of this.cats) c.model.visible = false;
      const cat = this.cats[card.colorIndex] || this.cats[0];
      cat.model.visible = true;
      cat.model.rotation.y = 0.4 + Math.sin(tt * 0.6 + card.colorIndex) * 0.3;   // gentle idle turn
      r.setViewport(x, y, vw, vh);
      r.setScissor(x, y, vw, vh);
      r.render(this.scene, this.cam);
    }
    r.setScissorTest(false);
    for (const c of this.cats) c.model.visible = false;
  }
}
