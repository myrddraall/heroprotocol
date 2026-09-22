import { describe, expect, it } from 'vitest';
import { openReplay } from '../src/replay/openReplay.js';
import { BUILD_INDEX, BUNDLED } from '../src/protocol/data/index.js';
import type { ProtocolSource } from '../src/protocol/source.js';
import { Protocol } from '../src/protocol/runtime.js';
import { NOISY_GAME_EVENTS } from '../src/types/events.js';
import { TruncatedError } from '../src/errors.js';
import { MPQArchive } from '@myrddraall/mpq';
import { localReplays, readReplay } from './util/node.js';

const OLD = localReplays().find((f) => f.startsWith('towers-of-doom'));

/**
 * A source whose index knows only the newest lineage — as if 66488 had never
 * been published — while still able to load the bootstrap protocol on request.
 */
function newestOnlySource(): ProtocolSource {
  return {
    name: 'newest-only',
    async index() {
      return { '85027': 85027, '96477': 85027 };
    },
    async load(build) {
      if (build === 29406) return BUNDLED[29406]!();
      if (build === 85027 || build === 96477) return BUNDLED[85027]!();
      return undefined;
    },
  };
}

describe.skipIf(OLD === undefined)('best-effort parsing', () => {
  it('decodes a 2018 replay with the 2026 protocol, losing only initData', async () => {
    // Reproduces the experiment that justified nearest-protocol fallback: the
    // versioned sections and the (unchanged) game/message schemas survive a
    // ten-year protocol gap; only the bit-packed lobby struct drifted.
    const r = await openReplay(readReplay(OLD!), {
      source: newestOnlySource(),
      dropGameEvents: NOISY_GAME_EVENTS,
    });
    expect(r.build).toBe(66488);
    expect(r.protocol).toBe(85027);
    expect(r.diagnostics.provenance).toBe('nearest');
    const s = r.diagnostics.sections;
    expect(s.details.status).toBe('ok');
    expect(s.trackerEvents.status).toBe('ok');
    expect(s.messageEvents.status).toBe('ok');
    expect(s.gameEvents.status).toBe('ok');
    expect(s.attributes.status).toBe('ok');
    expect(s.initData.status).toBe('failed');
    expect(s.initData.attempts.length).toBeGreaterThan(0);
    expect(s.initData.attempts.every((a) => a.error !== undefined)).toBe(true);
    expect(r.diagnostics.complete).toBe(false);
    expect(r.initData).toBeUndefined();
    expect(r.details?.m_title).toBe('Towers of Doom');
    expect(r.trackerEvents?.length).toBe(8446);
  });

  it('drops noisy game events without changing what remains', async () => {
    const all = await openReplay(readReplay(OLD!), { sections: ['gameEvents'] });
    const kept = await openReplay(readReplay(OLD!), {
      sections: ['gameEvents'],
      dropGameEvents: NOISY_GAME_EVENTS,
    });
    expect(all.gameEvents!.length).toBe(249114);
    expect(kept.gameEvents!.length).toBeLessThan(all.gameEvents!.length / 4);
    expect(kept.gameEvents!.every((e) => !NOISY_GAME_EVENTS.has(e._event))).toBe(true);
    const cmds = (n: readonly { _event: string }[]) =>
      n.filter((e) => e._event === 'NNet.Game.SCmdEvent').length;
    expect(cmds(kept.gameEvents!)).toBe(cmds(all.gameEvents!));
  });

  it('keeps the events decoded before a truncated stream ends', async () => {
    const mpq = new MPQArchive(readReplay(OLD!));
    const tracker = mpq.readFile('replay.tracker.events')!;
    const protocol = new Protocol(await BUNDLED[BUILD_INDEX['66488']!]!());
    const truncated = tracker.subarray(0, Math.floor(tracker.byteLength / 2));
    const events: unknown[] = [];
    expect(() => {
      for (const e of protocol.trackerEvents(truncated)) events.push(e);
    }).toThrow(TruncatedError);
    expect(events.length).toBeGreaterThan(1000);
  });

  it('decodes only the requested sections and marks the rest skipped', async () => {
    const r = await openReplay(readReplay(OLD!), { sections: ['details'] });
    expect(r.details).toBeDefined();
    expect(r.trackerEvents).toBeUndefined();
    expect(r.diagnostics.sections.trackerEvents.status).toBe('skipped');
    expect(r.diagnostics.sections.header.status).toBe('ok');
    expect(r.diagnostics.complete).toBe(true);
  });

  it('reports progress per section', async () => {
    const seen = new Set<string>();
    await openReplay(readReplay(OLD!), {
      sections: ['trackerEvents', 'details'],
      onProgress: (p) => seen.add(p.section),
    });
    expect(seen).toContain('trackerEvents');
    expect(seen).toContain('details');
  });
});

describe('openReplay input handling', () => {
  it('rejects bytes that are not a replay', async () => {
    await expect(openReplay(new TextEncoder().encode('nope'))).rejects.toThrow(/not a replay/);
  });
});
