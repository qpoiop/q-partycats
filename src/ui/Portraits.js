import * as THREE from 'three';
import { Cat } from '../entities/Cat.js';

/* Render-to-texture cat portraits for the lobby — the real model,
   team-tinted, on transparent background. No emoji, per spec. */
export function renderPortraits(renderer, proto, teams) {
  const rt = new THREE.WebGLRenderTarget(320, 320);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445, 1.1));
  const d = new THREE.DirectionalLight(0xffffff, 2.2); d.position.set(2, 3, 3); scene.add(d);
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  cam.position.set(3.4, 2.4, 5.9); cam.lookAt(0, 1.5, 0);   // pulled back to frame the whole cat

  const prevAlpha = renderer.getClearAlpha();
  const prevColor = renderer.getClearColor(new THREE.Color());
  const thumbs = {};
  teams.forEach((t, ti) => {
    const cat = new Cat(proto, t.hex);
    cat.model.rotation.y = 0.5; scene.add(cat.model);   // face toward the camera
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
        img.data[di] = buf[si]; img.data[di + 1] = buf[si + 1]; img.data[di + 2] = buf[si + 2]; img.data[di + 3] = buf[si + 3];
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
