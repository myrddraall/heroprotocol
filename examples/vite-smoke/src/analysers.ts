import type { Analyser } from '@myrddraall/heroprotocol-db/analysers';

/** A custom analyser baked into the worker — what a consumer app would add. */
export const heroCount: Analyser<{ heroCount: { n: number }[] }> = {
  id: 'smoke/hero-count',
  version: 1,
  tables: { heroCount: 'replayId' },
  inputs: ['units'],
  mode: 'ready',
  run: async (ctx) => ({
    heroCount: [{ n: (await ctx.read('units', { unitClass: 'hero' })).length }],
  }),
};

export const commandsPerPlayer: Analyser<{ commandsPerPlayer: { slot: number; n: number }[] }> = {
  id: 'smoke/commands-per-player',
  version: 1,
  tables: { commandsPerPlayer: '[replayId+slot], replayId, n' },
  inputs: ['commands'],
  mode: 'background',
  run: async (ctx) => {
    const per = new Map<number, number>();
    for (const c of await ctx.read('commands'))
      per.set(c.playerSlot, (per.get(c.playerSlot) ?? 0) + 1);
    return { commandsPerPlayer: [...per].map(([slot, n]) => ({ slot, n })) };
  },
};

export const deathsNear: Analyser<
  { deathsNear: { total: number }[] },
  { x: number; y: number; radius: number }
> = {
  id: 'smoke/deaths-near',
  version: 1,
  tables: { deathsNear: '[replayId+paramsHash], replayId' },
  inputs: ['statEvents'],
  mode: 'lazy',
  cache: { maxEntries: 8 },
  run: async (ctx, p) => {
    const deaths = await ctx.read('statEvents', { eventName: 'PlayerDeath' });
    const total = deaths.filter((d) => {
      const dx = (d.values['PositionX'] as number) - p.x;
      const dy = (d.values['PositionY'] as number) - p.y;
      return Math.hypot(dx, dy) <= p.radius;
    }).length;
    return { deathsNear: [{ total }] };
  },
};
