# @myrddraall/hero-data

Names for what a replay only knows by id: heroes, talents, abilities and awards.
`HeroDataProvider` is the interface an app injects; `heroesToolChestProvider` implements
it over [HeroesToolChest/heroes-data](https://github.com/HeroesToolChest/heroes-data)
(MIT; archived in 2026 but still served), and `staticHeroData` over data compiled ahead
of time.

```ts
import { heroesToolChestProvider } from '@myrddraall/hero-data';

const provider = heroesToolChestProvider({ cache }); // ~5 MB per build, fetched once
const data = await provider.forBuild(replay.version.baseBuild);

data.heroName('Barbarian'); // 'Sonya'   — the lobby / PlayerSpawned hero id
data.hero('Barb')?.role; // 'Warrior' — also by attribute id, unit id or display name
data.talentName('BarbarianWarPaint'); // 'War Paint' — players[].talents[].name as the replay records it
data.award('MostAltarDamageDone')?.name; // scoreResults[].awards entries, Boolean suffix or not
data.exact; // false when a neighbouring build was served
```

## What it resolves, and what it cannot

| Replay carries                                  | Resolves to                                              |
| ----------------------------------------------- | -------------------------------------------------------- |
| hero id (`Barbarian`), attribute id (`Barb`), unit (`HeroBarbarian`) | `HeroInfo`: display name, roles, title, difficulty, franchise, abilities, talents |
| talent `PurchaseName` (`BarbarianWarPaint`)     | `TalentInfo`: name, level, description, icon, modified abilities |
| award name (`ClutchHealer`, `MostAltarDamageDone`) | `AwardInfo`: name, description, tag                    |
| ability **link** (`commands[].abilLink`, a number) | **nothing** — the protocol's ability links index the game's per-build catalog, which heroes-data does not publish. Casts stay numeric. |

heroes-data starts at build **76003** (August 2019). For an older replay the provider
serves 76003 and flags `exact: false`; hero and talent names were stable enough that
this is usually right, but talents that were reworked in between will not resolve.

## Builds and caching

`KNOWN_BUILDS` is the bundled list of the 133 published build directories (47 of them
PTR, skipped unless `includePtr`); `provider.refreshBuilds()` re-reads it from GitHub,
and `pnpm run generate.hero-data-builds` regenerates the bundled list. Pass a `cache`
(`{ get, set }` over IndexedDB, the Cache API, or disk) so the raw files are fetched
once per build; compiled sets are memoized per build and locale in the provider.

To ship data without a network at all, run `compileHeroData()` once against the raw
files and hand the JSON to `staticHeroData()`.

## Licence

MIT. Data from HeroesToolChest/heroes-data is MIT; Heroes of the Storm is a trademark of
Blizzard Entertainment.
