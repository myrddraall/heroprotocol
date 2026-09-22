import type {
  RawEvent,
  SCmdEvent,
  SGameUserJoinEvent,
  SGameUserLeaveEvent,
} from '@myrddraall/heroprotocol';
import { UserLeaveReason } from '@myrddraall/heroprotocol';
import type { CommandRecord, CommandTargetKind, EventRecord, Point } from '../model/records.js';
import { loopsToSeconds } from '../model/records.js';
import type { PlayerLookup } from './lookup.js';
import { fixed } from './time.js';

/**
 * Game events the model drops even when the parser kept them: loading sync is
 * noise, and the chat trigger duplicates `SChatMessage` in the message stream.
 */
export const MODEL_DROPPED_GAME_EVENTS: ReadonlySet<string> = new Set([
  'NNet.Game.SUserFinishedLoadingSyncEvent',
  'NNet.Game.STriggerChatMessageEvent',
]);

interface TargetUnit {
  readonly m_tag: number;
  readonly m_snapshotPoint?: { readonly x: number; readonly y: number; readonly z: number };
}

export interface GameEvents {
  readonly commands: readonly CommandRecord[];
  readonly events: readonly EventRecord[];
  /** Slot → loop at which the player left for good before the end, if any. */
  readonly leftAt: ReadonlyMap<number, number>;
}

const point = (p: { readonly x: number; readonly y: number } | undefined | null): Point | null =>
  p ? { x: fixed(p.x), y: fixed(p.y) } : null;

export function normalizeGameEvents(
  replayId: string,
  game: readonly RawEvent[],
  lookup: PlayerLookup,
  durationLoops: number,
): GameEvents {
  const commands: CommandRecord[] = [];
  const events: EventRecord[] = [];
  const presence = new Map<number, { loop: number; left: boolean }>();

  const slotOf = (e: RawEvent): number | null => lookup.slotOfUser(e._userid?.m_userId);
  const push = (e: RawEvent, kind: EventRecord['kind'], data: Record<string, unknown>): void => {
    const playerSlot = slotOf(e);
    events.push({
      replayId,
      gameloop: e._gameloop,
      seconds: loopsToSeconds(e._gameloop),
      kind,
      playerSlot,
      team: lookup.teamOfSlot(playerSlot),
      data,
    });
  };

  for (const e of game) {
    if (MODEL_DROPPED_GAME_EVENTS.has(e._event)) continue;
    switch (e._event) {
      case 'NNet.Game.SCmdEvent': {
        const c = e as SCmdEvent;
        const slot = slotOf(e);
        if (slot === null) break;
        const [dataKey, dataValue] = Object.entries(c.m_data)[0] ?? ['None', null];
        let targetKind: CommandTargetKind = 'none';
        let targetPoint: Point | null = null;
        let targetUnitTag: number | null = null;
        if (dataKey === 'TargetPoint') {
          targetKind = 'point';
          targetPoint = point(dataValue as { x: number; y: number });
        } else if (dataKey === 'TargetUnit') {
          targetKind = 'unit';
          const t = dataValue as TargetUnit;
          targetUnitTag = t.m_tag;
          targetPoint = point(t.m_snapshotPoint);
        } else if (dataKey === 'Data') {
          targetKind = 'data';
        }
        commands.push({
          replayId,
          gameloop: c._gameloop,
          seconds: loopsToSeconds(c._gameloop),
          playerSlot: slot,
          abilLink: c.m_abil?.m_abilLink ?? null,
          abilCmdIndex: c.m_abil?.m_abilCmdIndex ?? null,
          flags: c.m_cmdFlags,
          targetKind,
          targetPoint,
          targetUnitTag,
          otherUnitTag: c.m_otherUnit,
          sequence: c.m_sequence,
        });
        break;
      }
      case 'NNet.Game.SGameUserLeaveEvent': {
        const l = e as SGameUserLeaveEvent;
        push(e, 'PlayerLeft', { reason: l.m_leaveReason });
        const slot = slotOf(e);
        if (slot !== null && l.m_leaveReason !== UserLeaveReason.EndOfGame) {
          presence.set(slot, { loop: e._gameloop, left: true });
        }
        break;
      }
      case 'NNet.Game.SGameUserJoinEvent': {
        const j = e as SGameUserJoinEvent;
        push(e, 'PlayerJoined', {
          name: j.m_name,
          observer: j.m_observe === 1,
          hijack: j.m_hijack,
        });
        const slot = slotOf(e);
        if (slot !== null) presence.set(slot, { loop: e._gameloop, left: false });
        break;
      }
      case 'NNet.Game.SHeroTalentTreeSelectedEvent':
        push(e, 'TalentTreeSelected', { index: e['m_index'] });
        break;
      case 'NNet.Game.STriggerPingEvent':
        push(e, 'Ping', {
          point: point(e['m_point'] as { x: number; y: number }),
          unitTag: e['m_unit'],
          minimap: e['m_pingedMinimap'],
          option: e['m_option'],
        });
        break;
      case 'NNet.Game.SUnitClickEvent':
        push(e, 'UnitClick', { unitTag: e['m_unitTag'] });
        break;
      default:
        break;
    }
  }

  const leftAt = new Map<number, number>();
  for (const [slot, p] of presence) {
    if (p.left && p.loop > 0 && p.loop < durationLoops) leftAt.set(slot, p.loop);
  }
  return { commands, events, leftAt };
}
