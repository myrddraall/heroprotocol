import type {
  RawEvent,
  SUnitBornEvent,
  SUnitDiedEvent,
  SUnitInitEvent,
  SUnitOwnerChangeEvent,
  SUnitRevivedEvent,
  SUnitTypeChangeEvent,
} from '@myrddraall/heroprotocol';
import { unitTag } from '@myrddraall/heroprotocol';
import type { EventRecord, Team, UnitClass, UnitRecord } from '../model/records.js';
import { loopsToSeconds } from '../model/records.js';
import type { PlayerLookup } from './lookup.js';

const CORES = new Set(['KingsCore', 'VanndarStormpike', 'DrekThar']);
const MINIONS = new Set(['FootmanMinion', 'RangedMinion', 'WizardMinion', 'CatapultMinion']);

/**
 * Classify a unit by its type name and owner. Heuristic by necessity — the
 * protocol carries no unit taxonomy — but stable across builds for the names
 * that matter: heroes, lane minions, mercenaries, structures, the core, globes.
 * A player-owned unit that is none of those is a summon.
 */
export function classifyUnit(type: string, ownerPlayerId: number | null): UnitClass {
  if (CORES.has(type)) return 'core';
  if (type.startsWith('Hero')) return 'hero';
  if (MINIONS.has(type)) return 'minion';
  if (type.includes('RegenGlobe') || type.includes('ExperienceGlobe')) return 'globe';
  if (type.startsWith('Merc') || type.startsWith('JungleCamp') || type.includes('Boss'))
    return 'mercenary';
  if (
    type.startsWith('Town') ||
    type.startsWith('BaseProtection') ||
    type.startsWith('HallOfStorms')
  )
    return 'structure';
  if (ownerPlayerId !== null && ownerPlayerId >= 1 && ownerPlayerId <= 10) return 'summon';
  return 'other';
}

interface Draft {
  tag: number;
  tagIndex: number;
  tagRecycle: number;
  type: string;
  bornType: string;
  ownerPlayerId: number | null;
  bornAtLoop: number;
  bornAt: { x: number; y: number };
  diedAtLoop: number | null;
  diedAt: { x: number; y: number } | null;
  killerPlayerId: number | null;
  killerUnitTag: number | null;
  revived: number;
  typeChanges: { gameloop: number; type: string }[];
  ownerChanges: { gameloop: number; slot: number | null; team: Team | null }[];
}

export interface Units {
  readonly units: readonly UnitRecord[];
  /** `UnitOwnerChanged`, `UnitTypeChanged` and `UnitRevived` as events, for timelines. */
  readonly events: readonly EventRecord[];
}

