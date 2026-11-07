/** The HeroesToolChest repository a build is published in. */
export type HeroDataSource = 'heroes-data' | 'heroes-data2' | 'heroes-assets';

/** Where a picture is, inside a sheet: `[x, y, width, height]` in pixels. */
export type PictureRect = readonly [number, number, number, number];

/**
 * A picture to show: a file (`src` alone), or one picture in a sheet of many (`src` is the sheet;
 * `rect` its place in it and `size` the sheet's own size, to scale it). One kept smaller too (a
 * heroes-assets target portrait) lists its smaller copies (`variants`, smallest first), each in a
 * sheet: to show it small, the smallest one at least that big saves the full size's download.
 */
export interface Picture {
  readonly src: string;
  readonly rect?: PictureRect;
  readonly size?: readonly [number, number];
  readonly variants?: readonly Picture[];
}

/** A picture's place in one of heroes-assets' sheets, as its `pictures.json` gives it. */
export interface SheetPlace {
  readonly sheet: string;
  readonly rect: PictureRect;
  readonly size: readonly [number, number];
}

/** One build's pictures as heroes-assets publishes them (its `pictures.json`). */
export interface PictureIndex {
  /** The URL the paths below are relative to (the channel's folder, ending in `/`). */
  readonly base: string;
  /**
   * By the file name the data names (lower case): its sheet, place and sheet size (and its smaller
   * copies' places, smallest first, where it is kept smaller too), or its file.
   */
  readonly files: Readonly<
    Record<
      string,
      (SheetPlace & { readonly variants?: readonly SheetPlace[] }) | { readonly file: string }
    >
  >;
  /**
   * By map normalized id: its replay preview and loading screen (a made preview when the game has
   * none), and the preview's place in the sheet of every map's (builds that have it).
   */
  readonly maps: Readonly<
    Record<
      string,
      {
        readonly replayPreview?: string;
        readonly loadingScreen?: string;
        readonly replayPreviewSheet?: {
          readonly sheet: string;
          readonly rect: PictureRect;
          readonly size: readonly [number, number];
        };
      }
    >
  >;
}

/** One build directory published by heroes-data or heroes-data2. */
export interface HeroDataBuild {
  readonly build: number;
  /** Game version, e.g. `2.55.15`. */
  readonly version: string;
  readonly ptr: boolean;
  /** Directory name under `heroesdata/`. */
  readonly directory: string;
  /**
   * `heroes-data` (archived; builds up to 97039), `heroes-data2` (97039 on), or `heroes-assets`
   * (97039 on, with pictures in sheets; `directory` is `<channel>/<game version>`).
   */
  readonly source: HeroDataSource;
}

/** `basic`, `heroic`, `trait`, `mount`, `hearth`, `spray`, `voice`, or `sub:<kind>` for a sub-ability. */
export type AbilityKind = string;

export interface AbilityInfo {
  /** The game's internal id (`BarbarianAncientSpear`). */
  readonly id: string;
  readonly buttonId: string;
  readonly heroId: string;
  readonly kind: AbilityKind;
  /** Hotkey/slot: Q, W, E, R, D, Z, B, Trait, Heroic, Active, … */
  readonly abilityType: string;
  readonly name: string | null;
  /** File name in heroes-images' `abilitytalents/` folder. */
  readonly icon: string | null;
}

export interface TalentInfo {
  /** The game's internal id — what `TalentChosen.PurchaseName` and `players.talents[].name` carry. */
  readonly id: string;
  readonly buttonId: string;
  readonly heroId: string;
  /** 1, 4, 7, 10, 13, 16 or 20. */
  readonly level: number;
  readonly sort: number;
  readonly abilityType: string;
  readonly name: string | null;
  /** The game's short text (the talent picker's line), in its markup. */
  readonly description: string | null;
  /**
   * The game's full tooltip text, in its markup: colour (`<c val hlt-name>`) and style
   * (`<s val hlt-name>`) runs, inline icons (`<img path>`) and line breaks (`<n/>`).
   */
  readonly fullText: string | null;
  /** File name in heroes-images' `abilitytalents/` folder. */
  readonly icon: string | null;
  /** Abilities this talent modifies. */
  readonly modifies: readonly string[];
}

/** Portrait file names in heroes-images' `heroportraits/` folder (see `heroesImages`). */
export interface HeroPortraits {
  readonly draftScreen: string | null;
  readonly heroSelect: string | null;
  readonly leaderboard: string | null;
  readonly loading: string | null;
  readonly minimap: string | null;
  readonly partyPanel: string | null;
  readonly partyFrames: readonly string[];
  readonly target: string | null;
  readonly targetInfo: string | null;
}

