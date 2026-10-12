import { defineConfig } from 'vite';

export default defineConfig({
  root: 'ui',
  // Tauri serves the built files from disk, so asset URLs must be relative.
  base: './',
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 1000 },
  // The shared UI comes from web/; make it use this app's copies of three and the Claude SDK.
  resolve: { dedupe: ['three', '@anthropic-ai/sdk'] },
  server: { port: 5173, strictPort: true, fs: { allow: ['..', '../../../web/src'] } },
  clearScreen: false,
});
