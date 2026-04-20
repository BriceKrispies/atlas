import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5180,
    // Sandboxed iframes have origin "null"; Vite 6's default CORS
    // policy blocks non-localhost origins. Allow all so the iframe
    // isolation specimen can dynamically import the widget module.
    cors: { origin: true },
  },
});
