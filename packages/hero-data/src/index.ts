/**
 * @myrddraall/hero-data — names for what a replay only knows by id: heroes,
 * talents, abilities and awards. `HeroDataProvider` is what an app injects;
 * `heroesToolChestProvider` implements it over HeroesToolChest/heroes-data, and
 * `staticHeroData` over data compiled ahead of time with `compileHeroData`.
 */
export type {
  AbilityInfo,
  AbilityKind,
  AwardInfo,
  HeroData,
  HeroDataBuild,
  HeroDataOptions,
  HeroDataProvider,
  HeroDataSet,
  HeroInfo,
  TalentInfo,
} from './types.js';
export { compileHeroData, createHeroDataSet } from './compile.js';
export type { RawAbility, RawAwards, RawGameStrings, RawHeroData, RawTalent } from './compile.js';
export {
  heroesToolChestProvider,
  staticHeroData,
  nearest,
  parseBuildDirectories,
  HEROES_DATA_RAW,
  HEROES_DATA_TREE_API,
} from './providers.js';
export type { FetchLike, HeroesToolChestOptions, TextCache } from './providers.js';
export { KNOWN_BUILDS } from './data/builds.js';
