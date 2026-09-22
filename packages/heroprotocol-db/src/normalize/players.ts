import type { ParsedReplay, SStatGameEvent } from '@myrddraall/heroprotocol';
import type {
  PlayerRecord,
  PlayerSummary,
  ScoreResultRecord,
  TalentPick,
  Toon,
} from '../model/records.js';
import { attribute, heroRoleOf } from './attributes.js';
import type { PlayerLookup } from './lookup.js';

/** Role attribute; scope is the lobby slot index + 1. */
const ROLE_ATTRIBUTE = 4007;

function toonOf(
  handle: string,
  id: number,
  realm: number,
  region: number,
  programId: string,
): Toon {
  return { id, realm, region, programId, handle };
}

/**
 * One row per occupied slot, merged from the lobby slot (cosmetics, silence, hero
 * id), the user's initial data (name), `details` (display hero name, result, toon
 * id), the attributes (role) and the tracker stream (talents, level).
 */
export function normalizePlayers(
  replayId: string,
  parsed: ParsedReplay,
  lookup: PlayerLookup,
  stats: readonly SStatGameEvent[],
  scores: readonly ScoreResultRecord[],
  leftAt: ReadonlyMap<number, number>,
): PlayerRecord[] {
  const lobbySlots = parsed.initData?.m_syncLobbyState.m_lobbyState.m_slots ?? [];
  const users = parsed.initData?.m_syncLobbyState.m_userInitialData ?? [];
  const detailsBySlot = new Map(
    parsed.details?.m_playerList.map((p) => [p.m_workingSetSlotId, p]) ?? [],
  );
  const scoreBySlot = new Map(scores.map((s) => [s.slot, s]));

  const talents = new Map<number, TalentPick[]>();
  const levels = new Map<number, number>();
  const spawnedHero = new Map<number, string>();
  for (const e of stats) {
    if (e.m_eventName === 'PlayerSpawned') {
      const slot = lookup.slotOfPlayer(intValue(e, 'PlayerID'));
      const hero = e.m_stringData?.find((d) => d.m_key === 'Hero')?.m_value;
      if (slot !== null && hero !== undefined) spawnedHero.set(slot, heroIdOf(hero));
    } else if (e.m_eventName === 'LevelUp') {
      const slot = lookup.slotOfPlayer(intValue(e, 'PlayerID'));
      const level = intValue(e, 'Level');
      if (slot !== null && level !== null) levels.set(slot, Math.max(levels.get(slot) ?? 0, level));
    } else if (e.m_eventName === 'TalentChosen') {
      const slot = lookup.slotOfPlayer(intValue(e, 'PlayerID'));
      const name = e.m_stringData?.find((d) => d.m_key === 'PurchaseName')?.m_value;
      if (slot === null || name === undefined) continue;
      (talents.get(slot) ?? talents.set(slot, []).get(slot)!).push({
        level: levels.get(slot) ?? 1,
        name,
        gameloop: e._gameloop,
      });
    }
  }

  const players: PlayerRecord[] = [];
  for (const info of lookup.slots) {
    const lobby = lobbySlots.find((s) => s.m_workingSetSlotId === info.slot);
    const user = info.userId !== null ? users[info.userId] : undefined;
    const detail = detailsBySlot.get(info.slot);
    const score = scoreBySlot.get(info.slot);
    const lobbyIndex = lobby === undefined ? -1 : lobbySlots.indexOf(lobby);
    const toonHandle = lobby?.m_toonHandle ?? user?.m_toonHandle ?? '';

    players.push({
      replayId,
      slot: info.slot,
      playerId: info.kind === 'observer' ? null : info.slot + 1,
      userId: info.userId,
      kind: info.kind,
      team: info.team,
      name: user?.m_name ?? detail?.m_name ?? '',
      hero: detail?.m_hero ?? '',
      // The lobby's hero is what the slot had selected when the lobby formed; in brawl
      // and ARAM the hero actually played is only known from the tracker stream.
      heroId: spawnedHero.get(info.slot) ?? lobby?.m_hero ?? '',
      role: heroRoleOf(
        lobbyIndex >= 0 ? attribute(parsed.attributes, lobbyIndex + 1, ROLE_ATTRIBUTE) : null,
      ),
      toon:
        detail && toonHandle
          ? toonOf(
              toonHandle,
              detail.m_toon.m_id,
              detail.m_toon.m_realm,
              detail.m_toon.m_region,
              detail.m_toon.m_programId,
            )
          : null,
      won: detail ? detail.m_result === 1 : null,
      handicap: lobby?.m_handicap ?? detail?.m_handicap ?? 100,
      cosmetics: {
        skin: lobby?.m_skin ?? '',
        mount: lobby?.m_mount ?? '',
        banner: lobby?.m_banner ?? '',
        spray: lobby?.m_spray ?? '',
        announcer: lobby?.m_announcerPack ?? '',
        voiceLine: lobby?.m_voiceLine ?? '',
      },
      silenced: lobby?.m_hasSilencePenalty ?? false,
      voiceSilenced: lobby?.m_hasVoiceSilencePenalty ?? false,
      talents: talents.get(info.slot) ?? [],
      level: score?.stats['Level'] || levels.get(info.slot) || null,
      leftAtLoop: leftAt.get(info.slot) ?? null,
    });
  }
  return players;
}

export function summarize(players: readonly PlayerRecord[]): PlayerSummary[] {
  return players.map((p) => ({
    slot: p.slot,
    name: p.name,
    hero: p.hero,
    heroId: p.heroId,
    team: p.team,
    won: p.won,
    kind: p.kind,
  }));
}

/** `PlayerSpawned` names the hero by unit type (`HeroFalstad`); the id drops the prefix. */
function heroIdOf(unitType: string): string {
  return unitType.startsWith('Hero') ? unitType.slice(4) : unitType;
}

function intValue(e: SStatGameEvent, key: string): number | null {
  return e.m_intData?.find((d) => d.m_key === key)?.m_value ?? null;
}
