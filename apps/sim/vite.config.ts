import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env['VITE_BASE'] ?? '/',
  server: {
    port: 5182,
    cors: { origin: true },
  },
  build: {
    outDir: '../../dist/sim',
    emptyOutDir: true,
  },
});
