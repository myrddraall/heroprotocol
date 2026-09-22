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

An analyser is a versioned pure function of `(replay, params)`:

```ts
const takedowns: Analyser<number[]> = {
  id: 'com.example/takedowns',
  version: 1,
  inputs: ['scoreResults'],
  mode: 'ready', // 'ready' | 'background' | 'lazy'
  run: async (ctx) => (await ctx.read('scoreResults')).map((s) => s.stats.Takedowns ?? 0),
};
const registry = createRegistry([takedowns]);
const { computed, results } = await runAnalysers({
  registry,
  ctx: createMemoryContext(n),
  modes: ['ready'],
});
```

`ready` analysers run before a replay is considered ready, `background` ones after,
`lazy` ones on first request; a consumer may override the mode when registering.
Dependencies (`dependsOn`) receive their results through `ctx.results` and may only
point at an equal-or-earlier mode. A failing analyser produces an error row and never
fails the run; a stored result is reused while its `analyserVersion` matches.
Parameters are part of the cache key (`paramsHash`).

`ctx.read()` is the only way an analyser touches data, which is what lets the same
function run at ingest over the in-memory replay and later over the store.

## The store

`HeroDb` is a Dexie database (Dexie is a **peer dependency**). Every per-replay table
has a compound primary key starting with `replayId`, so a replay is one contiguous
key range: `writeReplay()` replaces a replay with one range delete per table plus
chunked `bulkAdd`s in a single transaction (a failure leaves the database untouched),
and `deleteReplay()` / `pruneReplays({ keep })` are the same range deletes.

```ts
import { openHeroDb, writeReplay, readRows, pruneReplays } from '@myrddraall/heroprotocol-db/db';

const db = openHeroDb(); // 'heroprotocol'
await writeReplay(db, n, { file: { name, bytes } }); // keep the raw file only when asked
const deaths = await readRows(db, 'statEvents', n.replay.id, { eventName: 'PlayerDeath' });
await pruneReplays(db, { keep: 50 }); // "the last X"
```

`createDbContext(db, replay)` is an `AnalyserContext` backed by the store; its
`read()` returns exactly what the in-memory context returns (asserted by the tests),
which is what lets an analyser run at ingest and lazily without change.
`reanalyse(db, { registry })` brings stored results up to date from the persisted
model — no raw file needed — and `staleReplays(db)` lists replays normalized by an
older `NORMALIZE_VERSION`.

Measured with fake-indexeddb in Node (a browser's IndexedDB is faster): 22–30k rows
per replay, 6–9 MB as JSON, written in 1.2–1.9 s; `normalizeReplay` itself takes
10–70 ms.

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

`replays.status` walks `ingesting → analysing → ready → complete`; `ingestJobs`
records status transitions only. A parse or write failure fails the job and writes no
replay; an analyser failure is only an error row in `derived`.

`analyse(db, replayId, analyserId, { registry, params })` is the lazy flow: a fresh
`derived` row is served from cache, otherwise the analyser runs over the store (its
dependencies resolved the same way) and the result is saved, evicting the oldest rows
beyond `cache.maxEntries` for parameterized analysers.

## Scripts

```bash
pnpm run generate.goldens   # regenerate the normalized goldens from the fixture replays
```

## Licence

MIT.
