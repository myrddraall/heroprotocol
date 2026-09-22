import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // the store tests write ~30k rows per fixture into fake-indexeddb, 1–2 s each
    testTimeout: 60000,
    hookTimeout: 60000,
    coverage: { provider: 'v8', include: ['src/**/*.ts'] },
  },
});
