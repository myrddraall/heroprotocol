/** One build directory published by heroes-data. */
export interface HeroDataBuild {
  readonly build: number;
  /** Game version, e.g. `2.55.15`. */
  readonly version: string;
  readonly ptr: boolean;
  /** Directory name under `heroesdata/`. */
  readonly directory: string;
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
  readonly description: string | null;
  readonly icon: string | null;
  /** Abilities this talent modifies. */
  readonly modifies: readonly string[];
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
}

/** The compiled, JSON-able data set for one build and locale. */
export interface HeroData {
  /** The heroes-data build the data came from. */
  readonly build: number;
  readonly locale: string;
  readonly heroes: Readonly<Record<string, HeroInfo>>;
  /** Talents by internal id, across all heroes. */
  readonly talents: Readonly<Record<string, TalentInfo>>;
  /** Abilities by internal id, across all heroes. */
  readonly abilities: Readonly<Record<string, AbilityInfo>>;
  /** Awards by id. */
  readonly awards: Readonly<Record<string, AwardInfo>>;
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
  /** Display name for a hero id, falling back to the id itself. */
  heroName(id: string): string;
  talentName(id: string): string;
}

export interface HeroDataOptions {
  /** heroes-data locale directory suffix (default `enus`). */
  readonly locale?: string;
}

/** What consumers inject. */
export interface HeroDataProvider {
  /** Data for a replay's `version.baseBuild`; implementations pick the nearest build they have. */
  forBuild(build: number, options?: HeroDataOptions): Promise<HeroDataSet>;
}
