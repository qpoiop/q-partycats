import * as THREE from 'three';
import { Cat } from '../entities/Cat.js';

/* Render-to-texture cat portraits for the lobby — the real model,
   team-tinted, on transparent background. No emoji, per spec. */
export function renderPortraits(renderer, proto, teams) {
  const rt = new THREE.WebGLRenderTarget(320, 320);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445, 1.1));
  const d = new THREE.DirectionalLight(0xffffff, 2.2); d.position.set(2, 3, 3); scene.add(d);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  cam.position.set(4.4, 2.3, 5.2); cam.lookAt(0, 1.45, 0);   // 3/4 view, framing the whole cat

  const prevAlpha = renderer.getClearAlpha();
  const prevColor = renderer.getClearColor(new THREE.Color());
  const thumbs = {};
  teams.forEach((t, ti) => {
    const cat = new Cat(proto, t.hex);
    cat.model.rotation.y = 0.1; scene.add(cat.model);   // slight turn → 3/4 (camera is off to the side)
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, cam);
    const buf = new Uint8Array(320 * 320 * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, 320, 320, buf);
    const cv = document.createElement('canvas'); cv.width = cv.height = 320;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(320, 320);
    for (let y = 0; y < 320; y++) {
      const sy = 319 - y;
      for (let x = 0; x < 320; x++) {
        const si = (sy * 320 + x) * 4, di = (y * 320 + x) * 4;
        const a = buf[si + 3];
        // un-premultiply edge pixels: the RT blends model over a transparent-black
        // clear, so partially-covered edges come back darkened → a black fringe in
        // the chips. Dividing RGB by alpha restores the true colour (straight alpha).
        if (a > 0 && a < 255) {
          const inv = 255 / a;
          img.data[di] = Math.min(255, buf[si] * inv);
          img.data[di + 1] = Math.min(255, buf[si + 1] * inv);
          img.data[di + 2] = Math.min(255, buf[si + 2] * inv);
        } else {
          img.data[di] = buf[si]; img.data[di + 1] = buf[si + 1]; img.data[di + 2] = buf[si + 2];
        }
        img.data[di + 3] = a;
      }
    }
    ctx.putImageData(img, 0, 0);
    thumbs[ti] = cv.toDataURL();
    scene.remove(cat.model);
  });
  renderer.setRenderTarget(null);
  renderer.setClearColor(prevColor, prevAlpha); // restore the scene clear colour
  return thumbs;
}
