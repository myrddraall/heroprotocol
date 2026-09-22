import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const LOCAL = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'packages',
  'heroprotocol',
  'test',
  'fixtures',
  'local',
);
const replay = existsSync(LOCAL)
  ? readdirSync(LOCAL).find((f) => /\.stormreplay$/i.test(f))
  : undefined;

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    console.log('--- #status ---\n' + (await page.locator('#status').textContent()));
    console.log('--- #derived ---\n' + (await page.locator('#derived').textContent()));
    console.log('--- #analysers --- ' + (await page.locator('#analysers').textContent()));
  }
});

for (const mode of ['worker', 'url'] as const) {
  test(`ingests a replay through the worker (${mode} mode), streams status, liveQuery updates, custom and lazy analysers`, async ({
    page,
  }) => {
    test.skip(!replay, 'no fixture replay — run `pnpm run fetch.fixtures`');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
    });
    await page.goto(`/?mode=${mode}`);
    await expect(page.locator('#mode')).toHaveText(mode);
    await expect(page.locator('#analysers')).toContainText('smoke/hero-count:ready');

    await page.setInputFiles('#file', join(LOCAL, replay!));
    // liveQuery on the main thread sees the worker's writes as they land
    const row = page.locator('#replays tr');
    await expect(row).toHaveCount(1, { timeout: 60_000 });
    await expect(row).toHaveAttribute('data-status', 'complete', { timeout: 60_000 });
    await expect(page.locator('#status')).toContainText(
      'phases: parsing → normalizing → writing → analysing-ready → analysing-background → complete',
    );
    await expect(page.locator('#status')).toContainText('trackerEvents=ok');
    await expect(page.locator('#status')).toContainText('smoke/commands-per-player=done');

    // the custom analyser's derived row, and the lazy one after its first request
    await expect(page.locator('#derived')).toContainText('smoke/hero-count - v1 → 10');
    await expect(page.locator('#derived')).toContainText('smoke/commands-per-player');
    await expect(page.locator('#derived')).toContainText('smoke/deaths-near');

    const result = await page.waitForFunction(
      () => (window as unknown as { smokeResult?: unknown }).smokeResult,
    );
    const value = (await result.jsonValue()) as { near: number; cached: boolean; phases: string[] };
    expect(value.cached).toBe(true);
    expect(value.near).toBeGreaterThanOrEqual(0);
    expect(errors).toEqual([]);
  });
}
