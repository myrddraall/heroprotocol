# @myrddraall/heroprotocol-db

The normalized, human-readable model of a Heroes of the Storm replay; the pure
normalizer that produces it from `@myrddraall/heroprotocol`'s `ParsedReplay`; and the
analyser framework that runs over it. The Dexie store, the ingest worker and the
client come in later stages of the same package.

```ts
import { openReplay, NOISY_GAME_EVENTS } from '@myrddraall/heroprotocol';
import { normalizeReplay } from '@myrddraall/heroprotocol-db/normalize';

const parsed = await openReplay(bytes, { dropGameEvents: NOISY_GAME_EVENTS });
const n = normalizeReplay(parsed);
n.replay.map; // 'Towers of Doom'
n.players[3].heroId; // 'Barbarian'  (details say 'Sonya')
n.units.filter((u) => u.unitClass === 'hero').length; // 10
```

## The model

Plain JSON-able records, one `replayId` per row, written for reading: seconds beside
gameloops, slots and teams resolved, fixed-point divided out. Row counts for the
three fixture replays (2018 draft, 2019 brawl, 2021 ARAM):

| Collection     | Key                | Rows            | Holds                                                                                           |
| -------------- | ------------------ | --------------- | ----------------------------------------------------------------------------------------------- |
| `replays`      | `id` (fingerprint) | 1               | map, mode, played-at, duration, version, winner, player summary, draft, sections, diagnostics   |
| `players`      | `[replayId+slot]`  | 10              | slot / tracker id / user id, team, name, hero + hero id, role, toon, result, cosmetics, talents |
| `scoreResults` | `[replayId+slot]`  | 10              | the final score screen: every stat the build recorded (open map) plus the awards                |
| `statEvents`   | `[replayId+seq]`   | 611 – 704       | every `SStatGameEvent` flattened, player and team resolved, repeated keys as lists              |
| `units`        | `[replayId+tag]`   | 1 171 – 3 765   | one lifespan row per unit: class, owner, born/died, killer, type and owner changes              |
| `commands`     | `[replayId+seq]`   | 18 514 – 26 032 | cleaned `SCmdEvent`s: player, ability link, flags, target point/unit                            |
| `events`       | `[replayId+seq]`   | 636 – 2 266     | the long tail by `kind`: draft, upgrades, unit changes, pings, clicks, joins/leaves, snapshots  |
| `chat`         | `[replayId+seq]`   | 22 – 69         | chat and pings from the message stream                                                          |

The replay id is the 2018 heroesbrowser fingerprint (SHA-1 over loops, random value,
mode id and the lobby slots) so ids carry over; when `initData` did not decode a
`details`- or `header`-derived id is used and `fingerprintSource` says so.

`heroId` comes from the tracker's `PlayerSpawned` event, not the lobby: in brawl and
ARAM the lobby records the hero the slot had _selected_, not the one it played.

## Analysers

An analyser is a versioned pure function of `(replay, params)` that writes rows into
tables it declares (Dexie schema strings; every primary key starts with `replayId`):

```ts
const takedowns: Analyser = {
  id: 'com.example/takedowns',
  version: 1,
  tables: { takedowns: '[replayId+slot]' },
  inputs: ['scoreResults'],
  mode: 'ready', // 'ready' | 'background' | 'lazy'
  run: async (ctx) => ({
    takedowns: (await ctx.read('scoreResults')).map((s) => ({
      slot: s.slot,
      takedowns: s.stats['Takedowns'] ?? 0,
    })),
  }),
};
```

`ready` analysers run before a replay is considered ready, `background` ones after,
`lazy` ones on first request; a consumer may override the mode when registering.
A failing analyser produces an error run and never fails the ingest; a stored run is
reused while its `analyserVersion` matches. Parameters are part of the cache key
(`paramsHash`).

### Dependencies

An analyser can use another analyser's output as input: list it in `dependsOn` and read
its tables with `ctx.readTable()`.

```ts
const teamTakedowns: Analyser = {
  id: 'com.example/team-takedowns',
  version: 1,
  tables: { teamTakedowns: 'replayId' },
  inputs: [],
  dependsOn: ['com.example/takedowns'],
  mode: 'lazy',
  run: async (ctx) => {
    const rows = await ctx.readTable<{ takedowns: number }>('takedowns');
    return { teamTakedowns: [{ total: rows.reduce((a, r) => a + r.takedowns, 0) }] };
  },
};
```

Dependencies always run first:

- **At ingest**, analysers run in dependency order and each one's rows are readable by
  the ones after it. A dependency in a later mode than its dependent (a `ready` analyser
  depending on a `lazy` one) is pulled forward and runs automatically in the
  dependent's stage; `registry.get(id).mode` reports where it runs, `declaredMode` what
  it asked for.
- **On demand**, `analyse()` computes any missing, stale or errored dependency (and its
  own dependencies) before the analyser itself; fresh ones are reused.
- A dependent of a failed dependency is recorded as failed without running.
- `validate()` rejects unregistered dependencies and cycles.

`ctx.read()` is the only way an analyser touches data, which is what lets the same
function run at ingest over the in-memory replay and later over the store.

## The store

`HeroDb` is a Dexie database (Dexie is a **peer dependency**). Every per-replay table
has a compound primary key starting with `replayId`, so a replay is one contiguous
key range: `writeReplay()` replaces a replay with one range delete per table plus
chunked `bulkAdd`s in a single transaction (a failure leaves the database untouched),
and `deleteReplay()` / `pruneReplays({ keep })` are the same range deletes.

