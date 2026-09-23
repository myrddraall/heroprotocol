/** Regenerate test/fixtures/golden/*.analysis.json.gz from the fixture replays: `pnpm run generate.analysis-goldens`. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { GOLDEN, goldenName, localReplays, normalizeLocal, stable } from '../test/util.js';
import { runInMemory } from '../test/run.js';

mkdirSync(GOLDEN, { recursive: true });
const replays = localReplays();
if (replays.length === 0) {
  console.error('no replays in the parser fixture directory — run `pnpm run fetch.fixtures` first');
  process.exit(1);
}
for (const file of replays) {
  const results = stable(await runInMemory(await normalizeLocal(file)));
  const out = join(GOLDEN, goldenName(file));
  writeFileSync(out, gzipSync(JSON.stringify(results), { level: 9 }));
  console.log(`${file} -> ${goldenName(file)} (${Object.keys(results).length} results)`);
}
