import type { Analyser, Point, Team } from '@myrddraall/heroprotocol-db';
import { bySlot, NS, participants } from './shared.js';

export interface ChatLineRow {
  readonly seq: number;
  readonly gameloop: number;
  readonly seconds: number;
  readonly kind: 'chat' | 'ping';
  readonly slot: number | null;
  readonly name: string | null;
  readonly hero: string | null;
  /** The hero's id (`DVaPilot`), for the hero's own emotes. */
  readonly heroId: string | null;
  /** Heroes has only team chat: the sender's team read it. */
  readonly team: Team | null;
  /** As typed (emote codes such as `:)` unconverted); null for a ping. */
  readonly text: string | null;
  readonly point: Point | null;
}

export type ChatTables = {
  readonly chatLines: ChatLineRow[];
};

/**
 * Chat and pings joined with the players: both teams' chat, the recording player's team's pings
 * (the only ones a replay keeps).
 */
export const chat: Analyser<ChatTables> = {
  id: `${NS}chat`,
  version: 3,
  tables: { chatLines: '[replayId+seq], replayId, [replayId+kind], slot' },
  inputs: ['players', 'chat'],
  mode: 'background',
  async run(ctx) {
    const [players, lines] = await Promise.all([participants(ctx), ctx.read('chat')]);
    const slots = bySlot(players);
    return {
      chatLines: [...lines]
        .sort((a, b) => a.gameloop - b.gameloop || a.seq - b.seq)
        .map((l, seq): ChatLineRow => {
          const p = l.playerSlot === null ? undefined : slots.get(l.playerSlot);
          return {
            seq,
            gameloop: l.gameloop,
            seconds: l.seconds,
            kind: l.kind,
            slot: l.playerSlot,
            name: p?.name ?? null,
            hero: p?.hero ?? null,
            heroId: p?.heroId ?? null,
            team: p?.team ?? null,
            text: l.text,
            point: l.point,
          };
        }),
    };
  },
};
