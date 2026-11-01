import type { AnyAnalyser } from '@myrddraall/heroprotocol-db';
import { activity } from './analysers/activity.js';
import { chat } from './analysers/chat.js';
import { commands } from './analysers/commands.js';
import { deathHeatmap } from './analysers/deathHeatmap.js';
import { description } from './analysers/description.js';
import { draft } from './analysers/draft.js';
import { playerStats } from './analysers/playerStats.js';
import { scoreScreen } from './analysers/scoreScreen.js';
import { talents } from './analysers/talents.js';
import { teamStats } from './analysers/teamStats.js';
import { unitKills } from './analysers/unitKills.js';
import { xpCurve } from './analysers/xpCurve.js';

/**
 * The built-in analysers, in viewer order. Default modes: `description`,
 * `score-screen`, `unit-kills`, `player-stats`, `team-stats` and `draft` gate readiness;
 * `talents`, `xp-curve` and `chat` run in the background; `commands`, `activity` and
 * `death-heatmap` run on first request. A host may override any mode when registering.
 */
export const builtins: readonly AnyAnalyser[] = [
  description,
  scoreScreen,
  unitKills,
  playerStats,
  teamStats,
  draft,
  talents,
  xpCurve,
  chat,
  commands,
  activity,
  deathHeatmap as AnyAnalyser,
];
