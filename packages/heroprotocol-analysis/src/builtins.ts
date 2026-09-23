import type { AnyAnalyser } from '@myrddraall/heroprotocol-db';
import { chat } from './analysers/chat.js';
import { commands } from './analysers/commands.js';
import { deathHeatmap } from './analysers/deathHeatmap.js';
import { description } from './analysers/description.js';
import { draft } from './analysers/draft.js';
import { playerStats } from './analysers/playerStats.js';
import { pointsOfInterest } from './analysers/pointsOfInterest.js';
import { scoreScreen } from './analysers/scoreScreen.js';
import { talents } from './analysers/talents.js';
import { timeline } from './analysers/timeline.js';
import { unitKills } from './analysers/unitKills.js';
import { xpCurve } from './analysers/xpCurve.js';

/**
 * The built-in analysers, in viewer order. Default modes: `description`,
 * `score-screen`, `unit-kills`, `player-stats` and `draft` gate readiness;
 * `talents`, `xp-curve`, `timeline`, `points-of-interest` and `chat` run in the
 * background; `commands` and `death-heatmap` run on first request. A host may
 * override any mode when registering.
 */
export const builtins: readonly AnyAnalyser[] = [
  description,
  scoreScreen,
  unitKills,
  playerStats,
  draft,
  talents,
  xpCurve,
  timeline,
  pointsOfInterest,
  chat,
  commands,
  deathHeatmap as AnyAnalyser,
];
