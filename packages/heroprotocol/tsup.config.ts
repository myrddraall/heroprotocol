import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // The 36 protocol definitions are dynamic imports; splitting keeps them out of the
  // entry chunk (51 KB instead of 2.5 MB) for CJS consumers as well as ESM.
  splitting: true,
  target: 'es2022',
  
  
  
  external: ['@myrddraall/mpq'],
});