The per-replay tables have no secondary indexes (only `players.toon.handle`, for finding
a player across replays). Every read is per replay, so `readRows()` is one range scan
with the filter applied in memory, and `where('replayId')` still works because Dexie
serves it from the primary key. Each index would be one more write per row; in a
Chromium benchmark the indexes of 0.4 made writing a replay several times slower. The
database uses relaxed durability: commits do not wait for the OS to flush them, which
is a little faster and can only lose the last writes on an OS crash or power loss.

```ts
import { openHeroDb, writeReplay, readRows, pruneReplays } from '@myrddraall/heroprotocol-db/db';

const db = openHeroDb(); // 'heroprotocol'
await writeReplay(db, n, { file: { name, bytes } }); // keep the raw file only when asked
const deaths = await readRows(db, 'statEvents', n.replay.id, { eventName: 'PlayerDeath' });
await pruneReplays(db, { keep: 50 }); // "the last X"
```

`HeroDb.open(name, analyserTables)` opens the core stores plus the analysers' tables and
bumps the Dexie version only when the store set changed. `createDbContext(db, replay)` is
an `AnalyserContext` backed by the store; its `read()`/`readTable()` return exactly what
the in-memory context returns (asserted by the tests), which is what lets an analyser run
at ingest and lazily without change.
`reanalyse(db, { registry })` brings stored results up to date from the persisted
model — no raw file needed — and `staleReplays(db)` lists replays normalized by an
older `NORMALIZE_VERSION`.

A replay is 22–30k rows, 6–9 MB as JSON; `normalizeReplay` itself takes 10–70 ms.
Writing one took 5–9 s in headless Chromium in a devcontainer (28 s with the 0.4
indexes) and 1.2–1.9 s in fake-indexeddb in Node; real browsers on a local disk vary.

## Ingest

`ingestInline(db, bytes, options)` is the whole pipeline in-thread — the worker
(Stage 4) runs exactly this:

```ts
import { ingestInline } from '@myrddraall/heroprotocol-db/ingest';

const handle = ingestInline(db, bytes, {
  fileName: file.name,
  registry, // analysers; `ready` ones gate readiness, `background` ones follow
  keepFile: false,
  onStatus: (s) => render(s), // IngestStatus snapshots: phase, per-section and per-analyser state
});
const { replay } = await handle.ready; // written, `ready` analysers committed
await handle.complete; // `background` analysers committed one by one
```

Each snapshot also carries `store` while a database write is in flight: the replay
itself, the `ready` analysers' commit, a background analyser's save, or the final status
update. IndexedDB runs read-write transactions over the same tables one at a time, so
with several imports running a write is first `waiting` (another job holds the tables),
then `writing` with `current` of `total` rows added. Row counts advance once per
2,000-row chunk, throttled like the other progress ticks.

`replays.status` walks `ingesting → analysing → ready → complete`; `ingestJobs`
records status transitions only. A parse or write failure fails the job and writes no
replay; an analyser failure is only an error in its run record.

`analyse(db, replayId, analyserId, { registry, params })` is the lazy flow: a fresh run
is served from its tables, otherwise the analyser runs over the store (its dependencies
resolved the same way) and its rows are saved, evicting the oldest parameter sets
beyond `cache.maxEntries` for parameterized analysers.

## Worker and client

The pipeline runs off the main thread. A consumer's worker entry is a few lines
around `createWorker`, which is how custom analysers get baked in:

```ts
// worker.ts
import { createWorker } from '@myrddraall/heroprotocol-db/worker';
import { myAnalyser } from './analysers';

createWorker({ analysers: [myAnalyser], services: { heroData } });
```

```ts
// main thread
import { liveQuery } from 'dexie';
import { createReplayDb } from '@myrddraall/heroprotocol-db/client';

const client = createReplayDb({
  worker: () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
});
const job = client.ingest(bytes, { fileName, onStatus: render });
const { replayId } = await job.ready; // written + `ready` analysers committed
await job.complete; // `background` analysers committed
const row = await client.analyse(replayId, 'my/lazy-analyser', { params: { slot: 3 } });

liveQuery(() => client.db.replays.toArray()).subscribe(renderList); // sees the worker's writes
```

`createReplayDb` takes exactly one of `worker` (a `Worker` or a factory), `workerUrl`
(for bundlers that hand out a URL, e.g. Vite's `?worker&url`) or `inline: true`
(everything on the calling thread — tests, Node, no-worker environments). `client.db`
is always a main-thread Dexie instance on the same database, so reads and `liveQuery`
work as usual; Dexie propagates the worker's commits to it.

Replay bytes are **transferred** to the worker, not copied — the `Uint8Array` you pass
is empty afterwards. Results and status snapshots are structured-cloneable plain
objects. The protocol is in [`src/worker/protocol.ts`](./src/worker/protocol.ts);
it is tested end-to-end over a Node `MessageChannel` and in Chromium by the
[Vite smoke app](../../examples/vite-smoke).

**Vite** needs one setting, `worker: { format: 'es' }`: Vite bundles workers as IIFE by
default, but the parser lazy-loads its protocol definitions with dynamic `import()`,
which makes the worker graph code-split and therefore ES-module only. Nothing else —
no asset or alias configuration.

## Scripts

```bash
pnpm run generate.goldens   # regenerate the normalized goldens from the fixture replays
```

## Licence

MIT.
