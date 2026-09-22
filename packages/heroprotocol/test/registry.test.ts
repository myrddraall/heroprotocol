import { describe, expect, it } from 'vitest';
import { BUILD_INDEX } from '../src/protocol/data/index.js';
import { ProtocolRegistry } from '../src/protocol/registry.js';

describe('ProtocolRegistry', () => {
  const registry = new ProtocolRegistry(BUILD_INDEX);

  it('answers exact builds', () => {
    // A representative is the LOWEST build of its lineage, so it is usually not the build itself.
    expect(registry.exact(66488)).toBe(BUILD_INDEX['66488']);
    expect(registry.exact(66488)).toBe(65579);
    expect(registry.exact(96477)).toBe(85027);
    expect(registry.exact(12345)).toBeUndefined();
    expect(registry.has(96477)).toBe(true);
    expect(registry.has(96478)).toBe(false);
  });

  it('offers exact, nearest-lower, nearest-higher — at most three, no repeats', () => {
    // 66488 is published: exact first, then the neighbours' representatives
    const c = registry.candidates(66488);
    expect(c[0]).toBe(BUILD_INDEX['66488']);
    expect(c.length).toBeLessThanOrEqual(3);
    expect(new Set(c).size).toBe(c.length);
  });

  it('for an unpublished build newer than everything, tries the newest lineage first', () => {
    expect(registry.candidates(99999)).toEqual([85027]);
  });

  it('for an unpublished build inside a run, nearest-lower and nearest-higher agree', () => {
    // 90000 sits inside 85027..96477, all one protocol
    expect(registry.candidates(90000)).toEqual([85027]);
  });

  it('for an unpublished build between two lineages, offers both', () => {
    // 84249 (last of 69947 lineage) < 84500 < 85027
    expect(registry.candidates(84500)).toEqual([69947, 85027]);
  });

  it('learns new builds', () => {
    const r = new ProtocolRegistry(BUILD_INDEX);
    r.learn({ '99001': 99001 });
    expect(r.exact(99001)).toBe(99001);
    expect(r.newest).toBe(99001);
    expect(r.candidates(99500)).toEqual([99001]);
  });
});
