/**
 * @myrddraall/hero-data — names and images for what a replay only knows by id: heroes,
 * talents, abilities, awards and chat emotes. `HeroDataProvider` is what an app injects;
 * `heroesToolChestProvider` implements it by loading HeroesToolChest's data at runtime,
 * and `heroesImages` turns the data's file names into heroes-images URLs.
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
  HeroDataSource,
  HeroInfo,
  HeroPortraits,
  MapInfo,
  MapObjective,
  TalentInfo,
} from './types.js';
export {
  heroesToolChestProvider,
  mergeBuilds,
  nearest,
  parseBuildDirectories,
  HEROES_DATA_RAW,
  HEROES_DATA2_RAW,
  HEROES_DATA_TREE_API,
} from './providers.js';
export type { FetchLike, HeroesToolChestOptions, TextCache } from './providers.js';
export { heroesImages, HEROES_IMAGES_BASE } from './images.js';
export type { HeroesImages, PortraitKind } from './images.js';
export { createEmoticonSet, loadEmoticons } from './emoticons/emoticons.js';
export type {
  ChatPiece,
  Emoticon,
  EmoticonInfo,
  EmoticonSet,
  EmoticonTable,
  ShownEmoticon,
} from './emoticons/emoticons.js';
