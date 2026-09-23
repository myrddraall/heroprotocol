import type { SStatGameEvent, SStatGameEventData } from '@myrddraall/heroprotocol';
import type { StatEventRecord, StatValue, Team } from '../model/records.js';
import { loopsToSeconds } from '../model/records.js';
import type { PlayerLookup } from './lookup.js';
import { fixed } from './time.js';

const PLAYER_KEYS = ['PlayerID', 'Player'];
const TEAM_KEYS = ['Team', 'TeamID', 'Firing Team'];

/**
 * Flatten one `SStatGameEvent`. String, int and fixed data become one `values` map
 * (fixed-point divided out); a key repeated within the event (e.g. `PlayerDeath`'s
 * several `KillingPlayer`s) goes to `lists` so nothing is lost.
 */
export function normalizeStatEvent(
  replayId: string,
  e: SStatGameEvent,
  lookup: PlayerLookup,
): StatEventRecord {
  const values: Record<string, StatValue> = {};
  const lists: Record<string, StatValue[]> = {};
  const seen = new Map<string, number>();

  const put = (key: string, value: StatValue): void => {
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n === 1) {
      values[key] = value;
    } else {
      if (n === 2) {
        lists[key] = [values[key]!];
        delete values[key];
      }
      lists[key]!.push(value);
    }
  };
  const each = <T extends StatValue>(
    list: readonly SStatGameEventData<T>[] | null,
    map: (v: T) => StatValue,
  ): void => {
    for (const d of list ?? []) put(d.m_key, map(d.m_value));
  };
  each(e.m_stringData, (v) => v);
  each(e.m_intData, (v) => v);
  each(e.m_fixedData, (v) => fixed(v));

  const playerKey = PLAYER_KEYS.find((k) => typeof values[k] === 'number');
  const teamKey = TEAM_KEYS.find((k) => typeof values[k] === 'number');
  const playerSlot =
    playerKey === undefined ? null : lookup.slotOfPlayer(values[playerKey] as number);
  // Team values in stat events are 1-based (PlayerInit, PeriodicXPBreakdown, JungleCampCapture).
  let team: Team | null = null;
  if (teamKey !== undefined) {
    const t = values[teamKey] as number;
    team = t === 1 || t === 2 ? ((t - 1) as Team) : null;
  }
  if (team === null && playerSlot !== null) team = lookup.teamOfSlot(playerSlot);

  const record: StatEventRecord = {
    replayId,
    seq: 0,
    gameloop: e._gameloop,
    seconds: loopsToSeconds(e._gameloop),
    eventName: e.m_eventName,
    playerSlot,
    team,
    values,
    ...(Object.keys(lists).length > 0 ? { lists } : {}),
  };
  return record;
}
