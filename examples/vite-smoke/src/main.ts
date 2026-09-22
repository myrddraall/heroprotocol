import { liveQuery } from 'dexie';
import { createReplayDb } from '@myrddraall/heroprotocol-db/client';
import type { IngestStatus } from '@myrddraall/heroprotocol-db/ingest';
// Vite's `?worker&url` gives the URL of the bundled worker — the `workerUrl` path.
import workerUrl from './worker?worker&url';

const mode = new URLSearchParams(location.search).get('mode') === 'url' ? 'url' : 'worker';
document.querySelector('#mode')!.textContent = mode;

const client =
  mode === 'url'
    ? createReplayDb({ dbName: 'smoke', workerUrl })
    : // the standard Vite worker pattern, no asset config needed
      createReplayDb({
        dbName: 'smoke',
        worker: () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
      });

const $ = (sel: string): HTMLElement => document.querySelector(sel)!;
client.ready.then(
  (a) => ($('#analysers').textContent = a.map((x) => `${x.id}:${x.mode}`).join(', ')),
);

const phases: string[] = [];
const render = (s: IngestStatus): void => {
  if (phases.at(-1) !== s.phase) phases.push(s.phase);
  const sections = Object.entries(s.sections).map(
    ([k, v]) =>
      `${k}=${v.state}${v.total ? ` ${Math.round(((v.current ?? 0) / v.total) * 100)}%` : ''}`,
  );
  const analysers = Object.entries(s.analysers).map(([k, v]) => `${k}=${v.state}`);
  $('#status').textContent = [
    `phases: ${phases.join(' → ')}`,
    `sections: ${sections.join(' ')}`,
    `analysers: ${analysers.join(' ')}`,
    `timings: ${JSON.stringify(s.timingsMs)}`,
  ].join('\n');
};

liveQuery(() => client.db.replays.toArray()).subscribe((rows) => {
  $('#replays').innerHTML = rows
    .map(
      (r) =>
        `<tr data-replay="${r.id}" data-status="${r.status}"><td>${r.map}</td><td>${r.mode}</td><td>${r.status}</td><td>${Object.values(r.rowCounts).reduce((a, b) => a + b, 0)}</td></tr>`,
    )
    .join('');
});
liveQuery(() => client.db.derived.toArray()).subscribe((rows) => {
  $('#derived').textContent =
    rows
      .map(
        (r) =>
          `${r.analyserId} ${r.paramsHash} v${r.analyserVersion} → ${JSON.stringify(r.result)}`,
      )
      .join('\n') || 'none';
});

window.addEventListener(
  'unhandledrejection',
  (e) => ($('#status').textContent += `\nERROR: ${String((e as PromiseRejectionEvent).reason)}`),
);
window.addEventListener('error', (e) => ($('#status').textContent += `\nERROR: ${e.message}`));
client.ready.catch((e) => ($('#status').textContent += `\nWORKER ERROR: ${String(e)}`));

$('#file').addEventListener('change', async (ev) => {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const job = client.ingest(new Uint8Array(await file.arrayBuffer()), {
    fileName: file.name,
    onStatus: render,
  });
  const { replayId } = await job.complete;
  // the lazy flow: first call computes in the worker, second is served from `derived`
  const near = await client.analyse(replayId, 'smoke/deaths-near', {
    params: { x: 128, y: 96, radius: 40 },
  });
  const again = await client.analyse(replayId, 'smoke/deaths-near', {
    params: { x: 128, y: 96, radius: 40 },
  });
  (window as unknown as { smokeResult: unknown }).smokeResult = {
    replayId,
    near: near.result,
    cached: again.computedAt === near.computedAt,
    phases,
  };
});
