import type { AbilityInfo, AwardInfo, HeroInfo, MapInfo, TalentInfo } from './types.js';
import type { HeroDataTables, RawAwardItems } from './heroesData.js';
import { levelOf, nul, portraits, ungender, type RawPortraits } from './shared.js';

/** heroes-data2's `herodata_<build>.json` (hdp 5), once rebuilt to full form. */
export interface RawHeroData5 {
  readonly meta: { readonly heroesVersion?: string; readonly hdpVersion?: string };
  readonly items: {
    readonly [heroId: string]: {
      readonly unitId?: string;
      readonly hyperlinkId?: string;
      readonly attributeId?: string;
      readonly franchise?: string;
      readonly releaseDate?: string;
      readonly isMelee?: boolean;
      readonly portraits?: RawPortraits;
      readonly abilities?: Readonly<Record<string, readonly RawAbility5[]>>;
      /** `{ "<parent linkId>": { <kind>: RawAbility5[] } }`. */
      readonly subAbilities?: Readonly<
        Record<string, Readonly<Record<string, readonly RawAbility5[]>>>
      >;
      readonly talents?: Readonly<Record<string, readonly RawTalent5[]>>;
    };
  };
}
export interface RawAbility5 {
  /** `abilityId|buttonId|abilityType` — the key into the game strings. */
  readonly linkId: string;
  /** `:PASSIVE:` for passive traits, which are then known by `buttonId`. */
  readonly abilityId: string;
  readonly buttonId: string;
  readonly icon?: string;
  readonly abilityType?: string;
}
export interface RawTalent5 {
  /** `talentId|buttonId|abilityType|Level<n>`. */
  readonly linkId: string;
  readonly talentId: string;
  readonly buttonId: string;
  readonly icon?: string;
  readonly abilityType?: string;
  readonly sort?: number;
  /** Ability linkIds (`BarbarianLeap|BarbarianLeap|Heroic`). */
  readonly tooltipAbilityLinkIds?: readonly string[];
}
/** heroes-data2's `matchawarddata_<build>.json` (hdp 5). */
export interface RawAwards5 {
  readonly meta: unknown;
  readonly items: RawAwardItems;
}
type StringTable = Readonly<Record<string, string>>;
/** heroes-data2's `gamestrings_<build>_<locale>.json` (hdp 5). */
export interface RawGameStrings5 {
  readonly meta: unknown;
  readonly items: {
    readonly hero?: Readonly<Record<string, Readonly<Record<string, string | readonly string[]>>>>;
    readonly ability?: Readonly<Record<string, StringTable>>;
    readonly talent?: Readonly<Record<string, StringTable>>;
    readonly matchAward?: Readonly<Record<string, StringTable>>;
  };
}

