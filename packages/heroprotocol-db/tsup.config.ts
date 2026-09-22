import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'model/index': 'src/model/index.ts',
    'normalize/index': 'src/normalize/index.ts',
    'analysers/index': 'src/analysers/index.ts',
    'db/index': 'src/db/index.ts',
    'ingest/index': 'src/ingest/index.ts',
    'worker/index': 'src/worker/index.ts',
    'client/index': 'src/client/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: true,
  target: 'es2022',
  external: ['@myrddraall/heroprotocol', 'dexie'],
});
