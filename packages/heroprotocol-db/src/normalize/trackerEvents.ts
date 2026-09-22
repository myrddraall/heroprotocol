import type {
  RawEvent,
  SHeroBannedEvent,
  SHeroPickedEvent,
  SHeroSwappedEvent,
  SUpgradeEvent,
} from '@myrddraall/heroprotocol';
import type { DraftBan, DraftPick, EventRecord, Team } from '../model/records.js';
import { loopsToSeconds } from '../model/records.js';
import type { PlayerLookup } from './lookup.js';

export interface DraftEvents {
  readonly bans: readonly DraftBan[];
  readonly picks: readonly DraftPick[];
  readonly events: readonly EventRecord[];
}

/** Draft and upgrade tracker events → `events` rows, plus the draft summary. */
export function normalizeTrackerEvents(
  replayId: string,
  tracker: readonly RawEvent[],
  lookup: PlayerLookup,
): DraftEvents {
  const bans: DraftBan[] = [];
  const picks: DraftPick[] = [];
  const events: EventRecord[] = [];
  const push = (
    e: RawEvent,
    kind: EventRecord['kind'],
    playerSlot: number | null,
    team: Team | null,
    data: Record<string, unknown>,
  ): void => {
    events.push({
      replayId,
      gameloop: e._gameloop,
      seconds: loopsToSeconds(e._gameloop),
      kind,
      playerSlot,
      team,
      data,
    });
  };

  for (const e of tracker) {
    switch (e._event) {
      case 'NNet.Replay.Tracker.SHeroBannedEvent': {
        const b = e as SHeroBannedEvent;
        // m_controllingTeam is 1-based in the tracker stream.
        const team: Team | null =
          b.m_controllingTeam === 1 || b.m_controllingTeam === 2
            ? ((b.m_controllingTeam - 1) as Team)
            : null;
        if (team !== null)
          bans.push({ team, heroId: b.m_hero, order: bans.length + 1, gameloop: e._gameloop });
        push(e, 'HeroBanned', null, team, { heroId: b.m_hero, order: bans.length });
        break;
      }
      case 'NNet.Replay.Tracker.SHeroPickedEvent': {
        const p = e as SHeroPickedEvent;
        const slot = lookup.slotOfPlayer(p.m_controllingPlayer);
        if (slot !== null)
          picks.push({ slot, heroId: p.m_hero, order: picks.length + 1, gameloop: e._gameloop });
        push(e, 'HeroPicked', slot, lookup.teamOfSlot(slot), {
          heroId: p.m_hero,
          order: picks.length,
        });
        break;
      }
      case 'NNet.Replay.Tracker.SHeroSwappedEvent': {
        const s = e as SHeroSwappedEvent;
        const slot = lookup.slotOfPlayer(s.m_newControllingPlayer);
        push(e, 'HeroSwapped', slot, lookup.teamOfSlot(slot), { heroId: s.m_hero });
        break;
      }
      case 'NNet.Replay.Tracker.SUpgradeEvent': {
        const u = e as SUpgradeEvent;
        const slot = lookup.slotOfPlayer(u.m_playerId);
        push(e, 'Upgrade', slot, lookup.teamOfPlayer(u.m_playerId), {
          upgrade: u.m_upgradeTypeName,
          count: u.m_count,
        });
        break;
      }
      default:
        break;
    }
  }
  return { bans, picks, events };
}
