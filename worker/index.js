import { Room } from './room.js';
export { Room };

/* Worker entry: WebSocket room routes go to the Room Durable Object;
   everything else is served from the built static game (ASSETS binding),
   so the single-player game is unchanged and multiplayer rides alongside. */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/api\/room\/([A-Za-z0-9-]{1,12})\/ws$/);
    if (m) {
      const code = m[1].toUpperCase();
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      url.searchParams.set('code', code);
      return stub.fetch(new Request(url.toString(), request));
    }
    return env.ASSETS.fetch(request);
  },
};
