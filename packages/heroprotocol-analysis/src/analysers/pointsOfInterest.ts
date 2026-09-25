import type { Analyser, Team, UnitRecord } from '@myrddraall/heroprotocol-db';
import { int, NS, statEvents, withSeq } from './shared.js';

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

export interface PointOfInterestRow {
  readonly seq: number;
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

export interface MapInfoRow {
  readonly width: number | null;
  readonly height: number | null;
  readonly points: number;
}

export type PointsOfInterestTables = {
  readonly pointsOfInterest: PointOfInterestRow[];
  readonly mapInfo: MapInfoRow[];
};

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
export const pointsOfInterest: Analyser<PointsOfInterestTables> = {
  id: `${NS}points-of-interest`,
  version: 2,
  tables: {
    pointsOfInterest: '[replayId+seq], replayId, [replayId+type], team',
    mapInfo: 'replayId',
  },
  inputs: ['units', 'statEvents'],
  mode: 'background',
  async run(ctx) {
    const [structures, cores, start, camps] = await Promise.all([
      ctx.read('units', { unitClass: 'structure' }),
      ctx.read('units', { unitClass: 'core' }),
      statEvents(ctx, 'GameStart'),
      statEvents(ctx, 'JungleCampInit'),
    ]);
    const points: Omit<PointOfInterestRow, 'seq'>[] = [];
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
    points.sort((a, b) => a.type.localeCompare(b.type) || a.x - b.x || a.y - b.y);
    const gs = start[0];
    return {
      pointsOfInterest: withSeq(points),
      mapInfo: [
        {
          width: gs ? int(gs, 'MapSizeX') : null,
          height: gs ? int(gs, 'MapSizeY') : null,
          points: points.length,
        },
      ],
    };
  },
};