export interface HeroInfo {
  /** The internal hero id — the `herodata` key, the lobby's `m_hero`, `PlayerSpawned` minus `Hero` (`Barbarian`). */
  readonly id: string;
  /** Display name (`Sonya`). */
  readonly name: string;
  /** The four-letter lobby attribute (`Barb`). */
  readonly attributeId: string;
  /** URL-safe name (`Sonya`). */
  readonly hyperlinkId: string;
  /** The hero unit type (`HeroBarbarian`). */
  readonly unitId: string;
  /** Classic role (`Warrior`, `Assassin`, `Support`, `Specialist`, `Multiclass`). */
  readonly role: string | null;
  /** Post-2019 role (`Bruiser`, `Tank`, `Healer`, `Ranged Assassin`, …). */
  readonly expandedRole: string | null;
  readonly title: string | null;
  readonly difficulty: string | null;
  readonly type: string | null;
  readonly franchise: string | null;
  readonly releaseDate: string | null;
  readonly portraits: HeroPortraits;
  readonly abilities: readonly AbilityInfo[];
  readonly talents: readonly TalentInfo[];
}

export interface AwardInfo {
  /** heroes-data's award id (`ClutchHealer`). */
  readonly id: string;
  /** The score-screen instance name (`EndOfMatchAwardClutchHealerBoolean`). */
  readonly gameLink: string;
  readonly tag: string;
  readonly name: string | null;
  readonly description: string | null;
  /** MVP-screen icon in heroes-images' `matchawards/`, with a `%color%` placeholder (`blue`, `red`, `gold`). */
  readonly mvpScreenIcon: string | null;
  /** Score-screen icon in `matchawards/`, with a `%team%` placeholder (`blue`, `red`). */
  readonly scoreScreenIcon: string | null;
}

/** The compiled, JSON-able data set for one build and locale. */
export interface MapObjective {
  readonly title: string | null;
  readonly description: string | null;
  /** File names in heroes-images' `mapobjectives/` folder. */
  readonly icons: readonly string[];
}

export interface MapInfo {
  /** heroes-data2's map key, the English name (`Garden of Terror`). */
  readonly id: string;
  /** Display name in the loaded locale. */
  readonly name: string;
  /** `garden_of_terror`. */
  readonly normalizedId: string;
  /** The game's map id (`HauntedWoods`); not unique — variants share it. */
  readonly mapId: string | null;
  /** `GardenOfTerror`. */
  readonly mapLink: string | null;
  readonly width: number | null;
  readonly height: number | null;
  /** File name in heroes-images' `replaypreviews/` folder. */
  readonly replayPreviewImage: string | null;
  /** File name in heroes-images' `loadingscreens/` folder. */
  readonly loadingScreenImage: string | null;
  readonly objectives: readonly MapObjective[];
}

/** One build's data, as loaded at runtime from its source. */
export interface HeroData {
  /** The build the data came from. */
  readonly build: number;
  readonly source: HeroDataSource;
  readonly locale: string;
  readonly heroes: Readonly<Record<string, HeroInfo>>;
  /** Talents by internal id, across all heroes. */
  readonly talents: Readonly<Record<string, TalentInfo>>;
  /** Abilities by internal id, across all heroes. */
  readonly abilities: Readonly<Record<string, AbilityInfo>>;
  /** Awards by id. */
  readonly awards: Readonly<Record<string, AwardInfo>>;
  /** Maps by id. Builds before 97039 (heroes-data, which has none) get the oldest newer build's. */
  readonly maps: Readonly<Record<string, MapInfo>>;
  /** heroes-assets builds: where each picture the data names is (see `heroesImages`). */
  readonly pictures?: PictureIndex;
}

/** `HeroData` plus lookups that tolerate the ids a replay actually carries. */
export interface HeroDataSet extends HeroData {
  /** The build the caller asked for; `exact` is false when a neighbouring build was served. */
  readonly requestedBuild: number;
  readonly exact: boolean;
  /** By internal id, attribute id, unit id, hyperlink id or display name. */
  hero(idOrName: string): HeroInfo | undefined;
  talent(id: string): TalentInfo | undefined;
  ability(id: string): AbilityInfo | undefined;
  /** By award id, `gameLink`, or the stripped score-screen name (`ClutchHealer`, `MostAltarDamageDone`). */
  award(idOrLink: string): AwardInfo | undefined;
  /** By id (English name), display name, normalized id, map link or map id. */
  map(nameOrId: string): MapInfo | undefined;
  /** Display name for a hero id, falling back to the id itself. */
  heroName(id: string): string;
  talentName(id: string): string;
}

export interface HeroDataOptions {
  /** Game-strings locale (default `enus`; also dede, eses, esmx, frfr, itit, kokr, plpl, ptbr, ruru, zhcn, zhtw). */
  readonly locale?: string;
}

/** What consumers inject. */
export interface HeroDataProvider {
  /** Data for a replay's `version.baseBuild`; implementations pick the nearest build they have. */
  forBuild(build: number, options?: HeroDataOptions): Promise<HeroDataSet>;
  /** Data for the newest published build — the default outside a replay (a replays list, a hero picker). */
  latest(options?: HeroDataOptions): Promise<HeroDataSet>;
  /** The builds available, ascending, discovered at runtime. */
  builds(): Promise<readonly HeroDataBuild[]>;
}
