/**
 * @myrddraall/heroprotocol-analysis — the built-in analysers over the
 * heroprotocol-db model, each writing its own tables, and (from `./worker`) the
 * batteries-included ingest worker.
 */
import {
  createRegistry,
  type AnalyserRegistry,
  type AnyAnalyser,
} from '@myrddraall/heroprotocol-db';
import { builtins } from './builtins.js';

export { builtins };
export { description } from './analysers/description.js';
export type {
  DescriptionRow,
  DescriptionPlayerRow,
  DescriptionTables,
} from './analysers/description.js';
export { scoreScreen, SCORE_SCREEN_STATS } from './analysers/scoreScreen.js';
export type {
  ScoreScreenPlayerRow,
  ScoreScreenStat,
  ScoreScreenTeamRow,
  ScoreScreenTables,
} from './analysers/scoreScreen.js';
export { playerStats } from './analysers/playerStats.js';
export type {
  PlayerStatsRow,
  PlayerStatsSupportRow,
  PlayerStatsTables,
} from './analysers/playerStats.js';
export { draft } from './analysers/draft.js';
export type { DraftRow, DraftStepRow, DraftTables } from './analysers/draft.js';
export { talents } from './analysers/talents.js';
export type { TalentPickRow, TalentsTables } from './analysers/talents.js';
export { xpCurve } from './analysers/xpCurve.js';
export type { XpPointRow, XpCurveTables } from './analysers/xpCurve.js';
export { timeline } from './analysers/timeline.js';
export type { TimelineEventRow, TimelineKind, TimelineTables } from './analysers/timeline.js';
export { unitKills, MERC_TYPES } from './analysers/unitKills.js';
export type {
  KillCounts,
  PlayerKillsRow,
  TeamKillsRow,
  UnitKillsTables,
} from './analysers/unitKills.js';
export { pointsOfInterest } from './analysers/pointsOfInterest.js';
export type {
  PointOfInterestRow,
  MapInfoRow,
  PoiType,
  PointsOfInterestTables,
} from './analysers/pointsOfInterest.js';
export { chat } from './analysers/chat.js';
export type { ChatLineRow, ChatTables } from './analysers/chat.js';
export { commands } from './analysers/commands.js';
export type { CommandStatsRow, AbilityUseRow, CommandsTables } from './analysers/commands.js';
export { deathHeatmap } from './analysers/deathHeatmap.js';
export type {
  DeathHeatmapRow,
  DeathHeatmapCellRow,
  DeathHeatmapParams,
  DeathHeatmapTables,
} from './analysers/deathHeatmap.js';
export type { PlayerRef } from './analysers/shared.js';

/** A registry with the built-ins, plus any of the host's own analysers. */
export function createBuiltinRegistry(extra: readonly AnyAnalyser[] = []): AnalyserRegistry {
  return createRegistry([...builtins, ...extra]);
}

/** Every built-in's tables — what the batteries-included worker adds to the database. */
export function builtinTables(): Record<string, string> {
  return createRegistry(builtins).tables();
}
