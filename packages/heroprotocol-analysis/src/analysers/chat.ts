import type { Analyser, ChatRecipient, Point, Team } from '@myrddraall/heroprotocol-db';
import { bySlot, NS, participants } from './shared.js';

export interface ChatLine {
  readonly gameloop: number;
  readonly seconds: number;
  readonly kind: 'chat' | 'ping';
  readonly slot: number | null;
  readonly name: string | null;
  readonly hero: string | null;
  readonly team: Team | null;
  readonly recipient: ChatRecipient;
  readonly text: string | null;
  readonly point: Point | null;
}

/** Chat and pings joined with the players. */
export const chat: Analyser<readonly ChatLine[]> = {
  id: `${NS}chat`,
  version: 1,
  inputs: ['players', 'chat'],
  mode: 'background',
  async run(ctx) {
    const [players, lines] = await Promise.all([participants(ctx), ctx.read('chat')]);
    const slots = bySlot(players);
    return [...lines]
      .sort((a, b) => a.gameloop - b.gameloop || a.seq - b.seq)
      .map((l): ChatLine => {
        const p = l.playerSlot === null ? undefined : slots.get(l.playerSlot);
        return {
          gameloop: l.gameloop,
          seconds: l.seconds,
          kind: l.kind,
          slot: l.playerSlot,
          name: p?.name ?? null,
          hero: p?.hero ?? null,
          team: p?.team ?? null,
          recipient: l.recipient,
          text: l.text,
          point: l.point,
        };
      });
  },
};
