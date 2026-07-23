/* Canvas particle backdrop for the loading screen. Returns a stop(). */
export function initLoaderFx() {
  const cv = document.getElementById('loadFx');
  if (!cv) return () => {};
  const ctx = cv.getContext('2d');
  let W = 0, H = 0; const dpr = Math.min(2, devicePixelRatio || 1);
  const COLS = [[255, 157, 92], [125, 196, 255], [143, 240, 196], [255, 223, 140], [255, 120, 160]];
  const rnd = (a, b) => a + Math.random() * (b - a);
  function fit() { W = cv.clientWidth; H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  fit(); addEventListener('resize', fit);

  const N = 70, ps = [];
  const mk = (y) => { const c = COLS[(Math.random() * COLS.length) | 0]; return { x: rnd(0, W), y: y != null ? y : rnd(0, H), r: rnd(6, 26), vy: rnd(-10, -30), vx: rnd(-8, 8), sw: rnd(0.6, 1.6), ph: rnd(0, 6.28), a: rnd(.25, .6), c }; };
  for (let i = 0; i < N; i++) ps.push(mk());
  const SP = []; for (let i = 0; i < 26; i++) { const c = COLS[(Math.random() * COLS.length) | 0]; SP.push({ x: rnd(0, W), y: rnd(0, H), r: rnd(1.5, 3.5), tw: rnd(1, 3), ph: rnd(0, 6.28), c }); }

  let raf, t0 = performance.now(), running = true;
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - t0) / 1000); t0 = now; const tt = now * 0.001;
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    for (const p of ps) {
      p.ph += dt * p.sw; p.x += (p.vx + Math.sin(p.ph) * 10) * dt; p.y += p.vy * dt;
      if (p.y < -40) Object.assign(p, mk(H + 30));
      if (p.x < -40) p.x = W + 30; if (p.x > W + 40) p.x = -30;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      const [r, gr, b] = p.c;
      g.addColorStop(0, `rgba(${r},${gr},${b},${p.a})`); g.addColorStop(1, `rgba(${r},${gr},${b},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832); ctx.fill();
    }
    for (const s of SP) {
      const tw = (Math.sin(tt * s.tw + s.ph) * 0.5 + 0.5); const [r, g, b] = s.c;
      ctx.fillStyle = `rgba(${r},${g},${b},${0.15 + tw * 0.75})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r * (0.6 + tw * 0.7), 0, 6.2832); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return () => { running = false; cancelAnimationFrame(raf); removeEventListener('resize', fit); };
}
