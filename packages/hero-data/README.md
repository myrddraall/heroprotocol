# @myrddraall/hero-data

Names and images for what a replay only knows by id: heroes, talents, abilities and awards.
`HeroDataProvider` is the interface an app injects; `heroesToolChestProvider` implements it by
loading [HeroesToolChest](https://github.com/HeroesToolChest)'s data **at runtime**. Nothing is
bundled or generated ahead of time, so a new hero or patch is picked up without a redeploy.

```ts
import { heroesImages, heroesToolChestProvider } from '@myrddraall/hero-data';

const provider = heroesToolChestProvider({ cache }); // raw files fetched once per build
const images = heroesImages();

// In a replay: the data for the build it was played on
const data = await provider.forBuild(replay.version.baseBuild);
data.heroName('Barbarian'); // 'Sonya'   — the lobby / PlayerSpawned hero id
data.hero('Barb')?.role; // 'Warrior' — also by attribute id, unit id or display name
data.talentName('BarbarianWarPaint'); // 'War Paint' — players[].talents[].name as the replay records it
data.award('MostAltarDamageDone')?.name; // scoreResults[].awards entries, Boolean suffix or not
data.map(replay.map)?.objectives; // the map's objectives, with titles and icons
data.exact; // false when a neighbouring build was served

// Outside a replay (a replays list, a hero picker): the newest build
const current = await provider.latest();
images.portrait(current.hero('Kerrigan')!, 'minimap'); // …/heroportraits/storm_ui_minimapicon_kerrigan.png
images.icon(current.talent('KerriganRavageSiphoningImpact')!); // …/abilitytalents/storm_ui_icon_kerrigan_ravage.png
```

## Sources

| Builds             | Repository                                                        | Notes                                                                                     |
| ------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 97039 and later    | [heroes-data2](https://github.com/HeroesToolChest/heroes-data2)   | Current. Versions are stored as JSON patches on earlier ones; the provider rebuilds them. |
| 76003 – 97039      | [heroes-data](https://github.com/HeroesToolChest/heroes-data)     | Archived in 2026, still served. heroes-data2 wins for 97039, which is in both.            |
| images, all builds | [heroes-images](https://github.com/HeroesToolChest/heroes-images) | Served through jsDelivr. The data names files; `heroesImages` adds the folder.            |

All three are MIT. The list of builds is discovered on first use: heroes-data2's
`.version.json` is read fresh each session (the cached copy is the offline fallback), and
heroes-data's listing is read once through the GitHub tree API and then kept in the cache,
since that repository no longer changes. PTR builds are skipped unless `includePtr`.

## What it resolves, and what it cannot

| Replay carries                                                          | Resolves to                                                                                                                            |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| hero id (`Barbarian`), attribute id (`Barb`), unit (`HeroBarbarian`)    | `HeroInfo`: display name, roles, title, difficulty, franchise, portraits, abilities, talents                                           |
| talent `PurchaseName` (`BarbarianWarPaint`)                             | `TalentInfo`: name, level, description, icon, modified abilities                                                                       |
| award name (`ClutchHealer`, `MostAltarDamageDone`)                      | `AwardInfo`: name, description, tag, MVP and score-screen icons                                                                        |
| map name (`Garden of Terror`), or its normalized id, map link or map id | `MapInfo`: display name, size, replay preview and loading-screen images, objectives with titles, descriptions and icons                |
| ability **link** (`commands[].abilLink`, a number)                      | **nothing** — the protocol's ability links index the game's per-build catalog, which neither repository publishes. Casts stay numeric. |

Maps are published only by heroes-data2, so builds served from heroes-data get the maps
of heroes-data2's oldest build (97039). Map lookup by display name matches the loaded
locale, so load the replay client's locale for non-English map names.

For a replay older than 76003 (August 2019) the provider serves 76003, and for one newer than
the latest published build it serves the latest; both are flagged `exact: false`. Hero and
talent names were stable enough that this is usually right, but talents reworked in between
will not resolve.

## Caching

Pass a `cache` (`{ get, set }` over IndexedDB, the Cache API, or disk). Published files never
change, so they are read from the cache before the network; a build that needs patches costs
its full root plus one small patch per version in between, once. Loaded builds are memoized
in the provider per build and locale.

## Licence

MIT. Data and images from HeroesToolChest are MIT; Heroes of the Storm is a trademark of
Blizzard Entertainment.
