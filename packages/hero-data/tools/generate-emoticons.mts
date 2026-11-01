/**
 * Regenerate src/emoticons/emoticons.json — every chat emote of the latest live build, from
 * heroes-data2: its codes in every language (a player can type any language's alias), its hero
 * and expression (for the swap to the sender's hero's version) and its image. Run after a game
 * patch adds emotes:
 *
 *   pnpm run generate.emoticons
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EmoticonTable } from '../src/emoticons/emoticons.js';
import { HEROES_DATA2_RAW, parseBuildDirectories, toolChestFiles } from '../src/providers.js';

interface RawEmoticon {
  readonly expression?: string;
  readonly universalAliases?: readonly string[];
  readonly isCaseSensitive?: boolean;
  readonly isHidden?: boolean;
  readonly heroId?: string;
  readonly skinId?: string;
  readonly image?: string;
  readonly animation?: unknown;
}

interface RawStrings {
  readonly items: { readonly emoticon?: { readonly localizedAliases?: Record<string, string[]> } };
}

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../src/emoticons/emoticons.json');

const files = toolChestFiles();
const index = JSON.parse(await files.get(`${HEROES_DATA2_RAW}/.version.json`)) as {
  versions: string[];
};
const latest = parseBuildDirectories(index.versions, 'heroes-data2')
  .filter((b) => !b.ptr)
  .at(-1);
if (!latest) throw new Error('no live heroes-data2 build');

const meta = await files.meta(latest.directory);
// the locales' own strings: `enus`, `dede`… (not `mapdata|enus` or `[maps]`)
const locales = Object.keys(meta.files['[gamestrings]'] ?? {}).filter((k) => /^[a-z]{4}$/.test(k));
const raw = (
  (await files.rebuild(latest.directory, 'data', 'emoticondata')) as {
    items: Record<string, RawEmoticon>;
  }
).items;
const strings = await Promise.all(
  locales.map((l) => files.rebuild(latest.directory, 'gamestrings', l) as Promise<RawStrings>),
);

const table: EmoticonTable = { build: latest.build, emoticons: {} };
for (const [id, e] of Object.entries(raw)) {
  // The generic ones (`:)`, `:love:`) are hidden and have no picture: the game only ever shows the
  // sender's hero's version of their expression. Other hidden emotes and pictureless ones are out.
  const generic = !e.heroId && e.expression !== undefined && e.expression !== 'Unknown';
  if (!generic && (e.isHidden || !e.image)) continue;
  const aliases = new Set(e.universalAliases ?? []);
  for (const s of strings)
    for (const a of s.items.emoticon?.localizedAliases?.[id] ?? []) aliases.add(a);
  if (aliases.size === 0) continue;
  table.emoticons[id] = {
    aliases: [...aliases].sort(),
    ...(e.isCaseSensitive ? { caseSensitive: true } : {}),
    ...(e.heroId ? { heroId: e.heroId } : {}),
    ...(e.skinId ? { skinId: e.skinId } : {}),
    ...(e.expression && e.expression !== 'Unknown' ? { expression: e.expression } : {}),
    ...(e.image ? { image: e.image } : {}),
  };
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(table)}\n`);
console.log(
  `build ${latest.build} (${latest.directory}): ${Object.keys(table.emoticons).length} emoticons, ` +
    `${locales.length} locales -> ${OUT}`,
);
