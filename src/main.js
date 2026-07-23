import { Game } from './core/Game.js';

/* PARTY CATS entry point. */
const game = new Game();
game.boot().catch(e => {
  const txt = document.getElementById('loadTxt');
  if (txt) txt.textContent = '로드 실패: ' + (e && e.message || e);
  console.error(e);
});

// expose for debugging / future console tooling
window.PARTYCATS = game;
