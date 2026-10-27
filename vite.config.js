import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // the sandbox preview proxies the dev server through its own https host
    allowedHosts: true,
    // HMR websockets can't traverse the https preview proxy -> off by default.
    // Plain local dev: `VITE_HMR=on npm run dev`.
    hmr: process.env.VITE_HMR === 'on',
  },
  preview: { host: '0.0.0.0', port: 4173, strictPort: true, allowedHosts: true },
  build: { target: 'es2020', assetsInlineLimit: 0 },
});
