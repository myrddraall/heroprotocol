import type { RawEvent, SChatMessage, SPingMessage } from '@myrddraall/heroprotocol';
import type { ChatRecipient, ChatRecord, EventRecord } from '../model/records.js';
import { loopsToSeconds } from '../model/records.js';
import type { PlayerLookup } from './lookup.js';
import { fixed } from './time.js';

const RECIPIENTS: readonly ChatRecipient[] = ['all', 'allies', 'observers'];

export interface MessageEvents {
  readonly chat: readonly ChatRecord[];
  /** `Reconnect` events; loading-progress messages are dropped. */
  readonly events: readonly EventRecord[];
}

export function normalizeMessageEvents(
  replayId: string,
  messages: readonly RawEvent[],
  lookup: PlayerLookup,
): MessageEvents {
  const chat: ChatRecord[] = [];
  const events: EventRecord[] = [];
  for (const e of messages) {
    const playerSlot = lookup.slotOfUser(e._userid?.m_userId);
    const base = {
      replayId,
      seq: 0,
      gameloop: e._gameloop,
      seconds: loopsToSeconds(e._gameloop),
      playerSlot,
    };
    switch (e._event) {
      case 'NNet.Game.SChatMessage': {
        const m = e as SChatMessage;
        chat.push({
          ...base,
          kind: 'chat',
          recipient: RECIPIENTS[m.m_recipient] ?? 'unknown',
          text: m.m_string,
          point: null,
        });
        break;
      }
      case 'NNet.Game.SPingMessage': {
        const m = e as SPingMessage;
        chat.push({
          ...base,
          kind: 'ping',
          recipient: RECIPIENTS[m.m_recipient] ?? 'unknown',
          text: null,
          point: { x: fixed(m.m_point.x), y: fixed(m.m_point.y) },
        });
        break;
      }
      case 'NNet.Game.SReconnectNotifyMessage':
        events.push({
          ...base,
          kind: 'Reconnect',
          team: lookup.teamOfSlot(playerSlot),
          data: { status: e['m_status'] },
        });
        break;
      default:
        break;
    }
  }
  return { chat, events };
}
