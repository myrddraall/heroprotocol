import { describe, expect, it } from 'vitest';
import type { PlayerRecord, ReplayRecord } from '../src/model/records.js';
import { NORMALIZE_VERSION } from '../src/model/records.js';
import { goldenFor, localReplays, makeGolden, normalizeLocal } from './util/node.js';

/**
 * End-to-end over the real fixture replays (parser package, `pnpm run
 * fetch.fixtures`), against the committed normalized goldens and a set of
 * invariants that must hold for any replay.
 */
const replays = localReplays();

describe.skipIf(replays.length === 0)('normalizeReplay on real replays', () => {
  describe.each(replays)('%s', (file) => {
    it('matches the committed golden', async () => {
      const golden = goldenFor(file);
      expect(golden, 'no golden committed — run `pnpm run generate.goldens`').toBeDefined();
      const n = await normalizeLocal(file);
      expect(makeGolden(file, n)).toEqual(golden);
    });

    it('holds the model invariants', async () => {
      const n = await normalizeLocal(file);
      const r: ReplayRecord = n.replay;
      expect(r.id).toMatch(/^[0-9a-f]{40}$/);
      expect(r.fingerprintSource).toBe('lobby');
      expect(r.normalizeVersion).toBe(NORMALIZE_VERSION);
      expect(r.durationSeconds).toBe(r.durationLoops / 16);
      expect(r.mode).not.toBe('unknown');
      expect(r.winningTeam === 0 || r.winningTeam === 1).toBe(true);
      expect(Object.values(r.sections).every((s) => s === 'ok')).toBe(true);
      for (const [name, count] of Object.entries(r.rowCounts)) {
        expect((n as unknown as Record<string, unknown[]>)[name]).toHaveLength(count);
      }

      const players: readonly PlayerRecord[] = n.players;
      expect(players.filter((p) => p.kind === 'player')).toHaveLength(10);
      for (const p of players) {
        expect(p.playerId).toBe(p.slot + 1);
        expect(p.userId).toBe(p.slot);
        expect(p.hero).not.toBe('');
        expect(p.heroId).not.toBe('');
        expect(p.talents.length).toBeGreaterThan(0);
        expect(p.level).toBeGreaterThan(0);
        expect(p.won).toBe(p.team === r.winningTeam);
        expect(p.toon?.region).toBe(r.region);
      }
      expect(r.players.map((p) => p.slot)).toEqual(players.map((p) => p.slot));

      // one hero unit per player, owned by that player
      const heroes = n.units.filter((u) => u.unitClass === 'hero');
      expect(heroes).toHaveLength(10);
      expect(new Set(heroes.map((u) => u.ownerSlot))).toEqual(new Set(players.map((p) => p.slot)));
      for (const u of heroes)
        expect(u.ownerTeam).toBe(players.find((p) => p.slot === u.ownerSlot)!.team);

      // the score screen is the final one, every player has one, awards are stripped out of stats
      expect(n.scoreResults).toHaveLength(10);
      for (const s of n.scoreResults) {
        expect(s.gameloop).toBe(r.finalScoreLoop);
        expect(Object.keys(s.stats).filter((k) => k.startsWith('EndOfMatchAward'))).toEqual([
          'EndOfMatchAwardGivenToNonwinner',
        ]);
        expect(s.stats['Takedowns']).toBeGreaterThanOrEqual(0);
      }
      expect(n.scoreResults.filter((s) => s.awards.includes('MVP')).length).toBeLessThanOrEqual(1);

      // every stat event with a PlayerID resolved to a real slot; PlayerDeath collects killers
      for (const s of n.statEvents) {
        if (typeof s.values['PlayerID'] === 'number')
          expect(s.playerSlot).toBe((s.values['PlayerID'] as number) - 1);
        expect(s.seconds).toBe(s.gameloop / 16);
      }
      const death = n.statEvents.find(
        (s) => s.eventName === 'PlayerDeath' && s.lists?.['KillingPlayer'],
      );
      expect(death).toBeDefined();

      // commands: every row belongs to a player, in gameloop order
      expect(n.commands.length).toBeGreaterThan(10000);
      const slots = new Set(players.map((p) => p.slot));
      let last = 0;
      for (const c of n.commands) {
        expect(slots.has(c.playerSlot)).toBe(true);
        expect(c.gameloop).toBeGreaterThanOrEqual(last);
        last = c.gameloop;
      }
      // chat duplicates from the game stream are not in events
      expect(n.events.some((e) => (e.kind as string) === 'Chat')).toBe(false);
      for (let i = 1; i < n.events.length; i++)
        expect(n.events[i]!.gameloop).toBeGreaterThanOrEqual(n.events[i - 1]!.gameloop);
    });

    it('is deterministic', async () => {
      const a = await normalizeLocal(file);
      const b = await normalizeLocal(file);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
  });
});
