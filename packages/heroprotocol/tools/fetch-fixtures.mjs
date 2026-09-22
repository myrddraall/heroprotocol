#!/usr/bin/env node
/**
 * Download the public replays the end-to-end tests use into
 * test/fixtures/local/, which is gitignored.
 *
 * They are fetched rather than committed on purpose: a replay is Blizzard game
 * output carrying the BattleTags of whoever played it, and a 2 MB binary in git
 * history is a poor trade for tests that skip cleanly when the file is absent.
 *
 * Usage: pnpm fixtures:fetch
 */
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = join(HERE, '..', 'test', 'fixtures', 'local');

const FIXTURES = [
  {
    file: 'towers-of-doom.StormReplay',
    build: 66488,
    source: 'https://github.com/ebshimizu/hots-parser (MIT)',
    url: 'https://raw.githubusercontent.com/ebshimizu/hots-parser/master/test/replays/towers-of-doom.StormReplay',
  },
  {
    file: 'LostCavernNonSingleUnit1_76517.StormReplay',
    build: 76517,
    source: 'https://github.com/HeroesToolChest/Heroes.StormReplayParser (MIT) — a multi-sector MPQ',
    url: 'https://raw.githubusercontent.com/HeroesToolChest/Heroes.StormReplayParser/main/Heroes.StormReplayParser.Benchmarks/Replays/LostCavernNonSingleUnit1_76517.StormR',
  },
  {
    file: 'SilverCity1_85267.StormReplay',
    build: 85267,
    source: 'https://github.com/HeroesToolChest/Heroes.StormReplayParser (MIT) — current protocol lineage',
    url: 'https://raw.githubusercontent.com/HeroesToolChest/Heroes.StormReplayParser/main/Heroes.StormReplayParser.Benchmarks/Replays/SilverCity1_85267.StormR',
  },
];

await mkdir(TARGET, { recursive: true });
let failures = 0;
for (const f of FIXTURES) {
  const dest = join(TARGET, f.file);
  try {
    const s = await stat(dest);
    console.log(`= ${f.file} already present (${s.size} bytes)`);
    continue;
  } catch {
    /* download */
  }
  process.stdout.write(`. ${f.file} ... `);
  try {
    const res = await fetch(f.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    await writeFile(dest, bytes);
    console.log(`${bytes.byteLength} bytes  (build ${f.build}; ${f.source})`);
  } catch (e) {
    failures++;
    console.log(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  }
}
console.log(`\nFixtures live in ${TARGET} (gitignored). Drop your own .StormReplay there too; the specs pick it up.`);
process.exit(failures ? 1 : 0);
