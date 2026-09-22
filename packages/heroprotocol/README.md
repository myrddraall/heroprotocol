# @myrddraall/heroprotocol

Parse Heroes of the Storm `.StormReplay` files, in the browser and in Node.

- **Protocols are data.** Blizzard publishes one protocol file per game build; the 390
  published files are only **36 distinct definitions**, and all 36 ship in this package
  as plain data interpreted by one fixed decoder. Nothing is fetched to run, nothing is
  evaluated, no `unsafe-eval`.
- **New builds work without a new release.** For a build newer than the bundle, an
  optional online source fetches Blizzard's definition and converts it to data — and
  because the upstream listing carries content hashes, a new build that merely reuses an
  existing definition (the usual case: builds 85027 → 96477 all share one) is recognised
  without downloading anything.
- **It does what it can.** Sections decode independently; an event stream that breaks
  part-way keeps what it decoded; when the exact protocol is unavailable the nearest ones
  are tried and their results checked. `diagnostics` tells you exactly what happened.
- Verified against Blizzard's own Python decoders on real replays from three protocol
  lineages: identical output for every section.

Successor to `@heroesbrowser/heroprotocol`; see [Migrating](#migrating).

## Install

```ini
# .npmrc
@myrddraall:registry=https://npm.pkg.github.com
```

```bash
pnpm add @myrddraall/heroprotocol
```

## Usage

```ts
import { openReplay, NOISY_GAME_EVENTS } from '@myrddraall/heroprotocol';

const replay = await openReplay(await file.arrayBuffer(), {
  dropGameEvents: NOISY_GAME_EVENTS, // optional: skip mouse/camera/UI noise
  onProgress: (p) => console.log(p.section, p.current, p.total),
});

replay.build; // 85267
replay.header.m_elapsedGameLoops; // 13518
replay.details?.m_title; // 'Silver City'
replay.details?.m_playerList.map((p) => p.m_name);
replay.trackerEvents?.length; // 3802
replay.diagnostics.sections.initData.status; // 'ok' | 'partial' | 'failed' | 'skipped'
```

Decoded values keep Blizzard's field names (`m_…`) and shapes, so anything written
against the reference Python decoders reads the same here. Byte blobs are decoded as
UTF-8 text; fixed-point values (`m_fixedData`, ping coordinates) are as stored — divide
by 4096.

### Choosing what to decode

```ts
await openReplay(bytes, { sections: ['header', 'details'] }); // everything else 'skipped'
```

`gameEvents` is by far the largest section (90k–250k events). Reading it cannot be
skipped within the stream, but `dropGameEvents` keeps only what you want.

### Builds newer than the bundle

```ts
import { openReplay, onlineSource } from '@myrddraall/heroprotocol';

await openReplay(bytes, { source: onlineSource() });
```

`onlineSource()` tries the bundled definitions first and Blizzard's repository second,
with a timeout and retries. Without it, an unknown build is decoded with the nearest
bundled protocol — which the evidence says is right about 87 times in 88 — and the
`diagnostics` mark each section's provenance as `'nearest'`.

### Diagnostics

```ts
const { diagnostics } = replay;
diagnostics.complete; // every requested section is 'ok'
diagnostics.protocol; // the protocol build most sections used
diagnostics.sections.gameEvents;
// { status: 'partial', protocol: 85027, provenance: 'exact',
//   eventsDecoded: 91201, failedAt: { usedBits, totalBits, lastGameloop }, error: '…',
//   attempts: [{ protocol: 85027, provenance: 'exact', error: '…', eventsDecoded: 91201 }] }
```

The header is the only section that must decode — it names the build. `openReplay`
rejects only for something that is not a replay at all.

## What's in a replay

| Section         | Format     | Notes                                                              |
| --------------- | ---------- | ------------------------------------------------------------------ |
| `header`        | versioned  | build, elapsed game loops                                          |
| `details`       | versioned  | map, players, result, time                                         |
| `initData`      | bit-packed | full lobby state: slots, cosmetics, game options                   |
| `attributes`    | its own    | draft/ban settings, roles, game mode                               |
| `trackerEvents` | versioned  | unit born/died, stat events, score results — the analysis backbone |
| `messageEvents` | bit-packed | chat and pings                                                     |
| `gameEvents`    | bit-packed | every command and input                                            |

**Versioned** sections are self-describing and decode correctly even with a protocol from
another build. **Bit-packed** sections are schema-bound: they work with an exact or
same-lineage protocol; across lineages `initData` is the one that typically breaks.

## Lower-level API

`Protocol`, `BitPackedDecoder`, `VersionedDecoder`, `convertPythonProtocol`,
`ProtocolRegistry`, `bundledSource` / `fetchSource` / `compositeSource` and the
`ProtocolDefinition` type are all exported for tools that need them. `unitTag`,
`unitTagIndex` and `unitTagRecycle` match Blizzard's helpers.

## Migrating

`@heroesbrowser/heroprotocol` exposed a `Replay` class whose getters were RPC calls into
a web worker. That layer is gone; this package is the parser only. Parsing runs wherever
you call it — in a worker if you want (the successor `@myrddraall/heroprotocol-db` does).

Fixed along the way, all reachable in normal use:

- Protocols were fetched at runtime from a URL that has returned 404 since June 2021,
  so **no replay parsed at all**; and the fetched Python was run through `Function()`.
- `fourcc` fields (hero handles in mastery tiers, the disabled-hero list) were decoded
  with four 8-bit reads instead of one 32-bit read and came out as **garbage** whenever
  unaligned — which is always. Verified against Blizzard's decoders now.
- 32-bit fields with the top bit set decoded as **negative** numbers.
- `long` was an undeclared dependency that only resolved by accident.
- The header was decoded with a 2015 protocol only, so fields added since
  (`m_ngdpRootKey`, `m_replayCompatibilityHash`) were silently missing.

## Licence

MIT. The bundled protocol definitions are generated from
[Blizzard/heroprotocol](https://github.com/Blizzard/heroprotocol) (MIT, © Blizzard
Entertainment); the decoders are a port of the same. Descends from `@heroesbrowser/heroprotocol`.
