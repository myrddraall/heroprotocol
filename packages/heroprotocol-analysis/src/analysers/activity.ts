import type { Analyser } from '@myrddraall/heroprotocol-db';
import type { CommandStatsRow } from './commands.js';
import type { PlayerRef } from './shared.js';
import { int, NS, participants, ref, statEvents } from './shared.js';

/** One row per player: how active and communicative they were. Counts are whole numbers. */
export interface ActivityRow extends PlayerRef {
  /** Orders (commands) per minute of the game's length, from `commandStats`. */
  readonly apm: number;
  /** Orders with an ability (casts, attacks, hero abilities) per minute, from `commandStats`. */
  readonly castsPerMinute: number;
  /** Pings the player made (both teams'; the minimap ones included). */
  readonly pings: number;
  /** Of those, the ones made on the minimap. */
  readonly minimapPings: number;
  /** Chat lines the player typed (both teams' chat is recorded). */
  readonly chatMessages: number;
  /** Sprays used (LootSprayUsed; 0 in builds that record none). */
  readonly sprays: number;
  /** Voice lines used (LootVoiceLineUsed; 0 in builds that record none). */
  readonly voiceLines: number;
  /** End-of-game upvotes the player gave (EndOfGameUpVotesCollected with this player as Voter). */
  readonly upvotesGiven: number;
}

export type ActivityTables = {
  readonly activity: ActivityRow[];
};

/**
 * Activity and communication per player: APM and casts per minute (read from the commands
 * analyser, so the commands are walked once), pings, chat lines, sprays, voice lines and upvotes
 * given. Lazy, because it needs the commands.
 */
export const activity: Analyser<ActivityTables> = {
  id: `${NS}activity`,
  version: 2,
  tables: { activity: '[replayId+slot], replayId, heroId, apm' },
  inputs: ['players', 'events', 'chat', 'statEvents'],
  mode: 'lazy',
  dependsOn: [`${NS}commands`],
  async run(ctx) {
    const [players, commandStats, pings, chat, sprays, voiceLines, votes] = await Promise.all([
      participants(ctx),
      ctx.readTable<CommandStatsRow>('commandStats'),
      ctx.read('events', { kind: 'Ping' }),
      ctx.read('chat', { kind: 'chat' }),
      statEvents(ctx, 'LootSprayUsed'),
      statEvents(ctx, 'LootVoiceLineUsed'),
      statEvents(ctx, 'EndOfGameUpVotesCollected'),
    ]);
    return {
      activity: players.map((p): ActivityRow => {
        const cmd = commandStats.find((c) => c.slot === p.slot);
        const myPings = pings.filter((e) => e.playerSlot === p.slot);
        return {
          ...ref(p),
          apm: cmd?.apm ?? 0,
          castsPerMinute: cmd?.castsPerMinute ?? 0,
          pings: myPings.length,
          minimapPings: myPings.filter((e) => e.data['minimap'] === true).length,
          chatMessages: chat.filter((c) => c.playerSlot === p.slot).length,
          sprays: sprays.filter((e) => e.playerSlot === p.slot).length,
          voiceLines: voiceLines.filter((e) => e.playerSlot === p.slot).length,
          upvotesGiven: votes.filter((v) => int(v, 'Voter') === p.slot + 1).length,
        };
      }),
    };
  },
};
