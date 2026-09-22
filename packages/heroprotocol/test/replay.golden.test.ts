import { describe, expect, it } from 'vitest';
import { openReplay } from '../src/replay/openReplay.js';
import { goldenFor, localReplays, numericSum, readReplay } from './util/node.js';

/**
 * End-to-end against real replays, asserted against Blizzard's own Python
 * decoders (test/fixtures/golden). The replays are not committed; fetch them
 * with `pnpm fixtures:fetch`. Specs skip when none are present.
 */
const replays = localReplays().filter((f) => goldenFor(f) !== undefined);

describe.skipIf(replays.length === 0)('real replays vs the Python oracle', () => {
  describe.each(replays)('%s', (file) => {
    const golden = goldenFor(file)!;

    it('decodes every section with the exact protocol', async () => {
      const r = await openReplay(readReplay(file));
      expect(r.build).toBe(golden.build);
      expect(r.protocol).toBe(r.diagnostics.protocol);
      expect(r.diagnostics.complete).toBe(true);
      for (const [name, d] of Object.entries(r.diagnostics.sections)) {
        expect(d.status, name).toBe('ok');
        if (name !== 'header' && name !== 'attributes') expect(d.provenance, name).toBe('exact');
      }
    });

    it('header, details, initData and attributes match byte for byte', async () => {
      const r = await openReplay(readReplay(file), {
        sections: ['header', 'details', 'initData', 'attributes'],
      });
      expect(r.header).toEqual(golden.header);
      expect(r.details).toEqual(golden.details);
      expect(r.initData).toEqual(golden.initData);
      expect(r.attributes).toEqual(golden.attributes);
    });

    it.each([
      ['trackerEvents', 'tracker'],
      ['messageEvents', 'message'],
      ['gameEvents', 'game'],
    ] as const)(
      '%s match the oracle in count, kinds, checksum and boundary events',
      async (section, key) => {
        const r = await openReplay(readReplay(file), { sections: [section] });
        const events = r[section]!;
        const g = golden[key];
        expect(events).toHaveLength(g.count);
        const kinds: Record<string, number> = {};
        for (const e of events) kinds[e._event] = (kinds[e._event] ?? 0) + 1;
        expect(kinds).toEqual(g.countsByKind);
        expect(numericSum(events)).toBe(g.numericSum);
        expect(events.at(-1)?._gameloop).toBe(g.lastGameloop);
        expect(events.slice(0, 5)).toEqual(g.first);
        expect(events.slice(-3)).toEqual(g.last);
      },
    );
  });
});
