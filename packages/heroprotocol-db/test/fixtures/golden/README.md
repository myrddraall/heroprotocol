# Normalized goldens

One gzipped JSON per fixture replay, produced by `pnpm run generate.goldens` from
`normalizeReplay()` with a fixed `ingestedAt`. Each holds the `ReplayRecord`, every
`players` and `scoreResults` row in full, and for the large collections the row
count, a checksum over every numeric field and the first/last rows. The replays
themselves are never committed (they carry third parties' BattleTags); fetch them
with `pnpm run fetch.fixtures`.

Regenerate only for an intentional normalizer change, and bump `NORMALIZE_VERSION`
when stored replays should be re-normalized because of it.
