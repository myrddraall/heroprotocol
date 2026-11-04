import type { ShownEmoticon } from './emoticons/emoticons.js';
import type {
  AbilityInfo,
  AwardInfo,
  HeroData,
  HeroInfo,
  HeroPortraits,
  MapInfo,
  Picture,
  TalentInfo,
} from './types.js';

/**
 * heroes-images, from GitHub itself; follows the repository's `main` branch. (jsDelivr's copy now
 * and then refuses a file it hasn't cached, 403, GitHub limiting it.)
 */
export const HEROES_IMAGES_BASE =
  'https://raw.githubusercontent.com/HeroesToolChest/heroes-images/main/heroesimages';

export type PortraitKind = Exclude<keyof HeroPortraits, 'partyFrames'> | 'partyFrame';

export interface HeroesImages {
  /** A hero portrait; `null` when the hero has none of that kind. */
  portrait(hero: HeroInfo, kind: PortraitKind): Picture | null;
  /** An ability or talent icon. */
  icon(item: AbilityInfo | TalentInfo): Picture | null;
  /** An award icon: the MVP screen's (`blue`, `red`, `gold`) or the score screen's (`blue`, `red`). */
  award(
    award: AwardInfo,
    screen: 'mvp' | 'scoreScreen',
    color: 'blue' | 'red' | 'gold',
  ): Picture | null;
  /** A map's replay preview (in the sheet of every map's, where a build has one) or loading screen. */
  map(map: MapInfo, kind: 'replayPreview' | 'loadingScreen'): Picture | null;
  /** A chat emote: a still picture, or an animated file for an animated one. */
  emoticon(emoticon: Pick<ShownEmoticon, 'image'>): Picture;
  /** A map objective icon, one of `MapObjective.icons`. */
  mapObjective(icon: string): Picture;
  /** Any file in a heroes-images folder, by URL. */
  url(folder: string, file: string): string;
}

export interface HeroesImagesOptions {
  /** heroes-images' base, the last resort (default: GitHub's copy). */
  readonly baseUrl?: string;
  /** The build's own data: a heroes-assets build has `pictures`. */
  readonly data?: Pick<HeroData, 'pictures'>;
  /**
   * Another build's pictures, for a name the build's own don't list or a build with none (one
   * before heroes-assets): the newest heroes-assets build's, so old replays show our pictures too.
   */
  readonly fallback?: Pick<HeroData, 'pictures'>;
}

/**
 * The pictures for the file names in the hero data. A heroes-assets build (`data.pictures`) has
 * each in a sheet or a file of its own; a name it doesn't list, or a build without pictures, is
 * looked up in `fallback`'s (the newest heroes-assets build); only a name neither lists (a hero
 * unit's own portrait in a build stored before those) comes from HeroesToolChest/heroes-images,
 * where each kind lives in one folder.
 */
export function heroesImages(options: HeroesImagesOptions = {}): HeroesImages {
  const base = (options.baseUrl ?? HEROES_IMAGES_BASE).replace(/\/$/, '');
  const indexes = [options.data?.pictures, options.fallback?.pictures].filter(
    (p): p is NonNullable<typeof p> => p !== undefined,
  );
  const url = (folder: string, file: string): string => `${base}/${folder}/${file}`;
  const picture = (folder: string, file: string): Picture => {
    const name = file.toLowerCase();
    for (const index of indexes) {
      const place = index.files[name];
      if (!place) continue;
      const at = (path: string): string => new URL(path, index.base).href;
      return 'file' in place
        ? { src: at(place.file) }
        : { src: at(place.sheet), rect: place.rect, size: place.size };
    }
    return { src: url(folder, file) };
  };
  const maybe = (folder: string, file: string | null | undefined): Picture | null =>
    file ? picture(folder, file) : null;
  return {
    portrait: (hero, kind) =>
      maybe(
        'heroportraits',
        kind === 'partyFrame' ? hero.portraits.partyFrames[0] : hero.portraits[kind],
      ),
    icon: (item) => maybe('abilitytalents', item.icon),
    award: (award, screen, color) => {
      const file = screen === 'mvp' ? award.mvpScreenIcon : award.scoreScreenIcon;
      return maybe('matchawards', file?.replace(/%color%|%team%/, color));
    },
    map: (map, kind) => {
      // a made preview (Deadman's Stand has none in the game) is the map's, not a data file
      for (const index of indexes) {
        const sheet =
          kind === 'replayPreview' ? index.maps[map.normalizedId]?.replayPreviewSheet : undefined;
        if (sheet) {
          return { src: new URL(sheet.sheet, index.base).href, rect: sheet.rect, size: sheet.size };
        }
        const own = index.maps[map.normalizedId]?.[kind];
        if (own) return { src: new URL(own, index.base).href };
      }
      return kind === 'replayPreview'
        ? maybe('replaypreviews', map.replayPreviewImage)
        : maybe('loadingscreens', map.loadingScreenImage);
    },
    emoticon: (emoticon) => picture('emoticons', emoticon.image),
    mapObjective: (icon) => picture('mapobjectives', icon),
    url,
  };
}
