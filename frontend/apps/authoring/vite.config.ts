import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env['VITE_BASE'] ?? '/',
  server: {
    port: 5181,
    cors: { origin: true },
  },
  build: {
    outDir: '../../dist/authoring',
    emptyOutDir: true,
  },
});
