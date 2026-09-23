import type {
  AbilityInfo,
  AwardInfo,
  HeroData,
  HeroDataSet,
  HeroInfo,
  TalentInfo,
} from './types.js';

/** The shape of `herodata_<build>_localized.json` we depend on (heroes-data `hdp` 4.x). */
export interface RawHeroData {
  readonly [heroId: string]: {
    readonly unitId?: string;
    readonly hyperlinkId?: string;
    readonly attributeId?: string;
    readonly franchise?: string;
    readonly releaseDate?: string;
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
/** `matchawarddata_<build>_localized.json`. */
export interface RawAwards {
  readonly [awardId: string]: { readonly gameLink: string; readonly tag: string };
}
/** `gamestrings_<build>_<locale>.json`. */
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

const nul = (v: string | undefined): string | null => (v === undefined || v === '' ? null : v);

/**
 * Compile heroes-data's raw files into one `HeroData`. Pure; use it to prebuild
 * static data for bundling, or let `heroesToolChestProvider` call it at runtime.
 */
export function compileHeroData(input: {
  readonly build: number;
  readonly locale: string;
  readonly heroes: RawHeroData;
  readonly awards?: RawAwards;
  readonly strings: RawGameStrings;
}): HeroData {
  const g = input.strings.gamestrings;
  const unit = g.unit ?? {};
  const names = byNameId(g.abiltalent?.['name']);
  const shorts = byNameId(g.abiltalent?.['short']);
  const heroes: Record<string, HeroInfo> = {};
  const talents: Record<string, TalentInfo> = {};
  const abilities: Record<string, AbilityInfo> = {};

  for (const [id, raw] of Object.entries(input.heroes)) {
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
      const level = Number(levelKey.replace(/^level/, '')) || 0;
      for (const t of list) {
        const info: TalentInfo = {
          id: t.nameId,
          buttonId: t.buttonId,
          heroId: id,
          level,
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
      abilities: heroAbilities,
      talents: heroTalents,
    };
  }

  const awards: Record<string, AwardInfo> = {};
  for (const [id, raw] of Object.entries(input.awards ?? {})) {
    awards[id] = {
      id,
      gameLink: raw.gameLink,
      tag: raw.tag,
      name: g.award?.['name']?.[id] ?? null,
      description: g.award?.['description']?.[id] ?? null,
    };
  }
  return { build: input.build, locale: input.locale, heroes, talents, abilities, awards };
}

/** Wrap compiled data with the tolerant lookups a replay needs. */
export function createHeroDataSet(
  data: HeroData,
  requestedBuild: number = data.build,
): HeroDataSet {
  const heroIndex = new Map<string, HeroInfo>();
  for (const h of Object.values(data.heroes)) {
    for (const key of [h.id, h.attributeId, h.unitId, h.hyperlinkId, h.name]) {
      if (key) heroIndex.set(key.toLowerCase(), h);
    }
  }
  const awardIndex = new Map<string, AwardInfo>();
  for (const a of Object.values(data.awards)) {
    awardIndex.set(a.id.toLowerCase(), a);
    awardIndex.set(a.gameLink.toLowerCase(), a);
    // the stripped score-screen name: EndOfMatchAward<Name>Boolean → <Name>
    const stripped = a.gameLink.replace(/^EndOfMatchAward/, '').replace(/Boolean$/, '');
    awardIndex.set(stripped.toLowerCase(), a);
  }
  const set: HeroDataSet = {
    ...data,
    requestedBuild,
    exact: requestedBuild === data.build,
    hero: (idOrName) => heroIndex.get(idOrName.toLowerCase()),
    talent: (id) => data.talents[id],
    ability: (id) => data.abilities[id],
    award: (idOrLink) => awardIndex.get(idOrLink.toLowerCase()),
    heroName: (id) => heroIndex.get(id.toLowerCase())?.name ?? id,
    talentName: (id) => data.talents[id]?.name ?? id,
  };
  return set;
}
