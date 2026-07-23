import { TEAMS, ARENA, ABIL, MATCH } from '../config.js';
import { Engine } from './Engine.js';
import { GameLoop } from './GameLoop.js';
import { AssetManager, makeFallbackCat, makeFallbackHouse, makeFallbackWater } from './AssetManager.js';
import { Physics } from '../physics/Physics.js';
import { Arena } from '../world/Arena.js';
import { Effects } from '../fx/Effects.js';
import { CameraRig } from '../camera/CameraRig.js';
import { Actions } from '../gameplay/Actions.js';
import { Bot } from '../gameplay/Bot.js';
import { Match } from '../gameplay/Match.js';
import { Input } from '../input/Input.js';
import { UI } from '../ui/UI.js';
import { renderPortraits } from '../ui/Portraits.js';
import { initLoaderFx } from '../loader/LoaderFx.js';

/* ============================================================
   Game — top-level orchestrator. Owns shared state and wires the
   subsystems together, then drives them from a single tick():
     input → bots → preStep → physics → postStep → pose → systems.
   Subsystems reach each other only through this facade.
   ============================================================ */
export class Game {
  constructor() {
    // shared content/state
    this.teams = TEAMS;
    this.ARENA = ARENA;
    this.ABIL = ABIL;
    this.config = { count: MATCH.defaultCount, rounds: MATCH.defaultRounds };
    this.players = [];
    this.humanColor = 0;
    this.thumbs = {};
    this.state = 'boot';

    // render core (sync, no assets needed)
    this.canvas = document.getElementById('c');
    this.engine = new Engine(this.canvas);
    this.scene = this.engine.scene;
    this.camera = this.engine.camera;
    this.cameraRig = new CameraRig(this.camera);
    this.fx = new Effects(this.scene, document.getElementById('flash'));
  }

  async boot() {
    const stopLoaderFx = initLoaderFx();
    this.ui = new UI(this);

    this.ui.setLoad(0.1, '물리 엔진 초기화…');
    this.physics = await Physics.init();
    this.actions = new Actions(this);
    this.bot = new Bot(this);
    this.match = new Match(this);
    this.arena = new Arena(this.scene);

    this.assets = new AssetManager((p, t) => this.ui.setLoad(p, t));
    this.ui.setLoad(0.32, '고양이 불러오는 중…');
    await this.assets.loadModel('cat', makeFallbackCat);
    this.ui.setLoad(0.55, '숲속 집 불러오는 중…');
    const house = await this.assets.loadModel('house', makeFallbackHouse);
    this.arena.addProp(house.scene);
    this.ui.setLoad(0.74, '바다 불러오는 중…');
    const water = await this.assets.loadModel('water', makeFallbackWater);
    this.arena.addWater(water);

    this.ui.setLoad(0.9, '초상화 렌더링…');
    this.thumbs = renderPortraits(this.engine.renderer, this.assets.get('cat'), this.teams);

    // attract demo: fill the home screen with idle cats
    this.match.buildPlayers();
    this.match.placeAll();
    this.players.forEach(p => { p.isBot = true; });

    this.ui.setLoad(1, '준비 완료');
    this.state = 'home';
    this.ui.showScreen('home');

    this.input = new Input(this);
    this.loop = new GameLoop(dt => this.tick(dt));
    this.loop.start();
    setTimeout(() => this.ui.hideLoader(stopLoaderFx), 300);
  }

  enterLobby(code) {
    this.ui.setRoomCode(code || ('CAT-' + (100 + Math.floor(Math.random() * 899))));
    this.ui.renderLobby();
    this.state = 'lobby';
    this.ui.showScreen('lobby');
  }

  tick(dt) {
    // human movement intent → local player
    if (this.state === 'playing') {
      const p = this.players[0];
      if (p && p.alive) {
        const mv = this.input.humanMove();
        if (mv) { p.moveDir.set(mv.x, mv.z); p.moveMag = mv.mag; }
        else p.moveMag = 0;
      }
    }

    if (this.physics && this.players.length) {
      const combat = this.state === 'playing' || this.state === 'countdown';
      const menu = this.state === 'home' || this.state === 'lobby' || this.state === 'results';
      if (combat || menu) {
        if (menu || (this.state === 'playing' && this.match.roundActive)) {
          for (const p of this.players) if (p.isBot) this.bot.update(p, dt);
        }
        for (const p of this.players) p.preStep(dt);
        this.physics.step(dt);
        for (const p of this.players) p.postStep(dt, menu);
        for (const p of this.players) p.pose(dt);
        if (combat) this.match.update(dt);
      }
    }

    this.arena.update(dt);
    this.fx.update(dt);
    this.ui.updateBanner(dt);
    this.cameraRig.update(dt, this);
    this.engine.render();
  }
}
