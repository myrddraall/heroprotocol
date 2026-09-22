import type { Diagnostics, SectionName, SectionStatus } from '@myrddraall/heroprotocol';

/**
 * The normalized replay model.
 *
 * Every record here is a plain JSON-able object: no classes, no Dates, no typed
 * arrays. The model is the contract between the parser-facing normalizer, the
 * store (Dexie today, anything later) and the analysers, so it is written for
 * humans first — seconds beside gameloops, slots and teams resolved, fixed-point
 * values divided out, unit tags resolved to types.
 *
 * Rows that belong to one replay all carry `replayId`, and every per-replay
 * collection has a compound primary key that starts with it, so a whole replay is
 * one contiguous key range: read or deleted in a single range operation.
 */

/** Heroes of the Storm simulates 16 game loops per second (`m_useScaledTime` aside). */
export const LOOPS_PER_SECOND = 16;

/** Bump when a change to the normalizer should make stored replays stale. */
export const NORMALIZE_VERSION = 1;

export type Team = 0 | 1;

export type GameMode =
  | 'practice'
  | 'versus-ai'
  | 'brawl'
  | 'quick-match'
  | 'unranked-draft'
  | 'hero-league'
  | 'team-league'
  | 'storm-league'
  | 'aram'
  | 'custom'
  | 'custom-draft'
  | 'unknown';

/**
 * The role the lobby recorded for a hero (attribute 4007). The four historic values
 * are named; anything newer is passed through as the raw four-letter code.
 */
export type HeroRole = 'assassin' | 'warrior' | 'support' | 'specialist' | (string & {});

export type SlotKind = 'player' | 'ai' | 'observer';

export type ReplayStatus = 'ingesting' | 'analysing' | 'ready' | 'complete' | 'failed';

/**
 * Where the replay id came from. `lobby` is the historic heroesbrowser fingerprint
 * (SHA-1 over loops, random value, mode id and the lobby slots), so ids carry over
 * from the 2018 library. The others are fallbacks for replays whose `initData`
 * failed to decode; consumers may want to show such an id as "degraded".
 */
export type FingerprintSource = 'lobby' | 'details' | 'header';

export interface ReplayVersion {
  readonly baseBuild: number;
  readonly build: number;
  readonly major: number;
  readonly minor: number;
  readonly revision: number;
}

/** Denormalized onto the replay so lists render without touching `players`. */
export interface PlayerSummary {
  readonly slot: number;
  readonly name: string;
  /** Display name of the hero, from `details`. */
  readonly hero: string;
  /** Attribute id of the hero (`Barbarian` for Sonya), from the lobby. */
  readonly heroId: string;
  readonly team: Team | null;
  readonly won: boolean | null;
  readonly kind: SlotKind;
}

export interface DraftBan {
  readonly team: Team;
  readonly heroId: string;
  readonly order: number;
  readonly gameloop: number;
}

export interface DraftPick {
  readonly slot: number;
  readonly heroId: string;
  readonly order: number;
  readonly gameloop: number;
}

export interface ReplayDraft {
  /** Attribute 4010: `drft` → draft, `stan` → standard (no draft). */
  readonly picking: 'draft' | 'standard' | 'unknown';
  /** Attribute 3009 was `Priv`. */
  readonly private: boolean;
  readonly bans: readonly DraftBan[];
  readonly picks: readonly DraftPick[];
}

export interface ReplayRecord {
  /** The fingerprint; see `FingerprintSource`. */
  readonly id: string;
  readonly fingerprintSource: FingerprintSource;
  readonly map: string;
  readonly mode: GameMode;
  /** The raw matchmaking id the mode was derived from (0 when unknown). */
  readonly ammId: number;
  /** ISO-8601, UTC. */
  readonly playedAt: string;
  /** The recording client's UTC offset in hours. */
  readonly timeZoneOffsetHours: number;
  readonly durationLoops: number;
  readonly durationSeconds: number;
  readonly version: ReplayVersion;
  readonly winningTeam: Team | null;
  /** Battle.net region of the players, when known (1 NA, 2 EU, 3 KR, 5 CN). */
  readonly region: number | null;
  readonly players: readonly PlayerSummary[];
  readonly draft: ReplayDraft;
  /** Gameloop of the final score screen, when one was recorded. */
  readonly finalScoreLoop: number | null;
  readonly sections: Readonly<Record<SectionName, SectionStatus>>;
  readonly diagnostics: Diagnostics;
  readonly fileSize: number;
  /** How many rows each per-replay collection received. */
  readonly rowCounts: Readonly<Record<ReplayCollectionName, number>>;
  readonly normalizeVersion: number;
  /** Set by ingest: whether the raw `.StormReplay` was kept in `replayFiles`. */
  readonly hasFile: boolean;
  readonly status: ReplayStatus;
  /** ISO-8601, when the replay was normalized. */
  readonly ingestedAt: string;
}

