import type { ParsedReplay } from '@myrddraall/heroprotocol';
import type { FingerprintSource } from '../model/records.js';
import { sha1Hex } from '../util/sha1.js';

export interface Fingerprint {
  readonly id: string;
  readonly source: FingerprintSource;
}

/**
 * The replay id. With a decoded lobby this is exactly the 2018 heroesbrowser
 * fingerprint — `sha1(loopsHex|randomValue|ammId|hero~team~toon#…)` over every
 * lobby slot — so ids stored by the old library still match. The fallbacks use the
 * next most stable data available.
 */
export function fingerprint(parsed: ParsedReplay): Fingerprint {
  const loopsHex = parsed.header.m_elapsedGameLoops.toString(16);
  const init = parsed.initData;
  if (init) {
    const desc = init.m_syncLobbyState.m_gameDescription;
    const slots = init.m_syncLobbyState.m_lobbyState.m_slots
      .map((s) => `${s.m_hero}~${s.m_teamId}~${s.m_toonHandle}`)
      .join('#');
    return {
      id: sha1Hex(`${loopsHex}|${desc.m_randomValue}|${desc.m_gameOptions.m_ammId}|${slots}`),
      source: 'lobby',
    };
  }
  const details = parsed.details;
  if (details) {
    const players = details.m_playerList
      .map(
        (p) =>
          `${p.m_hero}~${p.m_teamId}~${p.m_toon.m_region}-${p.m_toon.m_realm}-${p.m_toon.m_id}`,
      )
      .join('#');
    return { id: sha1Hex(`${loopsHex}|${details.m_timeUTC}|${players}`), source: 'details' };
  }
  const h = parsed.header;
  return {
    id: sha1Hex(
      `${loopsHex}|${h.m_replayCompatibilityHash.m_data}|${h.m_signature}|${parsed.fileSize}`,
    ),
    source: 'header',
  };
}
