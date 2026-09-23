import type { StatSupportTable } from './types.js';

/** Score screens exist from this build on. */
export const FIRST_SCORE_BUILD = 40336;
/** Before this build, damage taken was recorded for warriors only and damage soaked not at all. */
export const FULL_DAMAGE_STATS_BUILD = 63507;

export interface StatSupportInput {
  readonly baseBuild: number;
  /** Whether the replay actually carried a score screen. */
  readonly hasScoreResults: boolean;
}

/** What the replay's build can and cannot tell about each stat. */
export function statSupportFor(input: StatSupportInput): StatSupportTable {
  const table: Record<string, { support: 'full' | 'partial' | 'flawed' | 'none'; note: string }> =
    {};
  if (!input.hasScoreResults || input.baseBuild < FIRST_SCORE_BUILD) {
    table['*'] = {
      support: 'none',
      note:
        input.baseBuild < FIRST_SCORE_BUILD
          ? 'Score screen data is not recorded by replays before build 40336'
          : 'This replay has no score screen (left before the end, or the section failed to decode)',
    };
    return table;
  }
  if (input.baseBuild < FULL_DAMAGE_STATS_BUILD) {
    const none = 'Not available in this replay version';
    const warriors = 'Only recorded for Warriors in this replay version';
    for (const s of ['DamageSoaked', 'AverageDamageSoakedPerLife', 'PercentDamageSoaked'])
      table[s] = { support: 'none', note: none };
    for (const s of [
      'DamageTaken',
      'AverageDamageTakenPerLife',
      'PercentDamageTaken',
      'PercentTeamfightDamageTaken',
    ])
      table[s] = { support: 'partial', note: warriors };
    table['PercentDamageHealed'] = {
      support: 'flawed',
      note: 'Damage taken is only recorded for Warriors in this replay version, so the ratio uses hero damage dealt against the team while healing includes damage from every source; the figure is inflated',
    };
  }
  return table;
}
