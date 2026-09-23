import type { Analyser, Team, UnitRecord } from '@myrddraall/heroprotocol-db';
import { int, NS, statEvents } from './shared.js';

export type PoiType =
  | 'core'
  | 'town-hall'
  | 'tower'
  | 'moonwell'
  | 'gate'
  | 'wall'
  | 'watch-tower'
  | 'jungle-camp'
  | 'structure';

export interface PointOfInterest {
  readonly type: PoiType;
  readonly x: number;
  readonly y: number;
  readonly team: Team | null;
  readonly unitType: string | null;
  readonly unitTag: number | null;
  readonly campId: number | null;
  /** Gameloop the structure died, when it did. */
  readonly diedAtLoop: number | null;
}

export interface PointsOfInterest {
  readonly mapSize: { readonly x: number; readonly y: number } | null;
  readonly points: readonly PointOfInterest[];
}

function poiType(u: UnitRecord): PoiType | null {
  const t = u.bornType ?? u.type;
  if (u.unitClass === 'core') return 'core';
  if (t.startsWith('TownTownHall')) return 'town-hall';
  if (t.startsWith('TownCannonTower')) return 'tower';
  if (t.startsWith('TownMoonwell')) return 'moonwell';
  if (t.startsWith('TownGate')) return 'gate';
  if (t.startsWith('TownWall')) return 'wall';
  if (t.endsWith('WatchTower')) return 'watch-tower';
  if (u.unitClass === 'structure') return 'structure';
  return null;
}

/** Static map features from the units and camp-init events; map-specific mechanics are out of scope. */
export const pointsOfInterest: Analyser<PointsOfInterest> = {
  id: `${NS}points-of-interest`,
  version: 1,
  inputs: ['units', 'statEvents'],
  mode: 'background',
  async run(ctx) {
    const [structures, cores, start, camps] = await Promise.all([
      ctx.read('units', { unitClass: 'structure' }),
      ctx.read('units', { unitClass: 'core' }),
      statEvents(ctx, 'GameStart'),
      statEvents(ctx, 'JungleCampInit'),
    ]);
    const points: PointOfInterest[] = [];
    for (const u of [...cores, ...structures]) {
      const type = poiType(u);
      if (type === null) continue;
      points.push({
        type,
        x: u.bornAt.x,
        y: u.bornAt.y,
        team: u.ownerTeam,
        unitType: u.type,
        unitTag: u.tag,
        campId: null,
        diedAtLoop: u.diedAtLoop,
      });
    }
    for (const c of camps) {
      points.push({
        type: 'jungle-camp',
        x: int(c, 'PositionX') ?? 0,
        y: int(c, 'PositionY') ?? 0,
        team: null,
        unitType: null,
        unitTag: null,
        campId: int(c, 'CampID'),
        diedAtLoop: null,
      });
    }
    const gs = start[0];
    const mapSize = gs ? { x: int(gs, 'MapSizeX') ?? 0, y: int(gs, 'MapSizeY') ?? 0 } : null;
    points.sort((a, b) => a.type.localeCompare(b.type) || a.x - b.x || a.y - b.y);
    return { mapSize, points };
  },
};
