# Viewer hand-off

What `heroesbrowser-replay-viewer` gets from this repository, and how to wire it in.
Written for whoever starts the viewer's own modernization stage.

## The packages, in dependency order

| Package                             | Use it for                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| `@myrddraall/heroprotocol`          | Parsing only. The viewer rarely needs it directly — the worker parses.                            |
| `@myrddraall/heroprotocol-db`       | `createReplayDb()` (client), `HeroDb` (Dexie instance for reads and `liveQuery`), the model types |
| `@myrddraall/heroprotocol-analysis` | `./worker` (the prebuilt ingest worker) and the result types of the twelve analysers              |
| `@myrddraall/hero-data`             | Names for hero, talent and award ids; injected, cached by the app                                 |

All four are on GitHub Packages under `@myrddraall`; Dexie 4 is a peer dependency the
app installs itself.

## Wiring

```ts
const client = createReplayDb({ workerUrl: '/assets/hero-worker/worker.js' });
```

- **Angular CLI (esbuild builder)**: copy the worker and its chunks with an assets rule
  — `{ "input": "node_modules/@myrddraall/heroprotocol-analysis/dist", "glob": "{worker,chunk-*,protocol-*}.js", "output": "/assets/hero-worker" }` —
  and pass that URL. The chunks are loaded relative to `worker.js`, so keeping them side
  by side is all that matters. A custom worker entry (own analysers) works with the CLI's
  native `new Worker(new URL('./ingest.worker', import.meta.url), { type: 'module' })`.
- **Vite**: `import workerUrl from '@myrddraall/heroprotocol-analysis/worker?worker&url'`
  and `worker: { format: 'es' }` in the config (see `examples/vite-smoke`).
- **Reads**: `client.db` is a normal Dexie instance. `liveQuery(() => client.db.replays.toArray())`
  is an RxJS-compatible observable (`from(liveQuery(...))`), and it fires when the
  worker commits — ingest progress in the list for free. Fine-grained progress is the
  `IngestStatus` stream from `client.ingest()`.
- **Results**: each analyser's own tables, e.g. `client.db.table('scoreScreenPlayers').where('replayId').equals(replayId).toArray()` (the analysis README lists them), or
  `client.analyse(replayId, id, { params })` for lazy ones (computed once, then cached).
- **Names**: `heroData.forBuild(replay.version.baseBuild)` once per replay; wrap the
  provider's `cache` over IndexedDB (a `meta`-style table) so the ~5 MB per build is
  fetched once.
- **Privacy**: `keepFile` on `ingest()` is off by default — tie it to the existing
  "allow recent replays" setting. `pruneReplays(keep)` enforces "the last X".

## Old analyser → new result

| 2018 viewer used                        | Read instead                                                |
| --------------------------------------- | ----------------------------------------------------------- |
| `BasicReplayAnalyser.replayDescription` | `@myrddraall/description`, or the `replays` row itself      |
| `ScoreAnalyser.scoreScreenData`         | `@myrddraall/score-screen`                                  |
| `ScoreAnalyser.playerScoresFull`        | `@myrddraall/player-stats` (`statSupport` is on the result) |
| `DraftAnalyser.draft`                   | `@myrddraall/draft` (`steps`, real order)                   |
| `TalentAnalyser.talents`                | `@myrddraall/talents` + `heroData.talentName()`             |
| `XPAnalyser.periodicXP`                 | `@myrddraall/xp-curve`                                      |
| `TimelineAnalyser.getTimlineEvents`     | `@myrddraall/timeline` (level and talent events fixed)      |
| `UnitAnalyser.get*KilledCountByPlayer`  | `@myrddraall/unit-kills`                                    |
| `ReplayMapAnalyser.getPointsOfInterest` | `@myrddraall/points-of-interest`                            |
| `ChatAnalyser.chatMessages` / `pings`   | `@myrddraall/chat` (names attached this time)               |
| `ReplayMapAnalyser` heatmaps            | `@myrddraall/death-heatmap` (parameterized, lazy)           |
| `replay.fingerPrint`                    | `replays.id` — the same SHA-1, so stored ids carry over     |

## Known limits to plan around

- Ability names for `commands[].abilLink` are not available from any free source
  (numeric ids into the game's per-build catalog). Show casts as counts, not names.
- Map-specific objectives (Blackheart's chests, Haunted Mines ladders, …) are not
  modelled; `timeline` exposes their raw stat events under `kind: 'objective'`.
- heroes-data begins at build 76003; 2018 replays get nearest-build names (`exact: false`).
- The 2018 viewer is Angular 6 / webpack 4 and cannot consume ESM packages with
  `exports` maps. Its stage starts with the framework upgrade; until then the
  static-asset worker path above is the only integration option.
