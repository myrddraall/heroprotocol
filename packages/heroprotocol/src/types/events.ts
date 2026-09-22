import type { RawEvent } from '../protocol/runtime.js';

/** Every decoded event carries these; `_userid` only on game and message events. */
export type ReplayEvent = RawEvent;

export function isGameEvent(e: RawEvent): boolean {
  return e._event.startsWith('NNet.Game.');
}
export function isTrackerEvent(e: RawEvent): boolean {
  return e._event.startsWith('NNet.Replay.Tracker.');
}

// ---- tracker events ----

export interface SUnitBornEvent extends RawEvent {
  readonly _event: 'NNet.Replay.Tracker.SUnitBornEvent';
  readonly m_unitTagIndex: number;
  readonly m_unitTagRecycle: number;
  readonly m_unitTypeName: string;
  readonly m_controlPlayerId: number;
  readonly m_upkeepPlayerId: number;
  readonly m_x: number;
  readonly m_y: number;
}
export interface SUnitDiedEvent extends RawEvent {
  readonly _event: 'NNet.Replay.Tracker.SUnitDiedEvent';
  readonly m_unitTagIndex: number;
  readonly m_unitTagRecycle: number;
  readonly m_killerPlayerId: number | null;
  readonly m_x: number;
  readonly m_y: number;
  readonly m_killerUnitTagIndex: number | null;
  readonly m_killerUnitTagRecycle: number | null;
}
export interface SUnitOwnerChangeEvent extends RawEvent {
  readonly _event: 'NNet.Replay.Tracker.SUnitOwnerChangeEvent';
  readonly m_unitTagIndex: number;
  readonly m_unitTagRecycle: number;
  readonly m_controlPlayerId: number;
  readonly m_upkeepPlayerId: number;
}
export interface SUnitTypeChangeEvent extends RawEvent {
  readonly _event: 'NNet.Replay.Tracker.SUnitTypeChangeEvent';
  readonly m_unitTagIndex: number;
  readonly m_unitTagRecycle: number;
  readonly m_unitTypeName: string;
}
export interface SUpgradeEvent extends RawEvent {
  readonly _event: 'NNet.Replay.Tracker.SUpgradeEvent';
  readonly m_playerId: number;
  readonly m_upgradeTypeName: string;
  readonly m_count: number;
}
export interface SUnitInitEvent extends RawEvent {
  readonly _event: 'NNet.Replay.Tracker.SUnitInitEvent';
  readonly m_unitTagIndex: number;
  readonly m_unitTagRecycle: number;
  readonly m_unitTypeName: string;
  readonly m_controlPlayerId: number;
  readonly m_upkeepPlayerId: number;
  readonly m_x: number;
  readonly m_y: number;
}
export interface SUnitDoneEvent extends RawEvent {
  readonly _event: 'NNet.Replay.Tracker.SUnitDoneEvent';
  readonly m_unitTagIndex: number;
  readonly m_unitTagRecycle: number;
}
export interface SUnitPositionsEvent extends RawEvent {
  readonly _event: 'NNet.Replay.Tracker.SUnitPositionsEvent';
  readonly m_firstUnitIndex: number;
  readonly m_items: readonly number[];
}
export interface SPlayerSetupEvent extends RawEvent {
  readonly _event: 'NNet.Replay.Tracker.SPlayerSetupEvent';
  readonly m_playerId: number;
  readonly m_type: number;
  readonly m_userId: number | null;
  readonly m_slotId: number | null;
}
export interface SStatGameEventData<T> {
  readonly m_key: string;
  readonly m_value: T;
}
export interface SStatGameEvent extends RawEvent {
  readonly _event: 'NNet.Replay.Tracker.SStatGameEvent';
  readonly m_eventName: string;
  readonly m_stringData: readonly SStatGameEventData<string>[] | null;
  readonly m_intData: readonly SStatGameEventData<number>[] | null;
  /** Fixed point: divide by 4096. */
  readonly m_fixedData: readonly SStatGameEventData<number>[] | null;
}
export interface SScoreResultEvent extends RawEvent {
  readonly _event: 'NNet.Replay.Tracker.SScoreResultEvent';
  readonly m_instanceList: readonly {
    readonly m_name: string;
    readonly m_values: readonly (readonly {
      readonly m_value: number;
      readonly m_time: number;
    }[])[];
  }[];
}
export interface SUnitRevivedEvent extends RawEvent {
  readonly _event: 'NNet.Replay.Tracker.SUnitRevivedEvent';
  readonly m_unitTagIndex: number;
  readonly m_unitTagRecycle: number;
  readonly m_x: number;
  readonly m_y: number;
}
export interface SHeroBannedEvent extends RawEvent {
  readonly _event: 'NNet.Replay.Tracker.SHeroBannedEvent';
  readonly m_hero: string;
  readonly m_controllingTeam: number;
}
export interface SHeroPickedEvent extends RawEvent {
  readonly _event: 'NNet.Replay.Tracker.SHeroPickedEvent';
  readonly m_hero: string;
  readonly m_controllingPlayer: number;
}
export interface SHeroSwappedEvent extends RawEvent {
  readonly _event: 'NNet.Replay.Tracker.SHeroSwappedEvent';
  readonly m_hero: string;
  readonly m_newControllingPlayer: number;
}

