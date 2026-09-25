import Dexie, { type Table } from 'dexie';
import type {
  AnalyserRunRecord,
  ChatRecord,
  CommandRecord,
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
import { NON_REPLAY_TABLES, normalizeSchema, STORES } from './schema.js';

export const DEFAULT_DB_NAME = 'heroprotocol';

/**
 * The IndexedDB database: the core stores plus the tables of whatever analysers the
 * host registered. Open it with `HeroDb.open()`, which reads the installed schema and
 * bumps the version only when the store set changed.
 */
export class HeroDb extends Dexie {
  replays!: Table<ReplayRecord, string>;
  players!: Table<PlayerRecord, [string, number]>;
  scoreResults!: Table<ScoreResultRecord, [string, number]>;
  statEvents!: Table<StatEventRecord, [string, number]>;
  units!: Table<UnitRecord, [string, number]>;
  commands!: Table<CommandRecord, [string, number]>;
  events!: Table<EventRecord, [string, number]>;
  chat!: Table<ChatRecord, [string, number]>;
  analyserRuns!: Table<AnalyserRunRecord, [string, string, string]>;
  replayFiles!: Table<ReplayFileRecord, string>;
  ingestJobs!: Table<IngestJobRecord, number>;
  meta!: Table<MetaRecord, string>;

  /** The full store set this instance was declared with. */
  readonly stores: Readonly<Record<string, string>>;

  constructor(
    name: string = DEFAULT_DB_NAME,
    analyserTables: Readonly<Record<string, string>> = {},
    version: number = 1,
  ) {
    super(name);
    this.stores = { ...STORES, ...analyserTables };
    this.version(version).stores({ ...this.stores });
  }

  /**
   * Open the database with the core stores plus `analyserTables`. If a database of this
   * name exists with a different store set (a new analyser, a changed index), the
   * version is bumped so Dexie adds or alters the stores; otherwise the installed
   * version is reused.
   */
  static async open(
    name: string = DEFAULT_DB_NAME,
    analyserTables: Readonly<Record<string, string>> = {},
  ): Promise<HeroDb> {
    const wanted: Record<string, string> = {};
    for (const [table, schema] of Object.entries({ ...STORES, ...analyserTables }))
      wanted[table] = normalizeSchema(schema);
    let version = 1;
    if (await Dexie.exists(name)) {
      const probe = new Dexie(name);
      await probe.open();
      version = Math.max(1, Math.round(probe.verno));
      const installed: Record<string, string> = {};
      for (const t of probe.tables) {
        installed[t.name] = normalizeSchema(
          [t.schema.primKey.src, ...t.schema.indexes.map((i) => i.src)].join(','),
        );
      }
      probe.close();
      const same =
        Object.keys(installed).length === Object.keys(wanted).length &&
        Object.entries(wanted).every(([table, schema]) => installed[table] === schema);
      if (!same) version += 1;
    }
    const db = new HeroDb(name, analyserTables, version);
    await db.open();
    return db;
  }

  /** Every table that holds one replay's rows (core and analyser), excluding jobs and meta. */
  get replayTables(): Table[] {
    return this.tables.filter((t) => !NON_REPLAY_TABLES.has(t.name));
  }

  /** The analyser-declared tables of this instance. */
  get analyserTables(): Table[] {
    return this.tables.filter((t) => !(t.name in STORES));
  }
}

export function openHeroDb(
  name: string = DEFAULT_DB_NAME,
  analyserTables: Readonly<Record<string, string>> = {},
): Promise<HeroDb> {
  return HeroDb.open(name, analyserTables);
}