export interface Toon {
  readonly id: number;
  readonly realm: number;
  readonly region: number;
  readonly programId: string;
  /** `region-programId-realm-id`, as the lobby writes it. */
  readonly handle: string;
}

export interface PlayerCosmetics {
  readonly skin: string;
  readonly mount: string;
  readonly banner: string;
  readonly spray: string;
  readonly announcer: string;
  readonly voiceLine: string;
}

export interface TalentPick {
  readonly level: number;
  readonly name: string;
  readonly gameloop: number;
}

/** One row per occupied lobby slot, observers included. */
export interface PlayerRecord {
  readonly replayId: string;
  /** Working-set slot: 0–9 for players, 10–15 for observers. */
  readonly slot: number;
  /** The tracker stream's player id (slot + 1 for players; null for observers). */
  readonly playerId: number | null;
  /** The game stream's user id (null for AI). */
  readonly userId: number | null;
  readonly kind: SlotKind;
  readonly team: Team | null;
  readonly name: string;
  readonly hero: string;
  readonly heroId: string;
  readonly role: HeroRole | null;
  readonly toon: Toon | null;
  readonly won: boolean | null;
  readonly handicap: number;
  readonly cosmetics: PlayerCosmetics;
  readonly silenced: boolean;
  readonly voiceSilenced: boolean;
  /** Talents in pick order, from the `TalentChosen` stat events. */
  readonly talents: readonly TalentPick[];
  /** Final hero level, from the score screen or the last `LevelUp`. */
  readonly level: number | null;
  /** Gameloop at which the player left before the game ended, if they did. */
  readonly leftAtLoop: number | null;
}

/** The final score screen, one row per player (observers have none). */
export interface ScoreResultRecord {
  readonly replayId: string;
  readonly slot: number;
  readonly team: Team;
  readonly gameloop: number;
  /**
   * Every stat the build recorded, by its `SScoreResultEvent` instance name
   * (`Takedowns`, `HeroDamage`, …). The set grows per build, so this is an open map.
   */
  readonly stats: Readonly<Record<string, number>>;
  /** `EndOfMatchAward…Boolean` instances that were 1, with the affixes stripped. */
  readonly awards: readonly string[];
}

export type StatValue = number | string;

/**
 * An `SStatGameEvent`, flattened. `values` holds every key of the string, int and
 * fixed lists (fixed-point already divided by 4096); a key that appears more than
 * once in one event is collected in `lists` instead.
 */
export interface StatEventRecord {
  readonly replayId: string;
  /** Position within this replay's collection; `[replayId+seq]` is the primary key. */
  readonly seq: number;
  readonly gameloop: number;
  readonly seconds: number;
  readonly eventName: string;
  /** Resolved from a `PlayerID` value, when present. */
  readonly playerSlot: number | null;
  /** Resolved from a `Team`/`TeamID`/`Firing Team` value, when present. */
  readonly team: Team | null;
  readonly values: Readonly<Record<string, StatValue>>;
  readonly lists?: Readonly<Record<string, readonly StatValue[]>>;
}

export type UnitClass =
  'hero' | 'minion' | 'mercenary' | 'structure' | 'core' | 'globe' | 'summon' | 'other';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** One row per unit tag: born/init, type and owner changes, and death merged. */
export interface UnitRecord {
  readonly replayId: string;
  /** `unitTag(index, recycle)` as the game streams reference it. */
  readonly tag: number;
  readonly tagIndex: number;
  readonly tagRecycle: number;
  /** The unit's final type name. */
  readonly type: string;
  /** The type it was born with, when it changed. */
  readonly bornType: string | null;
  readonly unitClass: UnitClass;
  /** Owning player's slot at death (or end), when owned by a player. */
  readonly ownerSlot: number | null;
  /** Owning team: from the owner's slot, or from the structure/minion owner ids 11/12. */
  readonly ownerTeam: Team | null;
  readonly bornAtLoop: number;
  readonly bornAt: Point;
  readonly diedAtLoop: number | null;
  readonly diedAt: Point | null;
  readonly killerSlot: number | null;
  readonly killerTeam: Team | null;
  readonly killerUnitTag: number | null;
  /** Times the unit was revived (heroes). */
  readonly revived: number;
  /** Type changes after birth, in order. */
  readonly typeChanges: readonly { readonly gameloop: number; readonly type: string }[];
  /** Owner changes after birth, in order. */
  readonly ownerChanges: readonly {
    readonly gameloop: number;
    readonly slot: number | null;
    readonly team: Team | null;
  }[];
}

