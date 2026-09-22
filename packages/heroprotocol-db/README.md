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
| `statEvents`   | `++id`             | 611 – 704       | every `SStatGameEvent` flattened, player and team resolved, repeated keys as lists              |
| `units`        | `[replayId+tag]`   | 1 171 – 3 765   | one lifespan row per unit: class, owner, born/died, killer, type and owner changes              |
| `commands`     | `++id`             | 18 514 – 26 032 | cleaned `SCmdEvent`s: player, ability link, flags, target point/unit                            |
| `events`       | `++id`             | 636 – 2 266     | the long tail by `kind`: draft, upgrades, unit changes, pings, clicks, joins/leaves, snapshots  |
| `chat`         | `++id`             | 22 – 69         | chat and pings from the message stream                                                          |

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

## Scripts

```bash
pnpm run generate.goldens   # regenerate the normalized goldens from the fixture replays
```

## Licence

MIT.
