import type { Analyser, Team } from '@myrddraall/heroprotocol-db';
import { all, int, NS, statEvents } from './shared.js';

export interface DeathHeatmapParams {
  /** Deaths of this team only. */
  readonly team?: Team;
  /** Deaths of this player only. */
  readonly slot?: number;
  /** Deaths caused by this player (as one of the killers). */
  readonly killerSlot?: number;
  /** Cell size in map units (default 8). */
  readonly cell?: number;
}

export interface DeathHeatmap {
  readonly cell: number;
  readonly mapSize: { readonly x: number; readonly y: number } | null;
  readonly total: number;
  readonly cells: readonly { readonly x: number; readonly y: number; readonly count: number }[];
}

/** Where players died, bucketed on a grid. Parameterized and lazy; the cache keeps the last 32 filters. */
export const deathHeatmap: Analyser<DeathHeatmap, DeathHeatmapParams | undefined> = {
  id: `${NS}death-heatmap`,
  version: 1,
  inputs: ['statEvents'],
  mode: 'lazy',
  cache: { maxEntries: 32 },
  async run(ctx, params) {
    const cell = params?.cell && params.cell > 0 ? params.cell : 8;
    const [deaths, start] = await Promise.all([
      statEvents(ctx, 'PlayerDeath'),
      statEvents(ctx, 'GameStart'),
    ]);
    const counts = new Map<string, { x: number; y: number; count: number }>();
    let total = 0;
    for (const d of deaths) {
      if (params?.slot !== undefined && d.playerSlot !== params.slot) continue;
      if (params?.team !== undefined && d.team !== params.team) continue;
      if (
        params?.killerSlot !== undefined &&
        !all(d, 'KillingPlayer')
          .map(Number)
          .includes(params.killerSlot + 1)
      )
        continue;
      const px = int(d, 'PositionX');
      const py = int(d, 'PositionY');
      if (px === null || py === null) continue;
      const x = Math.floor(px / cell);
      const y = Math.floor(py / cell);
      const key = `${x},${y}`;
      const c = counts.get(key) ?? { x, y, count: 0 };
      c.count++;
      counts.set(key, c);
      total++;
    }
    const gs = start[0];
    return {
      cell,
      mapSize: gs ? { x: int(gs, 'MapSizeX') ?? 0, y: int(gs, 'MapSizeY') ?? 0 } : null,
      total,
      cells: [...counts.values()].sort((a, b) => a.y - b.y || a.x - b.x),
    };
  },
};
