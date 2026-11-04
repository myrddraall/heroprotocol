# heroprotocol

Heroes of the Storm replay tooling, as a pnpm workspace:

| Package                                                                 | What it is                                                                                                     | Status             |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------ |
| [`@myrddraall/heroprotocol`](./packages/heroprotocol)                   | the parser: protocols as data, best-effort decoding, browser and Node                                          | **Stage 1 — done** |
| [`@myrddraall/heroprotocol-db`](./packages/heroprotocol-db)             | the normalized replay model, analyser framework, IndexedDB store, ingest worker + client                       | **done**           |
| [`@myrddraall/heroprotocol-analysis`](./packages/heroprotocol-analysis) | the ten built-in analysers and the batteries-included ingest worker                                            | **Stage 5 — done** |
| [`@myrddraall/hero-data`](./packages/hero-data)                         | hero, talent, ability and award names and images — injectable provider loading HeroesToolChest data at runtime | **Stage 6 — done** |

Continues [`myrddraall/heroesbrowser-heroprotocol`](https://github.com/myrddraall/heroesbrowser-heroprotocol),
whose history this repository carries. The predecessor package `@heroesbrowser/heroprotocol`
remains on the public npm registry at 0.1.2 and is not maintained.

## Working on it

Requires Node >= 24 and pnpm. Installing pulls the `@cpdevtools` release toolchain and
`@myrddraall/mpq` from GitHub Packages, so `GITHUB_TOKEN` must be set.

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm check                                          # pinned dependency versions agree
pnpm run fetch.fixtures       # three public replays for the e2e tests (gitignored)
pnpm run generate.protocols   # refresh bundled protocols from Blizzard (formatted, ready to commit)
pnpm run generate.goldens     # regenerate heroprotocol-db's normalized goldens from the fixture replays
pnpm run generate.analysis-goldens  # regenerate heroprotocol-analysis's result goldens
pnpm run test.smoke           # ingest a fixture replay through the worker in Chromium (examples/vite-smoke; needs a browser)
```

The end-to-end tests compare against Blizzard's own Python decoders (committed goldens in
`packages/heroprotocol/test/fixtures/golden`); the replays themselves are fetched, never
committed, and the specs skip when absent.

## Hand-off to the viewer

See [docs/viewer-handoff.md](./docs/viewer-handoff.md) for how `heroesbrowser-replay-viewer`
consumes these packages and which old analyser maps to which result.

## Releasing

Through [git-flow](https://github.com/cpdevtools/git-flow): versions live in `.publish/versions.yml`,
every manifest carries `0.0.0-MAIN`. `pnpm gitflow version`, push, review the draft release PR, merge.

## Legal

heroprotocol is a free, non-commercial fan project. It is not affiliated with, endorsed,
sponsored or approved by Blizzard Entertainment.

Heroes of the Storm is a trademark of Blizzard Entertainment, Inc., in the U.S. and/or other
countries. Blizzard Entertainment is a trademark or registered trademark of Blizzard
Entertainment, Inc., in the U.S. and/or other countries. All other trademarks are the property
of their respective owners. Blizzard's own notices are on its
[copyright notices page](https://www.blizzard.com/en-us/legal/9c9cb70b-d1ed-4e17-998a-16c6df46be7b/copyright-notices).

The bundled protocol definitions are generated from Blizzard's
[heroprotocol](https://github.com/Blizzard/heroprotocol) (MIT licence, Copyright 2015-2021
Blizzard Entertainment), and the decoders are a port of it. Replays, and the game data and
pictures `hero-data` points to, belong to Blizzard Entertainment, Inc. No replays are committed:
the tests fetch public ones.

The code is MIT licensed: see [LICENSE](./LICENSE). The licence covers this project's own code,
not Blizzard's game content.
