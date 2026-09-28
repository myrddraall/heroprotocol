import type {
  AbilityInfo,
  AwardInfo,
  HeroInfo,
  HeroPortraits,
  MapInfo,
  TalentInfo,
} from './types.js';

/** heroes-images through jsDelivr (CORS-enabled); follows the repository's `main` branch. */
export const HEROES_IMAGES_BASE =
  'https://cdn.jsdelivr.net/gh/HeroesToolChest/heroes-images@main/heroesimages';

export type PortraitKind = Exclude<keyof HeroPortraits, 'partyFrames'> | 'partyFrame';

export interface HeroesImages {
  /** A hero portrait (`heroportraits/`); `null` when the hero has none of that kind. */
  portrait(hero: HeroInfo, kind: PortraitKind): string | null;
  /** An ability or talent icon (`abilitytalents/`). */
  icon(item: AbilityInfo | TalentInfo): string | null;
  /** An award icon (`matchawards/`): the MVP screen's (`blue`, `red`, `gold`) or the score screen's (`blue`, `red`). */
  award(
    award: AwardInfo,
    screen: 'mvp' | 'scoreScreen',
    color: 'blue' | 'red' | 'gold',
  ): string | null;
  /** A map's replay preview (`replaypreviews/`) or loading screen (`loadingscreens/`). */
  map(map: MapInfo, kind: 'replayPreview' | 'loadingScreen'): string | null;
  /** A map objective icon (`mapobjectives/`), one of `MapObjective.icons`. */
  mapObjective(icon: string): string;
  /** Any file in a heroes-images folder. */
  url(folder: string, file: string): string;
}

/**
 * URLs for the file names in the hero data, served from HeroesToolChest/heroes-images.
 * The data names files without a folder; each kind lives in one folder there.
 */
export function heroesImages(options: { readonly baseUrl?: string } = {}): HeroesImages {
  const base = (options.baseUrl ?? HEROES_IMAGES_BASE).replace(/\/$/, '');
  const url = (folder: string, file: string): string => `${base}/${folder}/${file}`;
  const maybe = (folder: string, file: string | null | undefined): string | null =>
    file ? url(folder, file) : null;
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
    map: (map, kind) =>
      kind === 'replayPreview'
        ? maybe('replaypreviews', map.replayPreviewImage)
        : maybe('loadingscreens', map.loadingScreenImage),
    mapObjective: (icon) => url('mapobjectives', icon),
    url,
  };
}
