# heroprotocol-db Vite smoke test

A plain Vite app that ingests a replay through a `createWorker`-built web worker,
renders the `IngestStatus` stream, observes `liveQuery` on the main thread, bakes in
custom analysers (one `ready`, one `background`, one parameterized `lazy`) and reads
their `derived` rows. A Playwright test drives it in Chromium in two modes:
`?mode=worker` (the standard `new Worker(new URL('./worker.ts', import.meta.url))`
pattern) and `?mode=url` (`createReplayDb({ workerUrl })` from Vite's `?worker&url`).

```bash
pnpm run fetch.fixtures        # the replay it ingests (never committed)
pnpm run test.smoke            # build the library, build + preview the app, run Playwright
pnpm --filter @myrddraall/heroprotocol-vite-smoke dev   # poke at it by hand
```

The lockfile pins `@playwright/test` 1.50 on purpose: it is the last line that ships
Chromium builds for Debian 11, which the devcontainer runs. Newer Playwright works
anywhere else.

The only Vite configuration it needs is `worker: { format: 'es' }` — see
[vite.config.ts](./vite.config.ts) for why. Not part of CI: it needs a browser and the
fixture replays.
