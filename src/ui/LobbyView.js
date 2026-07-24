import * as THREE from 'three';
import { Cat } from '../entities/Cat.js';

/* ============================================================
   LobbyView — live, animated character-select previews. Renders on a
   dedicated transparent overlay canvas (so the glass panel doesn't blur
   it), scissoring the right (animal, colour) preview into each card's
   rect. Previews are created lazily and cached by `${animalId}_${colour}`,
   so any animal/colour combo the lobby asks for just works.
   ============================================================ */
export class LobbyView {
  constructor(canvas, assets, teams) {
    this.assets = assets; this.teams = teams;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.15));
    const d = new THREE.DirectionalLight(0xffffff, 2.1); d.position.set(2, 3, 3); this.scene.add(d);

    this.cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.cam.position.set(3.6, 2.35, 5.3); this.cam.lookAt(0, 1.2, 0);

    this._cache = new Map();
    this._clock = new THREE.Clock();
  }

  _cat(animalId, colorIndex) {
    const key = `${animalId}_${colorIndex}`;
    let c = this._cache.get(key);
    if (!c) {
      const proto = this.assets.get(animalId) || this.assets.get('fox');
      c = new Cat(proto, this.teams[colorIndex].hex);
      c.model.scale.multiplyScalar(0.85);
      c.model.visible = false;
      this.scene.add(c.model);
      this._cache.set(key, c);
    }
    return c;
  }

  /** cards: [{ el, animalId, colorIndex }] for the visible slots. */
  render(cards) {
    if (!cards || !cards.length) return;
    const dt = Math.min(0.05, this._clock.getDelta());
    const r = this.renderer;
    const w = innerWidth, h = innerHeight;
    if (r.domElement.clientWidth !== w || r.domElement.clientHeight !== h) r.setSize(w, h, true);

    const now = performance.now() * 0.001;
    // advance every cached preview (calm idle + gentle breathing bob)
    let i = 0;
    for (const c of this._cache.values()) {
      c.updateAnimation(dt, { speed: 0.1, onGround: true });
      c.model.position.y = (c._baseY || 0) + Math.sin(now * 1.6 + i * 1.6) * 0.03;
      c.model.visible = false;
      i++;
    }

    r.clear();
    r.setScissorTest(true);
    for (const card of cards) {
      const rect = card.el.getBoundingClientRect();
      if (rect.width < 6 || rect.height < 6) continue;
      const x = rect.left, y = h - rect.bottom, vw = rect.width, vh = rect.height;
      this.cam.aspect = vw / vh; this.cam.updateProjectionMatrix();
      const cat = this._cat(card.animalId || 'fox', card.colorIndex || 0);
      cat.model.visible = true;
      cat.model.rotation.y = 0.5 + Math.sin(now * 0.6 + (card.colorIndex || 0)) * 0.3;
      r.setViewport(x, y, vw, vh);
      r.setScissor(x, y, vw, vh);
      r.render(this.scene, this.cam);
      cat.model.visible = false;
    }
    r.setScissorTest(false);
  }
}
