import type { RawEvent, SStatGameEvent } from '@myrddraall/heroprotocol';
import { GAME_START_LOOP } from '../model/records.js';

/**
 * Stat events that carry the game's clock (`GameTime`, seconds) alongside their loop: the XP
 * breakdowns first (on whole minutes, exact), the others where a replay has none (they round a
 * loop either way).
 */
const CLOCKED = [['PeriodicXPBreakdown'], ['JungleCampCapture', 'TownStructureDeath']] as const;

/**
 * The loop the game's clock starts from: where the replay's own `GameTime` values put it (the
 * most common, as a game's last XP breakdown is off the minute), or `GAME_START_LOOP` when the
 * replay has none (a game left before the first minute).
 */
export function gameStartLoop(tracker: readonly RawEvent[]): number {
  const stats = tracker.filter(
    (e): e is SStatGameEvent => e._event === 'NNet.Replay.Tracker.SStatGameEvent',
  );
  for (const names of CLOCKED) {
    const counts = new Map<number, number>();
    for (const s of stats) {
      if (!(names as readonly string[]).includes(s.m_eventName)) continue;
      const time = s.m_fixedData?.find((d) => d.m_key === 'GameTime');
      if (!time) continue;
      const start = s._gameloop - Math.round(fixed(time.m_value) * 16);
      counts.set(start, (counts.get(start) ?? 0) + 1);
    }
    let best: number | null = null;
    let most = 0;
    for (const [start, n] of counts)
      if (n > most || (n === most && best !== null && start < best)) [best, most] = [start, n];
    if (best !== null) return best;
  }
  return GAME_START_LOOP;
}

/** Windows FILETIME (100 ns ticks since 1601-01-01) → ISO-8601 UTC. */
export function filetimeToIso(filetime: number): string {
  return new Date(filetime / 10000 - 11644473600000).toISOString();
}

/** `m_timeLocalOffset` (100 ns ticks) → hours. */
export function ticksToHours(ticks: number): number {
  return ticks / 10000000 / 3600;
}

/** Fixed-point map coordinates and stat values carry 12 fractional bits. */
export function fixed(value: number): number {
  return value / 4096;
}
