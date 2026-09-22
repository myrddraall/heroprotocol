import type { SScoreResultEvent } from '@myrddraall/heroprotocol';
import type { EventRecord, ScoreResultRecord } from '../model/records.js';
import { loopsToSeconds } from '../model/records.js';
import type { PlayerLookup } from './lookup.js';

// Awards are `EndOfMatchAward<Name>Boolean`; one (`MostAltarDamageDone`) lacks the
// suffix, and `GivenToNonwinner` is a flag about the awards rather than one of them.
const AWARD = /^EndOfMatchAward(.+?)(?:Boolean)?$/;
const NOT_AN_AWARD = new Set(['GivenToNonwinner']);

export interface ScoreSnapshot {
  readonly gameloop: number;
  /** Per slot (index) → stat → last value. Empty for slots without data. */
  readonly bySlot: readonly (Readonly<Record<string, number>> | null)[];
}

/** The per-slot value lists in a score event, reduced to each slot's latest value. */
export function snapshotOf(e: SScoreResultEvent): ScoreSnapshot {
  const bySlot: (Record<string, number> | null)[] = [];
  for (const instance of e.m_instanceList) {
    instance.m_values.forEach((samples, slot) => {
      const last = samples.at(-1);
      if (last === undefined) return;
      (bySlot[slot] ??= {})[instance.m_name] = last.m_value;
    });
  }
  for (let i = 0; i < bySlot.length; i++) bySlot[i] ??= null;
  return { gameloop: e._gameloop, bySlot };
}

export interface ScoreResults {
  readonly finalLoop: number | null;
  readonly results: readonly ScoreResultRecord[];
  /** Distinct pre-final snapshots as `ScoreSnapshot` events, in order. */
  readonly snapshots: readonly EventRecord[];
}

/**
 * The last score event is the score screen. Earlier ones are mid-game snapshots —
 * some builds emit hundreds of identical all-zero ones at loop 0 — so they are
 * deduplicated by content and kept as `ScoreSnapshot` events.
 */
export function normalizeScores(
  replayId: string,
  events: readonly SScoreResultEvent[],
  lookup: PlayerLookup,
): ScoreResults {
  if (events.length === 0) return { finalLoop: null, results: [], snapshots: [] };
  const ordered = [...events].sort((a, b) => a._gameloop - b._gameloop);
  const finalEvent = ordered.at(-1)!;
  const final = snapshotOf(finalEvent);

  const results: ScoreResultRecord[] = [];
  final.bySlot.forEach((stats, slot) => {
    if (stats === null) return;
    const team = lookup.teamOfSlot(slot);
    if (team === null) return;
    const kept: Record<string, number> = {};
    const awards: string[] = [];
    for (const [name, value] of Object.entries(stats)) {
      const award = AWARD.exec(name);
      if (award && !NOT_AN_AWARD.has(award[1]!)) {
        if (value === 1) awards.push(award[1]!);
      } else {
        kept[name] = value;
      }
    }
    results.push({ replayId, slot, team, gameloop: final.gameloop, stats: kept, awards });
  });

  const snapshots: EventRecord[] = [];
  let previous = '';
  for (const e of ordered.slice(0, -1)) {
    const snap = snapshotOf(e);
    const key = JSON.stringify(snap.bySlot);
    if (key === previous) continue;
    previous = key;
    const scores: Record<number, Readonly<Record<string, number>>> = {};
    snap.bySlot.forEach((stats, slot) => {
      if (stats !== null && lookup.teamOfSlot(slot) !== null) scores[slot] = stats;
    });
    snapshots.push({
      replayId,
      gameloop: e._gameloop,
      seconds: loopsToSeconds(e._gameloop),
      kind: 'ScoreSnapshot',
      playerSlot: null,
      team: null,
      data: { scores },
    });
  }
  return { finalLoop: final.gameloop, results, snapshots };
}
