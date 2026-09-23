import { defineConfig } from 'tsup';

export default defineConfig([
  {
    // The library: analysers and the registry helper.
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    target: 'es2022',
    external: ['@myrddraall/heroprotocol-db', '@myrddraall/heroprotocol', 'dexie'],
  },
  {
    // The batteries-included worker: everything inlined (parser, protocols, Dexie,
    // model, pipeline, analysers), ESM because the parser's lazy protocol loading is
    // code-split. Consumers point `createReplayDb({ workerUrl })` at this file.
    entry: { worker: 'src/worker.ts' },
    format: ['esm'],
    platform: 'browser',
    dts: true,
    sourcemap: true,
    minify: true,
    splitting: true,
    treeshake: true,
    target: 'es2022',
    noExternal: [/.*/],
  },
]);
