import { defineConfig } from 'vite';

export default defineConfig({
  // The one setting a consumer needs: Vite bundles workers as IIFE by default, but
  // the parser lazy-loads its protocol definitions with dynamic import(), which
  // makes the worker graph code-split and therefore ES-module only. Everything else
  // is Vite's defaults — no asset or alias configuration.
  worker: { format: 'es' },
});
