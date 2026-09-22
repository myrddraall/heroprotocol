import Dexie, { type Table } from 'dexie';
import type {
  ChatRecord,
  CommandRecord,
  DerivedRecord,
  EventRecord,
  IngestJobRecord,
  MetaRecord,
  PlayerRecord,
  ReplayFileRecord,
  ReplayRecord,
  ScoreResultRecord,
  StatEventRecord,
  UnitRecord,
} from '../model/records.js';
import { DB_VERSION, STORES } from './schema.js';

export const DEFAULT_DB_NAME = 'heroprotocol';

/** The IndexedDB database. One instance per name; `liveQuery` works across tabs and workers. */
export class HeroDb extends Dexie {
  replays!: Table<ReplayRecord, string>;
  players!: Table<PlayerRecord, [string, number]>;
  scoreResults!: Table<ScoreResultRecord, [string, number]>;
  statEvents!: Table<StatEventRecord, [string, number]>;
  units!: Table<UnitRecord, [string, number]>;
  commands!: Table<CommandRecord, [string, number]>;
  events!: Table<EventRecord, [string, number]>;
  chat!: Table<ChatRecord, [string, number]>;
  derived!: Table<DerivedRecord, [string, string, string]>;
  replayFiles!: Table<ReplayFileRecord, string>;
  ingestJobs!: Table<IngestJobRecord, number>;
  meta!: Table<MetaRecord, string>;

  constructor(name: string = DEFAULT_DB_NAME) {
    super(name);
    this.version(DB_VERSION).stores({ ...STORES });
  }

  /** Every table a replay write touches (all but jobs and meta). */
  get replayTables(): Table[] {
    return [
      this.replays,
      this.players,
      this.scoreResults,
      this.statEvents,
      this.units,
      this.commands,
      this.events,
      this.chat,
      this.derived,
      this.replayFiles,
    ];
  }
}

export function openHeroDb(name: string = DEFAULT_DB_NAME): HeroDb {
  return new HeroDb(name);
}
