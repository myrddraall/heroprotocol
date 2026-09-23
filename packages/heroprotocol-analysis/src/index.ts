/**
 * @myrddraall/heroprotocol-analysis — the built-in analysers over the
 * heroprotocol-db model, and (from `./worker`) the batteries-included ingest worker.
 */
import {
  createRegistry,
  type AnalyserRegistry,
  type AnyAnalyser,
} from '@myrddraall/heroprotocol-db';
import { builtins } from './builtins.js';

export { builtins };
export { description } from './analysers/description.js';
export type { Description, DescriptionPlayer } from './analysers/description.js';
export { scoreScreen, SCORE_SCREEN_STATS } from './analysers/scoreScreen.js';
export type {
  ScoreScreen,
  ScoreScreenPlayer,
  ScoreScreenStat,
  ScoreScreenTeam,
} from './analysers/scoreScreen.js';
export { playerStats } from './analysers/playerStats.js';
export type { PlayerStats, PlayerStatsRow } from './analysers/playerStats.js';
export { draft } from './analysers/draft.js';
export type { Draft, DraftStep } from './analysers/draft.js';
export { talents } from './analysers/talents.js';
export type { PlayerTalents, TalentPickRow } from './analysers/talents.js';
export { xpCurve } from './analysers/xpCurve.js';
export type { XpCurve, TeamXp, XpPoint } from './analysers/xpCurve.js';
export { timeline } from './analysers/timeline.js';
export type { Timeline, TimelineEvent } from './analysers/timeline.js';
export { unitKills, MERC_TYPES } from './analysers/unitKills.js';
export type { UnitKills, PlayerKills, KillCounts } from './analysers/unitKills.js';
export { pointsOfInterest } from './analysers/pointsOfInterest.js';
export type { PointsOfInterest, PointOfInterest, PoiType } from './analysers/pointsOfInterest.js';
export { chat } from './analysers/chat.js';
export type { ChatLine } from './analysers/chat.js';
export { commands } from './analysers/commands.js';
export type { PlayerCommands } from './analysers/commands.js';
export { deathHeatmap } from './analysers/deathHeatmap.js';
export type { DeathHeatmap, DeathHeatmapParams } from './analysers/deathHeatmap.js';
export type { PlayerRef } from './analysers/shared.js';

/** A registry with the built-ins, plus any of the host's own analysers. */
export function createBuiltinRegistry(extra: readonly AnyAnalyser[] = []): AnalyserRegistry {
  return createRegistry([...builtins, ...extra]);
}
