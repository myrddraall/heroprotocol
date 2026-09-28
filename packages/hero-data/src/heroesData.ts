import type { AbilityInfo, AwardInfo, HeroData, HeroInfo, TalentInfo } from './types.js';
import { levelOf, nul, portraits, ungender, type RawPortraits } from './shared.js';

export type HeroDataTables = Pick<HeroData, 'heroes' | 'talents' | 'abilities' | 'awards'>;

/** The shape of heroes-data's `herodata_<build>_localized.json` we depend on (`hdp` 4.x). */
export interface RawHeroData {
  readonly [heroId: string]: {
    readonly unitId?: string;
    readonly hyperlinkId?: string;
    readonly attributeId?: string;
    readonly franchise?: string;
    readonly releaseDate?: string;
    readonly portraits?: RawPortraits;
    readonly abilities?: Readonly<Record<string, readonly RawAbility[]>>;
    /** A list of `{ "<parent>|<button>|<type>": { <kind>: RawAbility[] } }` groups. */
    readonly subAbilities?: readonly Readonly<
      Record<string, Readonly<Record<string, readonly RawAbility[]>>>
    >[];
    readonly talents?: Readonly<Record<string, readonly RawTalent[]>>;
  };
}
export interface RawAbility {
  readonly nameId: string;
  readonly buttonId: string;
  readonly icon?: string;
  readonly abilityType?: string;
}
export interface RawTalent extends RawAbility {
  readonly sort?: number;
  readonly abilityTalentLinkIds?: readonly string[];
}
/** Match-award data; hdp 4 publishes the items bare, hdp 5 under `items`. */
export interface RawAwardItems {
  readonly [awardId: string]: {
    readonly gameLink: string;
    readonly tag: string;
    readonly mvpScreenIcon?: string;
    readonly scoreScreenIcon?: string;
  };
}
/** heroes-data's `matchawarddata_<build>_localized.json` (hdp 4). */
export type RawAwards = RawAwardItems;
/** heroes-data's `gamestrings_<build>_<locale>.json` (hdp 4). */
export interface RawGameStrings {
  readonly meta?: { readonly version?: string; readonly locale?: string };
  readonly gamestrings: {
    readonly unit?: Readonly<Record<string, Readonly<Record<string, string>>>>;
    readonly abiltalent?: Readonly<Record<string, Readonly<Record<string, string>>>>;
    readonly award?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  };
}

/** `abiltalent.*` strings are keyed `nameId|buttonId|abilityType|isPassive`; index them by nameId. */
function byNameId(table: Readonly<Record<string, string>> | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(table ?? {})) {
    const nameId = key.split('|')[0]!;
    if (!out.has(nameId)) out.set(nameId, value);
  }
  return out;
}

/** Read heroes-data's hdp 4 files (archived repository; builds up to 97039). */
export function readHeroesData(
  input: RawHeroData,
  rawAwards: RawAwards | undefined,
  strings: RawGameStrings,
): HeroDataTables {
  const g = strings.gamestrings;
  const unit = g.unit ?? {};
  const names = byNameId(g.abiltalent?.['name']);
  const shorts = byNameId(g.abiltalent?.['short']);
  const heroes: Record<string, HeroInfo> = {};
  const talents: Record<string, TalentInfo> = {};
  const abilities: Record<string, AbilityInfo> = {};

  for (const [id, raw] of Object.entries(input)) {
    const heroAbilities: AbilityInfo[] = [];
    const add = (kind: string, list: readonly RawAbility[] | undefined): void => {
      for (const a of list ?? []) {
        const info: AbilityInfo = {
          id: a.nameId,
          buttonId: a.buttonId,
          heroId: id,
          kind,
          abilityType: a.abilityType ?? '',
          name: names.get(a.nameId) ?? null,
          icon: nul(a.icon),
        };
        heroAbilities.push(info);
        abilities[a.nameId] ??= info;
      }
    };
    for (const [kind, list] of Object.entries(raw.abilities ?? {})) add(kind, list);
    for (const group of raw.subAbilities ?? []) {
      for (const kinds of Object.values(group)) {
        for (const [kind, list] of Object.entries(kinds)) add(`sub:${kind}`, list);
      }
    }

    const heroTalents: TalentInfo[] = [];
    for (const [levelKey, list] of Object.entries(raw.talents ?? {})) {
      for (const t of list) {
        const info: TalentInfo = {
          id: t.nameId,
          buttonId: t.buttonId,
          heroId: id,
          level: levelOf(levelKey),
          sort: t.sort ?? 0,
          abilityType: t.abilityType ?? '',
          name: names.get(t.nameId) ?? null,
          description: shorts.get(t.nameId) ?? null,
          icon: nul(t.icon),
          modifies: t.abilityTalentLinkIds ?? [],
        };
        heroTalents.push(info);
        talents[t.nameId] ??= info;
      }
    }
    heroTalents.sort((a, b) => a.level - b.level || a.sort - b.sort);

    heroes[id] = {
      id,
      name: unit['name']?.[id] ?? id,
      attributeId: raw.attributeId ?? '',
      hyperlinkId: raw.hyperlinkId ?? id,
      unitId: raw.unitId ?? `Hero${id}`,
      role: nul(unit['role']?.[id]),
      expandedRole: nul(unit['expandedrole']?.[id]),
      title: nul(unit['title']?.[id]),
      difficulty: nul(unit['difficulty']?.[id]),
      type: nul(unit['type']?.[id]),
      franchise: nul(raw.franchise),
      releaseDate: nul(raw.releaseDate),
      portraits: portraits(raw.portraits),
      abilities: heroAbilities,
      talents: heroTalents,
    };
  }

  const awards: Record<string, AwardInfo> = {};
  for (const [id, raw] of Object.entries(rawAwards ?? {})) {
    awards[id] = {
      id,
      gameLink: raw.gameLink,
      tag: raw.tag,
      name: ungender(g.award?.['name']?.[id]),
      description: nul(g.award?.['description']?.[id]),
      mvpScreenIcon: nul(raw.mvpScreenIcon),
      scoreScreenIcon: nul(raw.scoreScreenIcon),
    };
  }
  return { heroes, talents, abilities, awards };
}
