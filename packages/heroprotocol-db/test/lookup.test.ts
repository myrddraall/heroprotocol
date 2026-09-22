import { describe, expect, it } from 'vitest';
import type { ParsedReplay, RawEvent } from '@myrddraall/heroprotocol';
import { PlayerLookup } from '../src/normalize/lookup.js';
import { localReplays, parseLocal } from './util/node.js';

function setup(playerId: number, userId: number | null, slotId: number | null): RawEvent {
  return {
    _event: 'NNet.Replay.Tracker.SPlayerSetupEvent',
    _eventid: 9,
    _gameloop: 0,
    _bits: 0,
    m_playerId: playerId,
    m_type: 1,
    m_userId: userId,
    m_slotId: slotId,
  };
}

describe('PlayerLookup', () => {
  it('resolves players from details when the lobby did not decode, with identity user ids', () => {
    const parsed = {
      header: { m_elapsedGameLoops: 1 },
      details: {
        m_playerList: [
          { m_workingSetSlotId: 3, m_teamId: 0, m_control: 2 },
          { m_workingSetSlotId: 7, m_teamId: 1, m_control: 3 },
        ],
      },
      trackerEvents: [],
    } as unknown as ParsedReplay;
    const lookup = new PlayerLookup(parsed);
    expect(lookup.slots.map((s) => [s.slot, s.kind, s.team, s.userId])).toEqual([
      [3, 'player', 0, 3],
      [7, 'ai', 1, 7],
    ]);
    expect(lookup.slotOfPlayer(4)).toBe(3); // playerId - 1 fallback
    expect(lookup.slotOfUser(7)).toBe(7);
    expect(lookup.slotOfUser(9)).toBeNull(); // no such slot
    expect(lookup.teamOfPlayer(11)).toBe(0);
    expect(lookup.teamOfPlayer(12)).toBe(1);
    expect(lookup.teamOfPlayer(0)).toBeNull();
  });

  it('prefers SPlayerSetupEvent over the slot arithmetic', () => {
    const parsed = {
      header: { m_elapsedGameLoops: 1 },
      details: {
        m_playerList: [
          { m_workingSetSlotId: 0, m_teamId: 0, m_control: 2 },
          { m_workingSetSlotId: 5, m_teamId: 1, m_control: 2 },
        ],
      },
      trackerEvents: [setup(1, 0, 5), setup(2, 1, 0)],
    } as unknown as ParsedReplay;
    const lookup = new PlayerLookup(parsed);
    expect(lookup.slotOfPlayer(1)).toBe(5);
    expect(lookup.slotOfPlayer(2)).toBe(0);
    expect(lookup.teamOfPlayer(1)).toBe(1);
  });

  describe.skipIf(localReplays().length === 0)('against real replays', () => {
    it.each(localReplays())(
      '%s: PlayerID − 1 === slot and userId === slot for every player',
      async (file) => {
        const parsed = await parseLocal(file);
        const lookup = new PlayerLookup(parsed);
        const setups = parsed.trackerEvents!.filter(
          (e) => e._event === 'NNet.Replay.Tracker.SPlayerSetupEvent',
        );
        expect(setups.length).toBeGreaterThan(0);
        for (const e of setups) {
          const playerId = e['m_playerId'] as number;
          expect(e['m_slotId']).toBe(playerId - 1);
          expect(lookup.slotOfPlayer(playerId)).toBe(playerId - 1);
          expect(lookup.slotOfUser(e['m_userId'] as number)).toBe(playerId - 1);
        }
        const players = lookup.slots.filter((s) => s.kind !== 'observer');
        expect(players).toHaveLength(10);
        expect(players.filter((s) => s.team === 0)).toHaveLength(5);
      },
    );
  });
});
