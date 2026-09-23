import type { GameOptions } from '@myrddraall/heroprotocol';
import type { GameMode } from '../model/records.js';

const AMM_MODES: Readonly<Record<number, GameMode>> = {
  50001: 'quick-match',
  50021: 'versus-ai',
  50031: 'brawl',
  50041: 'practice',
  50051: 'unranked-draft',
  50061: 'hero-league',
  50071: 'team-league',
  50091: 'storm-league',
  50101: 'aram',
};

/** The matchmaking id names the mode; without one the lobby options tell custom from custom draft. */
export function gameModeOf(options: GameOptions | undefined): GameMode {
  if (!options) return 'unknown';
  const known = AMM_MODES[options.m_ammId];
  if (known !== undefined) return known;
  if (options.m_practice) return 'practice';
  if (!options.m_competitive && !options.m_cooperative) {
    return options.m_heroDuplicatesAllowed ? 'custom' : 'custom-draft';
  }
  return 'unknown';
}
