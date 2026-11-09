import type { Picture, PictureRect } from './types.js';

/**
 * A map's camps and the units a unit card shows (camp defenders, the mercenaries a capture sends
 * into lane, towns' structures, cores), from heroes-assets' `maps/units/<map>.json` with the
 * strings of `strings/<locale>/maps.json` and the map's sheet (`maps/index.json`).
 */
export interface MapUnitsInfo {
  /** How the game counts scaling: a tick every `tickSeconds` from the gates opening, at most `maxTicks`. */
  readonly scalingTicks: ScalingTicks;
  readonly camps: readonly CampTypeInfo[];
  /** By unit type (the replay's `MercDefenderSiegeGiant`). */
  readonly units: Readonly<Record<string, MapUnitInfo>>;
  /** Each veterancy behaviour the map's units scale by: its levels, the first (rank 0) the unit's own. */
  readonly scaling: Readonly<Record<string, readonly ScalingLevel[]>>;
}

export interface ScalingTicks {
  readonly tickSeconds: number;
  readonly maxTicks: number;
}

/**
 * One level of a veterancy behaviour: what it adds, by field (`VitalMaxArray.Life`,
 * `DamageDealtScaled.Basic`, `KillXPBonus`).
 */
export type ScalingLevel = Readonly<Record<string, number>>;

/** A camp type: who defends it, what its capture sends into lane, and how it comes back. */
export interface CampTypeInfo {
  /** The game's name for it (`SiegeGiants`, `SiegeCamp1`), or its map's helper's (`HellbatMercType`). */
  readonly id: string;
  /** The game's group for it. */
  readonly category: 'siege' | 'bruiser' | 'boss' | 'doubloons' | 'other';
  /** Its label in the loaded locale (the minimap's: `Siege Giants`, `Impaler`); null when none. */
  readonly label: string | null;
  readonly defenders: readonly UnitCount[];
  /** The mercenaries its capture sends into lane. */
  readonly mercs: readonly UnitCount[];
  readonly respawnSeconds: number | null;
  /** How long after the gates open it first comes up. */
  readonly firstSpawnSeconds: number | null;
  readonly elite: boolean;
  readonly soloable: boolean;
  readonly captureXp: number | null;
  /** The veterancy behaviours its defenders and mercenaries scale by (`scaling`'s keys). */
  readonly defenderScaling: string | null;
  readonly mercScaling: string | null;
  /** Its level by rank (scaling tick), where the game gives one. */
  readonly levels: readonly number[];
}

export interface UnitCount {
  readonly unit: string;
  readonly count: number;
}

/** What a unit card shows of a unit: HDP's stats, its name, description and portraits. */
export interface MapUnitInfo {
  /** In the loaded locale; null when the game names it nowhere. */
  readonly name: string | null;
  readonly description: string | null;
  /** Its target portraits, one per team where the map has two (Order's first); none when it has none. */
  readonly portraits: readonly Picture[];
  readonly life: Vital | null;
  readonly shield: Vital | null;
  readonly energy: Vital | null;
  readonly armor: unknown;
  readonly weapons: readonly WeaponInfo[];
  readonly speed: number | null;
  readonly sight: number | null;
  readonly radius: number | null;
  readonly killXP: number | null;
  readonly attributes: readonly string[];
  readonly damageType: string | null;
  /** The veterancy behaviours it scales by (`scaling`'s keys). */
  readonly scalingLinkIds: readonly string[];
}

export interface Vital {
  readonly amount: number;
  /** Per level of a hero's; mercenaries scale by `scaling` instead. */
  readonly scale: number;
  readonly regenRate: number;
  readonly regenScale: number;
}

export interface WeaponInfo {
  readonly nameId: string;
  readonly range: number;
  readonly minimumRange: number;
  /** Seconds between attacks. */
  readonly period: number;
  readonly damage: number;
  readonly damageScale: number;
}

/** A map's entry in heroes-assets' `maps/index.json`: its sheet and where each icon is in it. */
export interface MapSheetEntry {
  readonly sheet: string | null;
  /** The sheet's size; older releases lack it (then the icons' extent stands in). */
  readonly sheetSize?: readonly [number, number] | null;
  readonly icons: Readonly<Record<string, PictureRect>>;
  readonly units: string | null;
}

/** heroes-assets' `maps/units/<map>.json`, as published. */
export interface RawMapUnits {
  readonly scalingTicks: ScalingTicks;
  readonly camps: readonly Omit<CampTypeInfo, 'label'>[];
  readonly units: Readonly<Record<string, Record<string, unknown> & { portraits: string[] }>>;
  readonly scaling: Readonly<Record<string, readonly ScalingLevel[]>>;
}

