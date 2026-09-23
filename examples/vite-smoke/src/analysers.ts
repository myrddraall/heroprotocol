import type { Analyser } from '@myrddraall/heroprotocol-db/analysers';

/** A custom analyser baked into the worker — what a consumer app would add. */
export const heroCount: Analyser<number> = {
  id: 'smoke/hero-count',
  version: 1,
  inputs: ['units'],
  mode: 'ready',
  run: async (ctx) => (await ctx.read('units', { unitClass: 'hero' })).length,
};

export const commandsPerPlayer: Analyser<Record<number, number>> = {
  id: 'smoke/commands-per-player',
  version: 1,
  inputs: ['commands'],
  mode: 'background',
  run: async (ctx) => {
    const out: Record<number, number> = {};
    for (const c of await ctx.read('commands')) out[c.playerSlot] = (out[c.playerSlot] ?? 0) + 1;
    return out;
  },
};

export const deathsNear: Analyser<number, { x: number; y: number; radius: number }> = {
  id: 'smoke/deaths-near',
  version: 1,
  inputs: ['statEvents'],
  mode: 'lazy',
  cache: { maxEntries: 8 },
  run: async (ctx, p) => {
    const deaths = await ctx.read('statEvents', { eventName: 'PlayerDeath' });
    return deaths.filter((d) => {
      const dx = (d.values['PositionX'] as number) - p.x;
      const dy = (d.values['PositionY'] as number) - p.y;
      return Math.hypot(dx, dy) <= p.radius;
    }).length;
  },
};
