import type { ParsedReplay, SPlayerSetupEvent } from '@myrddraall/heroprotocol';
import { isEvent } from '@myrddraall/heroprotocol';
import type { SlotKind, Team } from '../model/records.js';

export interface SlotInfo {
  readonly slot: number;
  readonly kind: SlotKind;
  readonly team: Team | null;
  readonly userId: number | null;
}

/** Tracker player ids 11 and 12 own each team's structures and minions. */
const TEAM_OWNER_IDS: Readonly<Record<number, Team>> = { 11: 0, 12: 1 };

/**
 * Resolves the three id spaces a replay uses onto working-set slots:
 * the lobby's slot index, the tracker stream's 1-based `PlayerID` and the game
 * stream's `userId`. Built from the lobby when it decoded, from `details`
 * otherwise, and corrected by `SPlayerSetupEvent` when the tracker stream has it.
 */
export class PlayerLookup {
  readonly slots: readonly SlotInfo[];
  private readonly byPlayerId = new Map<number, number>();
  private readonly byUserId = new Map<number, number>();
  private readonly bySlot = new Map<number, SlotInfo>();

  constructor(parsed: ParsedReplay) {
    const slots: SlotInfo[] = [];
    const lobby = parsed.initData?.m_syncLobbyState.m_lobbyState.m_slots;
    if (lobby) {
      for (const s of lobby) {
        if (s.m_workingSetSlotId === null) continue;
        let kind: SlotKind;
        if (s.m_toonHandle && s.m_observe === 1) kind = 'observer';
        else if (s.m_toonHandle) kind = 'player';
        else if (s.m_hero) kind = 'ai';
        else continue; // empty
        slots.push({
          slot: s.m_workingSetSlotId,
          kind,
          team: kind === 'observer' ? null : teamOf(s.m_teamId),
          userId: s.m_userId,
        });
      }
    } else if (parsed.details) {
      for (const p of parsed.details.m_playerList) {
        slots.push({
          slot: p.m_workingSetSlotId,
          kind: p.m_control === 3 ? 'ai' : 'player',
          team: teamOf(p.m_teamId),
          userId: p.m_workingSetSlotId, // the lobby normally assigns user ids in slot order
        });
      }
    }
    slots.sort((a, b) => a.slot - b.slot);
    this.slots = slots;
    for (const s of slots) {
      this.bySlot.set(s.slot, s);
      if (s.userId !== null) this.byUserId.set(s.userId, s.slot);
    }

    for (const e of parsed.trackerEvents ?? []) {
      if (!isEvent<SPlayerSetupEvent>(e, 'NNet.Replay.Tracker.SPlayerSetupEvent')) continue;
      const slot = e.m_slotId ?? (e.m_userId !== null ? this.byUserId.get(e.m_userId) : undefined);
      if (slot !== undefined) this.byPlayerId.set(e.m_playerId, slot);
      if (e.m_userId !== null && slot !== undefined && !this.byUserId.has(e.m_userId)) {
        this.byUserId.set(e.m_userId, slot);
      }
    }
  }

  /** Slot of a tracker `PlayerID` (1-based); falls back to `id - 1` for players 1–10. */
  slotOfPlayer(playerId: number | null | undefined): number | null {
    if (playerId === null || playerId === undefined || playerId === 0) return null;
    const known = this.byPlayerId.get(playerId);
    if (known !== undefined) return known;
    return playerId >= 1 && playerId <= 10 ? playerId - 1 : null;
  }

  /** Team that a tracker `PlayerID` plays for, including the structure owners 11 and 12. */
  teamOfPlayer(playerId: number | null | undefined): Team | null {
    if (playerId === null || playerId === undefined) return null;
    const owner = TEAM_OWNER_IDS[playerId];
    if (owner !== undefined) return owner;
    return this.teamOfSlot(this.slotOfPlayer(playerId));
  }

  /** Slot of a game-stream `userId`; falls back to identity for 0–15. */
  slotOfUser(userId: number | null | undefined): number | null {
    if (userId === null || userId === undefined) return null;
    const known = this.byUserId.get(userId);
    if (known !== undefined) return known;
    return userId >= 0 && userId <= 15 && this.bySlot.has(userId) ? userId : null;
  }

  teamOfSlot(slot: number | null): Team | null {
    return slot === null ? null : (this.bySlot.get(slot)?.team ?? null);
  }

  info(slot: number): SlotInfo | undefined {
    return this.bySlot.get(slot);
  }
}

export function teamOf(teamId: number): Team | null {
  return teamId === 0 || teamId === 1 ? teamId : null;
}
