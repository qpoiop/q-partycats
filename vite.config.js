import { defineConfig } from 'vite';

// PARTY CATS build config.
// - Static output to ./dist (served by the Cloudflare Worker, see wrangler.toml).
// - Rapier ships a base64-inlined WASM in the -compat build, so no wasm plugin needed.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0, // keep .glb as real files, never inline
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          rapier: ['@dimforge/rapier3d-compat'],
        },
      },
    },
  },
  server: {
    host: true,
  },
});
