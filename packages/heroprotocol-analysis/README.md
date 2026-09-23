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

## The analysers

Every analyser is a versioned pure function over `ctx.read()`; results are plain JSON
persisted in `derived`. Ids are namespaced `@myrddraall/<name>`. A host may override
any mode at registration (`{ analyser, options: { mode } }` in `createWorker`).

| Analyser             | Mode         | Result                                                                                                                                     |
| -------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `description`        | `ready`      | What a replay list needs: map, mode, played-at, duration, version, winner, and the players with hero, role, level, talent count, leaver time |
| `score-screen`       | `ready`      | The ten score-screen stats per player, awards, team levels and kills                                                                       |
| `unit-kills`         | `ready`      | Kills credited to each player and team: minions, camp/lane mercs, bosses, structures, heroes, summons                                       |
| `player-stats`       | `ready`      | The full table: every recorded stat, tracker-derived counts, ratios and percentages, with the build's stat-support applied (`null`, not 0)   |
| `draft`              | `ready`      | Bans and picks in the order they actually happened, with first-pick team                                                                    |
| `talents`            | `background` | Talent picks per player with tier, level and time (internal talent ids until hero-data maps names)                                          |
| `xp-curve`           | `background` | Per-team XP by source over time, closed by the summed end-of-game breakdown                                                                 |
| `timeline`           | `background` | Alive/dead spans, deaths with killers, level-ups, talents, team levels, structure deaths, camp captures, map objectives, core death, leavers |
| `points-of-interest` | `background` | Cores, town halls, towers, moonwells, gates, walls, watch towers and jungle camps with positions; map size                                   |
| `chat`               | `background` | Chat and pings joined with the players                                                                                                      |
| `commands`           | `lazy`       | Per player: commands, casts, moves, APM, per-minute curve, casts by ability link                                                            |
| `death-heatmap`      | `lazy`       | Deaths bucketed on a grid; parameterized by team / player / killer / cell size, cache bounded to 32 filters                                  |

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