/** Read heroes-data2's hdp 5 files (rebuilt to full form; builds from 97039). */
export function readHeroesData2(
  input: RawHeroData5,
  rawAwards: RawAwards5 | undefined,
  strings: RawGameStrings5,
): HeroDataTables {
  const g = strings.items;
  const hero = g.hero ?? {};
  const heroString = (field: string, id: string): string | null => {
    const v = hero[field]?.[id];
    return Array.isArray(v) ? nul(v.join(',')) : nul(v as string | undefined);
  };
  const abilityNames = g.ability?.['name'] ?? {};
  const talentNames = g.talent?.['name'] ?? {};
  const talentShorts = g.talent?.['shortText'] ?? {};
  const heroes: Record<string, HeroInfo> = {};
  const talents: Record<string, TalentInfo> = {};
  const abilities: Record<string, AbilityInfo> = {};

  for (const [id, raw] of Object.entries(input.items)) {
    const heroAbilities: AbilityInfo[] = [];
    const add = (kind: string, list: readonly RawAbility5[] | undefined): void => {
      for (const a of list ?? []) {
        const abilityId = a.abilityId === ':PASSIVE:' ? a.buttonId : a.abilityId;
        const info: AbilityInfo = {
          id: abilityId,
          buttonId: a.buttonId,
          heroId: id,
          kind,
          abilityType: a.abilityType ?? '',
          name: nul(abilityNames[a.linkId]),
          icon: nul(a.icon),
        };
        heroAbilities.push(info);
        abilities[abilityId] ??= info;
      }
    };
    for (const [kind, list] of Object.entries(raw.abilities ?? {})) add(kind.toLowerCase(), list);
    for (const kinds of Object.values(raw.subAbilities ?? {})) {
      for (const [kind, list] of Object.entries(kinds)) add(`sub:${kind.toLowerCase()}`, list);
    }

    const heroTalents: TalentInfo[] = [];
    for (const [levelKey, list] of Object.entries(raw.talents ?? {})) {
      for (const t of list) {
        const info: TalentInfo = {
          id: t.talentId,
          buttonId: t.buttonId,
          heroId: id,
          level: levelOf(levelKey),
          sort: t.sort ?? 0,
          abilityType: t.abilityType ?? '',
          name: nul(talentNames[t.linkId]),
          description: nul(talentShorts[t.linkId]),
          icon: nul(t.icon),
          modifies: (t.tooltipAbilityLinkIds ?? []).map((link) => link.split('|')[0]!),
        };
        heroTalents.push(info);
        talents[t.talentId] ??= info;
      }
    }
    heroTalents.sort((a, b) => a.level - b.level || a.sort - b.sort);

    heroes[id] = {
      id,
      name: heroString('name', id) ?? id,
      attributeId: raw.attributeId ?? '',
      hyperlinkId: raw.hyperlinkId ?? id,
      unitId: raw.unitId ?? `Hero${id}`,
      role: heroString('roles', id),
      expandedRole: heroString('expandedRole', id),
      title: heroString('title', id),
      difficulty: heroString('difficulty', id),
      type: raw.isMelee === undefined ? null : raw.isMelee ? 'Melee' : 'Ranged',
      franchise: nul(raw.franchise),
      releaseDate: nul(raw.releaseDate),
      portraits: portraits(raw.portraits),
      abilities: heroAbilities,
      talents: heroTalents,
    };
  }

  const awardStrings = g.matchAward ?? {};
  const awards: Record<string, AwardInfo> = {};
  for (const [id, raw] of Object.entries(rawAwards?.items ?? {})) {
    awards[id] = {
      id,
      gameLink: raw.gameLink,
      tag: raw.tag,
      name: ungender(awardStrings['scoreScreenName']?.[id]),
      description: nul(awardStrings['scoreScreenDescription']?.[id]),
      mvpScreenIcon: nul(raw.mvpScreenIcon),
      scoreScreenIcon: nul(raw.scoreScreenIcon),
    };
  }
  return { heroes, talents, abilities, awards };
}

/** heroes-data2's `mapdata_<build>.json` (hdp 5). */
export interface RawMapData5 {
  readonly meta: unknown;
  readonly items: {
    readonly [mapKey: string]: {
      readonly normalizedId: string;
      readonly mapId?: string;
      readonly mapLink?: string;
      readonly mapSize?: { readonly x: number; readonly y: number };
      readonly replayPreviewImage?: string;
      readonly loadingScreenImage?: string;
      readonly mapObjectives?: readonly {
        readonly icons?: readonly { readonly image?: string }[];
      }[];
    };
  };
}
/** heroes-data2's `gamestrings_mapdata_<build>_<locale>.json` (hdp 5). */
export interface RawMapStrings5 {
  readonly meta: unknown;
  readonly items: {
    readonly map?: Readonly<Record<string, Readonly<Record<string, string | readonly string[]>>>>;
  };
}

/** Read heroes-data2's map files. */
export function readMaps5(
  input: RawMapData5,
  strings: RawMapStrings5 | undefined,
): Record<string, MapInfo> {
  const g = strings?.items.map ?? {};
  const maps: Record<string, MapInfo> = {};
  for (const [id, raw] of Object.entries(input.items)) {
    const name = g['name']?.[id];
    const titles = g['objectiveTitle']?.[id];
    const descriptions = g['objectiveDescription']?.[id];
    maps[id] = {
      id,
      name: typeof name === 'string' && name !== '' ? name : id,
      normalizedId: raw.normalizedId,
      mapId: nul(raw.mapId),
      mapLink: nul(raw.mapLink),
      width: raw.mapSize?.x ?? null,
      height: raw.mapSize?.y ?? null,
      replayPreviewImage: nul(raw.replayPreviewImage),
      loadingScreenImage: nul(raw.loadingScreenImage),
      objectives: (raw.mapObjectives ?? []).map((o, i) => ({
        title: nul(Array.isArray(titles) ? titles[i] : undefined),
        description: nul(Array.isArray(descriptions) ? descriptions[i] : undefined),
        icons: (o.icons ?? []).flatMap((icon) => (icon.image ? [icon.image] : [])),
      })),
    };
  }
  return maps;
}