/** A map's strings in heroes-assets' `strings/<locale>/maps.json`: its camps' labels, its units'. */
export interface RawMapUnitStrings {
  readonly camps?: Readonly<Record<string, string>>;
  readonly units?: Readonly<Record<string, { name: string | null; description: string | null }>>;
}

/**
 * A map's camps and unit cards from heroes-assets' files: `base` is the channel's folder (ending in
 * `/`), the paths in `entry` relative to its `maps/`.
 */
export function readMapUnits(
  raw: RawMapUnits,
  strings: RawMapUnitStrings | undefined,
  entry: MapSheetEntry,
  base: string,
): MapUnitsInfo {
  const sheetSize: readonly [number, number] =
    entry.sheetSize ??
    Object.values(entry.icons).reduce<[number, number]>(
      ([w, h], [x, y, iw, ih]) => [Math.max(w, x + iw), Math.max(h, y + ih)],
      [0, 0],
    );
  const picture = (icon: string): Picture | null => {
    const rect = entry.icons[icon];
    return entry.sheet && rect
      ? { src: new URL(`maps/${entry.sheet}`, base).href, rect, size: sheetSize }
      : null;
  };
  const number = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  const vital = (v: unknown): Vital | null =>
    v && typeof v === 'object' && typeof (v as Vital).amount === 'number' ? (v as Vital) : null;
  const units: Record<string, MapUnitInfo> = {};
  for (const [id, unit] of Object.entries(raw.units)) {
    const text = strings?.units?.[id];
    units[id] = {
      name: text?.name ?? null,
      description: text?.description ?? null,
      portraits: unit.portraits.map(picture).filter((p): p is Picture => p !== null),
      life: vital(unit['life']),
      shield: vital(unit['shield']),
      energy: vital(unit['energy']),
      armor: unit['armor'] ?? null,
      weapons: Array.isArray(unit['weapons']) ? (unit['weapons'] as WeaponInfo[]) : [],
      speed: number(unit['speed']),
      sight: number(unit['sight']),
      radius: number(unit['radius']),
      killXP: number(unit['killXP']),
      attributes: Array.isArray(unit['attributes']) ? (unit['attributes'] as string[]) : [],
      damageType: typeof unit['damageType'] === 'string' ? unit['damageType'] : null,
      scalingLinkIds: Array.isArray(unit['scalingLinkIds'])
        ? (unit['scalingLinkIds'] as string[])
        : [],
    };
  }
  return {
    scalingTicks: raw.scalingTicks,
    camps: raw.camps.map((camp) => ({ ...camp, label: strings?.camps?.[camp.id] ?? null })),
    units,
    scaling: raw.scaling,
  };
}

/**
 * The scaling rank a unit has `seconds` after the gates open (game time), its behaviour having
 * `levels` levels: a tick every `tickSeconds`, at most `maxTicks`, at most its last level. A
 * camp's defenders are at it while the camp is idle; the mercenaries a capture sends start at the
 * camp's rank when it was captured.
 */
export function scalingRank(seconds: number, ticks: ScalingTicks, levels: number): number {
  const elapsed = Math.max(0, Math.floor(seconds / ticks.tickSeconds));
  return Math.max(0, Math.min(elapsed, ticks.maxTicks, levels - 1));
}

/**
 * What a veterancy behaviour adds by `rank`, by field: every level's modification from 1 to it
 * summed (rank 0 adds nothing). A stat at a rank is its base plus its field's total
 * (`VitalMaxArray.Life` to life, `DamageDealtScaled.Basic` to a basic attack's damage).
 */
export function scalingTotals(
  levels: readonly ScalingLevel[],
  rank: number,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const level of levels.slice(1, rank + 1)) {
    for (const [field, value] of Object.entries(level ?? {})) {
      totals[field] = (totals[field] ?? 0) + value;
    }
  }
  return totals;
}

/** heroes-assets' locale folders (BCP 47), by the game's locale names hero-data takes. */
export const ASSETS_LOCALES: Readonly<Record<string, string>> = {
  enus: 'en-US',
  dede: 'de-DE',
  eses: 'es-ES',
  esmx: 'es-MX',
  frfr: 'fr-FR',
  itit: 'it-IT',
  kokr: 'ko-KR',
  plpl: 'pl-PL',
  ptbr: 'pt-BR',
  ruru: 'ru-RU',
  zhcn: 'zh-CN',
  zhtw: 'zh-TW',
};
