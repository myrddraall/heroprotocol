# @myrddraall/heroprotocol-analysis

The built-in analysers over the [`@myrddraall/heroprotocol-db`](../heroprotocol-db) replay
model, and the batteries-included ingest worker that has them baked in.

```ts
// main thread — nothing to write on the worker side
import workerUrl from '@myrddraall/heroprotocol-analysis/worker?worker&url'; // Vite
import { createReplayDb } from '@myrddraall/heroprotocol-db/client';

const client = createReplayDb({ workerUrl });
const { replayId } = await client.ingest(bytes, { fileName }).complete;
const heat = await client.analyse(replayId, '@myrddraall/death-heatmap', { params: { team: 0 } });
```

```ts
// a host with its own analysers writes a three-line worker entry instead
import { createWorker } from '@myrddraall/heroprotocol-db/worker';
import { builtins } from '@myrddraall/heroprotocol-analysis';
createWorker({ analysers: [...builtins, mine] });
```

`./worker` is an ES module worker script (the parser lazy-loads its protocol
definitions, so the graph is code-split) — point `createReplayDb({ workerUrl })` at it;
it is not something to `import` or `require`. With Vite, `worker: { format: 'es' }` is
the one required setting.

## The analysers and their tables

Every analyser is a versioned pure function over `ctx.read()` that writes rows into the
tables it declares — ordinary Dexie stores with indexes, so results are queryable across
replays (`db.table('scoreScreenPlayers').where('awards').equals('MVP')`) instead of opaque
JSON. Every table's primary key starts with `replayId`; ids are namespaced
`@myrddraall/<name>`. A host may override any mode at registration
(`{ analyser, options: { mode } }` in `createWorker`).

| Analyser             | Mode         | Tables (primary key)                                                                                                                                                                 |
| -------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `description`        | `ready`      | `description` (`replayId`): map, mode, played-at, duration, winner · `descriptionPlayers` (`[replayId+slot]`)                                                                        |
| `score-screen`       | `ready`      | `scoreScreenPlayers` (`[replayId+slot]`): the ten score-screen stats as columns, awards, mvp · `scoreScreenTeams` (`[replayId+team]`)                                                |
| `unit-kills`         | `ready`      | `unitKills` (`[replayId+slot]`): minions, camp/lane mercs, bosses, structures, heroes, summons · `teamUnitKills` (`[replayId+team]`)                                                 |
| `player-stats`       | `ready`      | `playerStats` (`[replayId+slot]`): every recorded and derived stat as a column, `null` where unsupported · `playerStatsSupport` (`replayId`)                                         |
| `draft`              | `ready`      | `draft` (`replayId`) · `draftSteps` (`[replayId+order]`): bans and picks in the order they happened                                                                                  |
| `talents`            | `background` | `talentPicks` (`[replayId+slot+tier]`): talent id, level, time (hero-data maps names)                                                                                                |
| `xp-curve`           | `background` | `xpPoints` (`[replayId+team+seq]`): XP by source per periodic breakdown, closed by the summed end-of-game one                                                                        |
| `timeline`           | `background` | `timelineEvents` (`[replayId+seq]`): alive/dead spans, deaths with killers, levels, talents, structure deaths, camp captures, objectives, core death, leavers — `kind`-discriminated |
| `points-of-interest` | `background` | `pointsOfInterest` (`[replayId+seq]`): cores, halls, towers, wells, gates, walls, watch towers, camps · `mapInfo` (`replayId`)                                                       |
| `chat`               | `background` | `chatLines` (`[replayId+seq]`): chat and pings joined with the players                                                                                                               |
| `commands`           | `lazy`       | `commandStats` (`[replayId+slot]`): commands, casts, moves, APM, per-minute curve · `abilityUses` (`[replayId+slot+abilLink]`)                                                       |
| `death-heatmap`      | `lazy`       | `deathHeatmaps` (`[replayId+paramsHash]`) · `deathHeatmapCells` (`[replayId+paramsHash+x+y]`): parameterized by team / player / killer / cell; cache bounded to 32 filters           |

The framework stamps `replayId` on every row (and `paramsHash` on parameterized runs, or
`'-'` where a table is keyed by it), replaces an analyser's rows for the replay when it
reruns, and records each run in `analyserRuns` — version, time, error — which is what
staleness and caching are decided on. `builtinTables()` returns the merged schema; the
prebuilt worker announces it, so the main-thread `client.db` opens with these tables.

## Parity with the 2018 analysers, and where this deliberately differs

The 2018 heroesbrowser analysers cannot be executed any more (their build and data
sources are dead), so parity is by construction from their source, with these
intentional deviations — each one a bug or an inaccuracy there:

- **Timeline**: level-up events were emitted twice and talent events never
  (`getTimlineEvents` spread `getTimlineLevelEvents` twice); level events carried a
  `talent` field read from the wrong list. Here each level-up appears once with its
  level and each talent pick once with its name and level.
- **Chat**: `chatMessages` joined against an un-awaited promise, so names were never
  attached. Here every line carries the player's name, hero and team.
- **XP curve**: the team's final point was one player's `EndOfGameXPBreakdown`. Here
  the team's players are summed.
- **Player stats**: `Reconnects` counted the initial join at gameloop 0 (so it was
  never 0); here only joins after the game started count. Solo kills are recomputed
  from the death events as the 2018 code did, and the original score-screen value is
  kept as `Kills`. Unsupported stats for a build are `null` rather than absent or zero.
- **Draft**: bans and picks were reordered by a per-mode template; the tracker stream
  carries the real order, which is used.
- **Unit kills**: the merc classification table is the 2018 one; a merc not in it is
  counted under `mercsCamp` by its unit class rather than dropped.
- **Points of interest**: the map-specific mechanics (Blackheart's chests, Haunted
  Mines ladders, …) are out of scope; hero-data will carry map metadata later.
- `Basic`/`Player`/`Unit` analysers' mutable static caches are gone by design — every
  analyser is a pure function of `(replay, params)`.

Results are regression-tested against goldens for the three fixture replays
(`pnpm run generate.analysis-goldens` regenerates them; bump the changed analyser's
`version`), and every analyser is asserted to produce identical output at ingest
(in-memory context) and lazily (store context).

## Licence

MIT.
