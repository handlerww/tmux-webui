import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:7681',
      '/ws': {
        target: 'ws://127.0.0.1:7681',
        ws: true,
      },
    },
  },
  build: {
    outDir: '../web/dist',
    emptyOutDir: true,
  },
});

