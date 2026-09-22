# heroprotocol

Heroes of the Storm replay tooling, as a pnpm workspace:

| Package                                                     | What it is                                                                         | Status                                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [`@myrddraall/heroprotocol`](./packages/heroprotocol)       | the parser: protocols as data, best-effort decoding, browser and Node              | **Stage 1 — done**                                                     |
| [`@myrddraall/heroprotocol-db`](./packages/heroprotocol-db) | the normalized replay model, analyser framework, IndexedDB store and ingest worker | **Stage 3 — model, normalizer, analysers, Dexie store, inline ingest** |
| `@myrddraall/heroprotocol-analysis`                         | analysers over the model, run at ingest or lazily                                  | planned                                                                |
| `@myrddraall/hero-data`                                     | injectable hero/talent metadata provider                                           | planned                                                                |

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
```

The end-to-end tests compare against Blizzard's own Python decoders (committed goldens in
`packages/heroprotocol/test/fixtures/golden`); the replays themselves are fetched, never
committed, and the specs skip when absent.

## Releasing

Through [git-flow](https://github.com/cpdevtools/git-flow): versions live in `.publish/versions.yml`,
every manifest carries `0.0.0-MAIN`. `pnpm gitflow version`, push, review the draft release PR, merge.

MIT — see [LICENSE](./LICENSE).