export type TrackerEvent =
  | SUnitBornEvent
  | SUnitDiedEvent
  | SUnitOwnerChangeEvent
  | SUnitTypeChangeEvent
  | SUpgradeEvent
  | SUnitInitEvent
  | SUnitDoneEvent
  | SUnitPositionsEvent
  | SPlayerSetupEvent
  | SStatGameEvent
  | SScoreResultEvent
  | SUnitRevivedEvent
  | SHeroBannedEvent
  | SHeroPickedEvent
  | SHeroSwappedEvent;

/** Narrow a raw event to a specific tracker event by its `_event` name. */
export function isEvent<T extends RawEvent>(e: RawEvent, name: T['_event']): e is T {
  return e._event === name;
}

// ---- game events the model keeps ----

export const UserLeaveReason = { EndOfGame: 0, Disconnected: 11 } as const;

export interface SGameUserLeaveEvent extends RawEvent {
  readonly _event: 'NNet.Game.SGameUserLeaveEvent';
  readonly m_leaveReason: number;
}
export interface SGameUserJoinEvent extends RawEvent {
  readonly _event: 'NNet.Game.SGameUserJoinEvent';
  readonly m_name: string;
  readonly m_toonHandle: string;
  readonly m_clanTag: string;
  readonly m_observe: number;
  readonly m_hijack: boolean;
}
export interface SCmdEvent extends RawEvent {
  readonly _event: 'NNet.Game.SCmdEvent';
  readonly m_cmdFlags: number;
  readonly m_abil: {
    readonly m_abilLink: number;
    readonly m_abilCmdIndex: number;
    readonly m_abilCmdData: number | null;
  } | null;
  readonly m_data: Record<string, unknown>;
  readonly m_vector?: { readonly x: number; readonly y: number; readonly z: number } | null;
  readonly m_sequence: number;
  readonly m_otherUnit: number | null;
  readonly m_unitGroup: number | null;
}

// ---- message events ----

export interface SChatMessage extends RawEvent {
  readonly _event: 'NNet.Game.SChatMessage';
  readonly m_recipient: number;
  readonly m_string: string;
}
export interface SPingMessage extends RawEvent {
  readonly _event: 'NNet.Game.SPingMessage';
  readonly m_recipient: number;
  /** Fixed point: divide by 4096. */
  readonly m_point: { readonly x: number; readonly y: number };
}

/**
 * Game events that are input/UI noise: mouse and camera movement, key presses,
 * sound and dialog triggers, command-manager state. Dropping them leaves the
 * commands and the handful of meaningful events — about a fifth to a half of
 * the stream, depending on the build.
 */
export const NOISY_GAME_EVENTS: ReadonlySet<string> = new Set([
  'NNet.Game.STriggerMouseMovedEvent',
  'NNet.Game.SCameraUpdateEvent',
  'NNet.Game.STriggerKeyPressedEvent',
  'NNet.Game.SCmdUpdateTargetPointEvent',
  'NNet.Game.SCmdUpdateTargetUnitEvent',
  'NNet.Game.SCommandManagerStateEvent',
  'NNet.Game.SCommandManagerResetEvent',
  'NNet.Game.STriggerTargetModeUpdateEvent',
  'NNet.Game.SSelectionDeltaEvent',
  'NNet.Game.SControlGroupUpdateEvent',
  'NNet.Game.STriggerDialogControlEvent',
  'NNet.Game.STriggerSoundOffsetEvent',
  'NNet.Game.STriggerSoundLengthSyncEvent',
  'NNet.Game.STriggerSoundtrackDoneEvent',
  'NNet.Game.STriggerTransmissionOffsetEvent',
  'NNet.Game.STriggerTransmissionCompleteEvent',
  'NNet.Game.STriggerCutsceneBookmarkFiredEvent',
  'NNet.Game.STriggerCutsceneEndSceneFiredEvent',
  'NNet.Game.SUserOptionsEvent',
  'NNet.Game.SHeroTalentTreeSelectionPanelToggledEvent',
]);