/** Merge the unit tracker events into one lifespan row per unit tag. */
export function normalizeUnits(
  replayId: string,
  tracker: readonly RawEvent[],
  lookup: PlayerLookup,
): Units {
  const drafts = new Map<number, Draft>();
  const events: EventRecord[] = [];

  const born = (e: SUnitBornEvent | SUnitInitEvent): void => {
    const tag = unitTag(e.m_unitTagIndex, e.m_unitTagRecycle);
    drafts.set(tag, {
      tag,
      tagIndex: e.m_unitTagIndex,
      tagRecycle: e.m_unitTagRecycle,
      type: e.m_unitTypeName,
      bornType: e.m_unitTypeName,
      ownerPlayerId: e.m_controlPlayerId,
      bornAtLoop: e._gameloop,
      bornAt: { x: e.m_x, y: e.m_y },
      diedAtLoop: null,
      diedAt: null,
      killerPlayerId: null,
      killerUnitTag: null,
      revived: 0,
      typeChanges: [],
      ownerChanges: [],
    });
  };
  const event = (
    e: RawEvent,
    kind: EventRecord['kind'],
    tag: number,
    playerSlot: number | null,
    data: Record<string, unknown>,
  ): void => {
    events.push({
      replayId,
      gameloop: e._gameloop,
      seconds: loopsToSeconds(e._gameloop),
      kind,
      playerSlot,
      team: lookup.teamOfSlot(playerSlot),
      data: { unitTag: tag, ...data },
    });
  };

  for (const e of tracker) {
    switch (e._event) {
      case 'NNet.Replay.Tracker.SUnitBornEvent':
      case 'NNet.Replay.Tracker.SUnitInitEvent':
        born(e as SUnitBornEvent);
        break;
      case 'NNet.Replay.Tracker.SUnitDiedEvent': {
        const d = e as SUnitDiedEvent;
        const u = drafts.get(unitTag(d.m_unitTagIndex, d.m_unitTagRecycle));
        if (!u) break;
        u.diedAtLoop = d._gameloop;
        u.diedAt = { x: d.m_x, y: d.m_y };
        u.killerPlayerId = d.m_killerPlayerId;
        u.killerUnitTag =
          d.m_killerUnitTagIndex === null || d.m_killerUnitTagRecycle === null
            ? null
            : unitTag(d.m_killerUnitTagIndex, d.m_killerUnitTagRecycle);
        break;
      }
      case 'NNet.Replay.Tracker.SUnitTypeChangeEvent': {
        const t = e as SUnitTypeChangeEvent;
        const tag = unitTag(t.m_unitTagIndex, t.m_unitTagRecycle);
        const u = drafts.get(tag);
        if (!u) break;
        u.typeChanges.push({ gameloop: t._gameloop, type: t.m_unitTypeName });
        event(e, 'UnitTypeChanged', tag, lookup.slotOfPlayer(u.ownerPlayerId), {
          from: u.type,
          to: t.m_unitTypeName,
        });
        u.type = t.m_unitTypeName;
        break;
      }
      case 'NNet.Replay.Tracker.SUnitOwnerChangeEvent': {
        const o = e as SUnitOwnerChangeEvent;
        const tag = unitTag(o.m_unitTagIndex, o.m_unitTagRecycle);
        const u = drafts.get(tag);
        if (!u) break;
        const slot = lookup.slotOfPlayer(o.m_controlPlayerId);
        const team = lookup.teamOfPlayer(o.m_controlPlayerId);
        u.ownerChanges.push({ gameloop: o._gameloop, slot, team });
        event(e, 'UnitOwnerChanged', tag, slot, {
          type: u.type,
          fromSlot: lookup.slotOfPlayer(u.ownerPlayerId),
          fromTeam: lookup.teamOfPlayer(u.ownerPlayerId),
        });
        u.ownerPlayerId = o.m_controlPlayerId;
        break;
      }
      case 'NNet.Replay.Tracker.SUnitRevivedEvent': {
        const r = e as SUnitRevivedEvent;
        const tag = unitTag(r.m_unitTagIndex, r.m_unitTagRecycle);
        const u = drafts.get(tag);
        if (!u) break;
        u.revived++;
        u.diedAtLoop = null;
        u.diedAt = null;
        u.killerPlayerId = null;
        u.killerUnitTag = null;
        event(e, 'UnitRevived', tag, lookup.slotOfPlayer(u.ownerPlayerId), {
          type: u.type,
          x: r.m_x,
          y: r.m_y,
        });
        break;
      }
      default:
        break;
    }
  }

  const units: UnitRecord[] = [];
  for (const u of drafts.values()) {
    units.push({
      replayId,
      tag: u.tag,
      tagIndex: u.tagIndex,
      tagRecycle: u.tagRecycle,
      type: u.type,
      bornType: u.bornType === u.type ? null : u.bornType,
      unitClass: classifyUnit(u.type, u.ownerPlayerId),
      ownerSlot: lookup.slotOfPlayer(u.ownerPlayerId),
      ownerTeam: lookup.teamOfPlayer(u.ownerPlayerId),
      bornAtLoop: u.bornAtLoop,
      bornAt: u.bornAt,
      diedAtLoop: u.diedAtLoop,
      diedAt: u.diedAt,
      killerSlot: lookup.slotOfPlayer(u.killerPlayerId),
      killerTeam: lookup.teamOfPlayer(u.killerPlayerId),
      killerUnitTag: u.killerUnitTag,
      revived: u.revived,
      typeChanges: u.typeChanges,
      ownerChanges: u.ownerChanges,
    });
  }
  units.sort((a, b) => a.bornAtLoop - b.bornAtLoop || a.tag - b.tag);
  return { units, events };
}
