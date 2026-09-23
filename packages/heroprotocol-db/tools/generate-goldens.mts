/**
 * Regenerate test/fixtures/golden/*.normalized.json.gz from the replays in the
 * parser package's local fixture directory. Run after an intentional normalizer
 * change, then review the diff:
 *
 *   pnpm run generate.goldens
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { GOLDEN, goldenName, localReplays, makeGolden, normalizeLocal } from '../test/util/node.js';

mkdirSync(GOLDEN, { recursive: true });
const replays = localReplays();
if (replays.length === 0) {
  console.error('no replays in the parser fixture directory — run `pnpm run fetch.fixtures` first');
  process.exit(1);
}
for (const file of replays) {
  const n = await normalizeLocal(file);
  const golden = makeGolden(file, n);
  const out = join(GOLDEN, goldenName(file));
  writeFileSync(out, gzipSync(JSON.stringify(golden), { level: 9 }));
  console.log(`${file} -> ${goldenName(file)}  ${JSON.stringify(n.replay.rowCounts)}`);
}
