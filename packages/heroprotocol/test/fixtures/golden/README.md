# Golden decode results

One `.json.gz` per fixture replay, produced by **Blizzard's own Python decoders**
(`Blizzard/heroprotocol` on GitHub, run under CPython) over the sections that
`@myrddraall/mpq` extracted from the replay. They are the oracle the TypeScript
decoders are asserted against, so a divergence here is a bug on our side by
definition.

Each file holds, for one replay: the decoded `header`, `details`, `initData` and
`attributes` in full; and for each event stream (`tracker`, `message`, `game`)
the event count, counts by kind, the sum of every integer field (a cheap exact
checksum in both languages), the last gameloop, and the first five and last three
events in full.

Bytes are decoded as UTF-8 with replacement, matching `TextDecoder`'s default.

The replays themselves are not committed (see `../local/README.md`); these
results contain player names and are ~170 KB total, which is judged acceptable
for a test oracle. Regenerate with `tools/generate-golden.py` after fetching the
fixtures.
