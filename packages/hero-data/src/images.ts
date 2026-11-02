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
  /** A map's replay preview or loading screen. */
  map(map: MapInfo, kind: 'replayPreview' | 'loadingScreen'): Picture | null;
  /** A chat emote: a still picture, or an animated file for an animated one. */
  emoticon(emoticon: Pick<ShownEmoticon, 'image'>): Picture;
  /** A map objective icon, one of `MapObjective.icons`. */
  mapObjective(icon: string): Picture;
  /** Any file in a heroes-images folder, by URL. */
  url(folder: string, file: string): string;
}

/**
 * The pictures for the file names in the hero data. A heroes-assets build (`data.pictures`) has
 * each in a sheet or a file of its own; anything else, and a name a build's pictures don't list
 * (a hero unit's own portrait), comes from HeroesToolChest/heroes-images, where each kind lives
 * in one folder.
 */
export function heroesImages(
  options: { readonly baseUrl?: string; readonly data?: Pick<HeroData, 'pictures'> } = {},
): HeroesImages {
  const base = (options.baseUrl ?? HEROES_IMAGES_BASE).replace(/\/$/, '');
  const pictures = options.data?.pictures;
  const url = (folder: string, file: string): string => `${base}/${folder}/${file}`;
  const at = (path: string): string => new URL(path, pictures!.base).href;
  const picture = (folder: string, file: string): Picture => {
    const place = pictures?.files[file.toLowerCase()];
    if (!place) return { src: url(folder, file) };
    return 'file' in place
      ? { src: at(place.file) }
      : { src: at(place.sheet), rect: place.rect, size: place.size };
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
      const own = pictures?.maps[map.normalizedId]?.[kind];
      if (own) return { src: at(own) };
      return kind === 'replayPreview'
        ? maybe('replaypreviews', map.replayPreviewImage)
        : maybe('loadingscreens', map.loadingScreenImage);
    },
    emoticon: (emoticon) => picture('emoticons', emoticon.image),
    mapObjective: (icon) => picture('mapobjectives', icon),
    url,
  };
}