export type CommandTargetKind = 'none' | 'point' | 'unit' | 'data';

/** A cleaned `SCmdEvent`. Ability names are not in the protocol; `abilLink` is numeric until hero-data maps it. */
export interface CommandRecord {
  readonly replayId: string;
  readonly seq: number;
  readonly gameloop: number;
  readonly seconds: number;
  readonly playerSlot: number;
  readonly abilLink: number | null;
  readonly abilCmdIndex: number | null;
  readonly flags: number;
  readonly targetKind: CommandTargetKind;
  /** Map coordinates (fixed-point divided out). */
  readonly targetPoint: Point | null;
  readonly targetUnitTag: number | null;
  readonly otherUnitTag: number | null;
  readonly sequence: number;
}

export type EventKind =
  | 'HeroBanned'
  | 'HeroPicked'
  | 'HeroSwapped'
  | 'Upgrade'
  | 'UnitOwnerChanged'
  | 'UnitTypeChanged'
  | 'UnitRevived'
  | 'PlayerLeft'
  | 'PlayerJoined'
  | 'TalentTreeSelected'
  | 'Ping'
  | 'UnitClick'
  | 'Reconnect'
  | 'ScoreSnapshot';

/** The long tail: `kind`-discriminated events with a small, kind-specific `data` map. */
export interface EventRecord {
  readonly replayId: string;
  readonly seq: number;
  readonly gameloop: number;
  readonly seconds: number;
  readonly kind: EventKind;
  readonly playerSlot: number | null;
  readonly team: Team | null;
  readonly data: Readonly<Record<string, unknown>>;
}

export type ChatRecipient = 'all' | 'allies' | 'observers' | 'unknown';

export interface ChatRecord {
  readonly replayId: string;
  readonly seq: number;
  readonly gameloop: number;
  readonly seconds: number;
  readonly playerSlot: number | null;
  readonly kind: 'chat' | 'ping';
  readonly recipient: ChatRecipient;
  readonly text: string | null;
  readonly point: Point | null;
}

/** An analyser's persisted result. */
export interface DerivedRecord {
  readonly replayId: string;
  readonly analyserId: string;
  /** Stable hash of the parameters (`'-'` for an unparameterized run). */
  readonly paramsHash: string;
  readonly analyserVersion: number;
  readonly result: unknown;
  readonly error: string | null;
  /** ISO-8601. */
  readonly computedAt: string;
  readonly ms: number;
}

export interface ReplayFileRecord {
  readonly replayId: string;
  readonly name: string;
  readonly bytes: Uint8Array;
}

export type IngestJobStatus = 'queued' | 'running' | 'ready' | 'complete' | 'failed' | 'cancelled';

/** Status transitions only — never progress ticks. */
export interface IngestJobRecord {
  readonly id?: number;
  readonly replayId: string | null;
  readonly fileName: string;
  readonly status: IngestJobStatus;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly error: string | null;
}

export interface MetaRecord {
  readonly key: string;
  readonly value: unknown;
}

/** Collections that hold one replay's rows and are written by the normalizer. */
export type ReplayCollectionName =
  'players' | 'scoreResults' | 'statEvents' | 'units' | 'commands' | 'events' | 'chat';

export type CollectionName =
  'replays' | ReplayCollectionName | 'derived' | 'replayFiles' | 'ingestJobs' | 'meta';

export interface RecordTypes {
  replays: ReplayRecord;
  players: PlayerRecord;
  scoreResults: ScoreResultRecord;
  statEvents: StatEventRecord;
  units: UnitRecord;
  commands: CommandRecord;
  events: EventRecord;
  chat: ChatRecord;
  derived: DerivedRecord;
  replayFiles: ReplayFileRecord;
  ingestJobs: IngestJobRecord;
  meta: MetaRecord;
}

export type RecordOf<K extends CollectionName> = RecordTypes[K];

export const REPLAY_COLLECTIONS: readonly ReplayCollectionName[] = [
  'players',
  'scoreResults',
  'statEvents',
  'units',
  'commands',
  'events',
  'chat',
];

/** The normalizer's output: the replay record plus every per-replay collection. */
export interface NormalizedReplay {
  readonly replay: ReplayRecord;
  readonly players: readonly PlayerRecord[];
  readonly scoreResults: readonly ScoreResultRecord[];
  readonly statEvents: readonly StatEventRecord[];
  readonly units: readonly UnitRecord[];
  readonly commands: readonly CommandRecord[];
  readonly events: readonly EventRecord[];
  readonly chat: readonly ChatRecord[];
}

export function loopsToSeconds(loops: number): number {
  return loops / LOOPS_PER_SECOND;
}
