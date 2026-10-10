import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyJsonPatch } from '../src/jsonPatch.js';
import {
  HEROES_DATA2_RAW,
  HEROES_DATA_RAW,
  HEROES_DATA_TREE_API,
  heroesImages,
  heroesToolChestProvider,
  mergeBuilds,
  nearest,
  parseBuildDirectories,
  type HeroDataSet,
  type TextCache,
} from '../src/index.js';

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

/**
 * A fake network over both repositories:
 * - heroes-data: 2.50.0.85267 (hdp 4 files), listed through the tree API.
 * - heroes-data2: 2.55.16.97039 (full), 2.55.17.97407_ptr and 2.55.17.97605 (patches;
 *   97605 renames War Paint so the chain is observable).
 */
function network() {
  const files = new Map<string, string>();
  const put = (url: string, body: unknown): void =>
    void files.set(url, typeof body === 'string' ? body : JSON.stringify(body));

  put(HEROES_DATA_TREE_API, { tree: [{ path: 'heroesdata', sha: 'abc' }] });
  put(HEROES_DATA_TREE_API.replace(/master$/, 'abc'), {
    tree: [{ path: '2.50.0.85267' }, { path: '2.51.0.86000_ptr' }, { path: '2.55.16.97039' }],
  });
  const old = `${HEROES_DATA_RAW}/2.50.0.85267`;
  put(`${old}/data/herodata_85267_localized.json`, fixture('herodata_96370_trimmed.json'));
  put(`${old}/data/matchawarddata_85267_localized.json`, fixture('matchawarddata_96370.json'));
  put(
    `${old}/gamestrings/gamestrings_85267_enus.json`,
    fixture('gamestrings_96370_enus_trimmed.json'),
  );

  put(`${HEROES_DATA2_RAW}/.version.json`, {
    latest: '2.55.17.97605',
    versions: ['2.55.16.97039', '2.55.17.97407_ptr', '2.55.17.97605'],
  });
  const version = (dir: string, build: number, dependsOn: string) => {
    const ext = dependsOn ? '.patch.json' : '.json';
    put(`${HEROES_DATA2_RAW}/${dir}/.hdp.json`, {
      json: dependsOn ? 'patch' : 'full',
      'depends-on': dependsOn,
      extracted: true,
      files: {
        '[data]': {
          herodata: `herodata_${build}${ext}`,
          matchawarddata: `matchawarddata_${build}${ext}`,
          mapdata: `mapdata_${build}${ext}`,
        },
        '[gamestrings]': {
          enus: `gamestrings_${build}_enus${ext}`,
          'mapdata|enus': `gamestrings_mapdata_${build}_enus${ext}`,
        },
      },
    });
  };
  const root = `${HEROES_DATA2_RAW}/2.55.16.97039`;
  version('2.55.16.97039', 97039, '');
  put(`${root}/data/herodata_97039.json`, fixture('herodata_98025_trimmed.json'));
  put(`${root}/data/matchawarddata_97039.json`, fixture('matchawarddata_98025.json'));
  put(
    `${root}/gamestrings/gamestrings_97039_enus.json`,
    fixture('gamestrings_98025_enus_trimmed.json'),
  );
  put(`${root}/data/mapdata_97039.json`, fixture('mapdata_98025_trimmed.json'));
  put(
    `${root}/gamestrings/gamestrings_mapdata_97039_enus.json`,
    fixture('gamestrings_mapdata_98025_enus_trimmed.json'),
  );
  const noop = [{ op: 'replace', path: '/meta/heroesVersion', value: 'x' }];
  for (const [dir, build, dependsOn, stringsPatch] of [
    ['2.55.17.97407_ptr', 97407, '2.55.16.97039', noop],
    [
      '2.55.17.97605',
      97605,
      '2.55.17.97407_ptr',
      [
        {
          op: 'replace',
          path: '/items/talent/name/BarbarianWarPaint|BarbarianFuryWarPaintTalent|Passive|Level1',
          value: 'War Paint II',
        },
      ],
    ],
  ] as const) {
    version(dir, build, dependsOn);
    const at = `${HEROES_DATA2_RAW}/${dir}`;
    put(`${at}/data/herodata_${build}.patch.json`, noop);
    put(`${at}/data/matchawarddata_${build}.patch.json`, noop);
    put(`${at}/gamestrings/gamestrings_${build}_enus.patch.json`, stringsPatch);
    put(`${at}/data/mapdata_${build}.patch.json`, noop);
    put(
      `${at}/gamestrings/gamestrings_mapdata_${build}_enus.patch.json`,
      build === 97605
        ? [{ op: 'replace', path: '/items/map/name/Towers of Doom', value: 'Towers of Doom II' }]
        : noop,
    );
  }

  const urls: string[] = [];
  let offline = false;
  const fetch = async (url: string) => {
    urls.push(url);
    if (offline) throw new Error('offline');
    const body = files.get(url);
    return {
      ok: body !== undefined,
      status: body !== undefined ? 200 : 404,
      text: async () => body ?? '',
    };
  };
  return { fetch, urls, files, goOffline: () => void (offline = true) };
}

function memoryCache(): TextCache & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return { store, get: async (k) => store.get(k), set: async (k, v) => void store.set(k, v) };
}

/** What both sources must resolve the same way (the fixtures hold Sonya, Malthael and Zagara). */
function expectReplayIdsResolve(set: HeroDataSet): void {
  for (const key of ['Barbarian', 'Barb', 'HeroBarbarian', 'Sonya', 'sonya'])
    expect(set.hero(key)?.name, key).toBe('Sonya');
  expect(set.hero('Barbarian')).toMatchObject({
    role: 'Warrior',
    expandedRole: 'Bruiser',
    title: 'Wandering Barbarian',
    franchise: 'Diablo',
    attributeId: 'Barb',
    type: 'Melee',
  });
  expect(set.hero('Barbarian')!.portraits.minimap).toMatch(/^storm_ui_minimapicon_.+\.png$/);
  expect(set.hero('Barbarian')!.portraits.partyFrames.length).toBeGreaterThan(0);
  expect(set.heroName('Malthael')).toBe('Malthael');
  expect(set.heroName('NotAHero')).toBe('NotAHero');
  for (const [id, name, level] of [
    ['BarbarianHurricane', 'Hurricane', 4],
    ['BarbarianLifeFunnel', 'Life Funnel', 7],
    ['BarbarianHeroicAbilityWrathoftheBerserker', 'Wrath of the Berserker', 10],
    ['ZagaraMasteryCorpseFeeders', 'Corpse Feeders', 1],
    ['MalthaelFearTheReaper', 'Fear the Reaper', 1],
  ] as const) {
    expect(set.talent(id), id).toMatchObject({ name, level });
    expect(set.talentName(id)).toBe(name);
  }
  expect(set.talentName('UnknownTalent')).toBe('UnknownTalent');
  expect(set.talent('BarbarianWarPaint')?.description).toContain('Basic Attack');
  const levels = set.hero('Barbarian')!.talents.map((t) => t.level);
  expect(levels).toEqual([...levels].sort((a, b) => a - b));
  expect(
    set.hero('Barbarian')!.talents.filter((t) => t.level === 20).length,
  ).toBeGreaterThanOrEqual(3);
  expect(set.ability('BarbarianAncientSpear')).toMatchObject({
    name: 'Ancient Spear',
    abilityType: 'Q',
    kind: 'basic',
    heroId: 'Barbarian',
  });
  expect(set.ability('BarbarianFury')).toMatchObject({ kind: 'trait', abilityType: 'Trait' });
  expect(set.award('ClutchHealer')?.name).toBe('Clutch Healer');
  expect(set.award('EndOfMatchAwardClutchHealerBoolean')?.name).toBe('Clutch Healer');
  expect(set.award('MVP')?.name).toBe('MVP');
  expect(set.award('MostAltarDamageDone')?.id).toBe('MostAltarDamage');
  expect(set.award('MostDamageTaken')?.name).toBe('Bulwark');
  expect(set.award('MVP')?.mvpScreenIcon).toBe('storm_ui_mvp_mvp_%color%.png');
}

describe('heroesToolChestProvider', () => {
  it('serves builds before 97039 from heroes-data', async () => {
    const net = network();
    const set = await heroesToolChestProvider({ fetch: net.fetch }).forBuild(90000);
    expect(set).toMatchObject({
      build: 85267,
      source: 'heroes-data',
      requestedBuild: 90000,
      exact: false,
    });
    expectReplayIdsResolve(set);
    expect(set.talentName('BarbarianWarPaint')).toBe('War Paint');
    expect(Object.keys(set.awards)).toHaveLength(38);
  });

  it('serves builds from 97039 from heroes-data2, rebuilding patched versions', async () => {
    const net = network();
    const provider = heroesToolChestProvider({ fetch: net.fetch });
    const root = await provider.forBuild(97039);
    expect(root).toMatchObject({ build: 97039, source: 'heroes-data2', exact: true });
    expectReplayIdsResolve(root);
    expect(root.talentName('BarbarianWarPaint')).toBe('War Paint');
    expect(Object.keys(root.awards)).toHaveLength(40);

    // 97605 = 97039 + 97407_ptr + 97605 patches
    const patched = await provider.forBuild(97605);
    expect(patched).toMatchObject({ build: 97605, exact: true });
    expect(patched.talentName('BarbarianWarPaint')).toBe('War Paint II');
    expectReplayIdsResolve(patched);
  });

  it('picks the nearest non-PTR build, the oldest for older replays, the newest for newer ones', async () => {
    const provider = heroesToolChestProvider({ fetch: network().fetch });
    expect((await provider.forBuild(97500)).build).toBe(97039); // 97407 is PTR
    expect((await provider.forBuild(50000)).build).toBe(85267);
    expect(await provider.forBuild(99999)).toMatchObject({ build: 97605, exact: false });
    const ptr = heroesToolChestProvider({ fetch: network().fetch, includePtr: true });
    expect((await ptr.forBuild(97500)).build).toBe(97407);
  });

  it('latest() serves the newest build — the default outside a replay', async () => {
    const provider = heroesToolChestProvider({ fetch: network().fetch });
    const set = await provider.latest();
    expect(set).toMatchObject({ build: 97605, requestedBuild: 97605, exact: true });
    expect(Object.keys(set.heroes)).toEqual(['Barbarian', 'Malthael', 'Zagara']);
  });

  it('discovers builds at runtime from both repositories', async () => {
    const builds = await heroesToolChestProvider({ fetch: network().fetch }).builds();
    expect(builds.map((b) => `${b.directory}@${b.source}`)).toEqual([
      '2.50.0.85267@heroes-data',
      '2.51.0.86000_ptr@heroes-data',
      '2.55.16.97039@heroes-data2', // in both; heroes-data2 wins
      '2.55.17.97407_ptr@heroes-data2',
      '2.55.17.97605@heroes-data2',
    ]);
  });

  it('caches published files forever, re-reads the heroes-data2 index each session, and works offline from the cache', async () => {
    const cache = memoryCache();
    const first = network();
    await heroesToolChestProvider({ fetch: first.fetch, cache }).latest();
    await heroesToolChestProvider({ fetch: first.fetch, cache }).forBuild(85267);
    expect(cache.store.has('heroes-data/.builds.json')).toBe(true);

    const second = network();
    const again = heroesToolChestProvider({ fetch: second.fetch, cache });
    await again.latest();
    await again.forBuild(85267);
    // only the heroes-data2 index is fetched again; the archived listing and every file come from the cache
    expect(second.urls).toEqual([`${HEROES_DATA2_RAW}/.version.json`]);

    const offline = network();
    offline.goOffline();
    const set = await heroesToolChestProvider({ fetch: offline.fetch, cache }).latest();
    expect(set.talentName('BarbarianWarPaint')).toBe('War Paint II');
  });

  it('memoizes loaded builds per build and locale', async () => {
    const net = network();
    const provider = heroesToolChestProvider({ fetch: net.fetch });
    await provider.forBuild(97605);
    const count = net.urls.length;
    await provider.latest();
    await provider.forBuild(97700);
    expect(net.urls.length).toBe(count);
  });

  it('treats awards as optional and a missing hero file as an error', async () => {
    const net = network();
    net.files.delete(`${HEROES_DATA_RAW}/2.50.0.85267/data/matchawarddata_85267_localized.json`);
    const set = await heroesToolChestProvider({ fetch: net.fetch }).forBuild(85267);
    expect(Object.keys(set.awards)).toHaveLength(0);

    const broken = network();
    broken.files.delete(`${HEROES_DATA2_RAW}/2.55.17.97605/data/herodata_97605.patch.json`);
    await expect(heroesToolChestProvider({ fetch: broken.fetch }).latest()).rejects.toThrow(/404/);
  });
});

describe('maps', () => {
  it('resolves maps by name, normalized id, map link or map id, with objectives', async () => {
    const provider = heroesToolChestProvider({ fetch: network().fetch });
    const set = await provider.forBuild(97039);
    for (const key of [
      'Garden of Terror',
      'garden of terror',
      'garden_of_terror',
      'GardenOfTerror',
      'HauntedWoods',
    ])
      expect(set.map(key)?.id, key).toBe('Garden of Terror');
    expect(set.map('Garden of Terror')).toMatchObject({
      name: 'Garden of Terror',
      width: 256,
      height: 216,
      replayPreviewImage: 'replayspreviewimage_gardenofterror.png',
      loadingScreenImage: 'ui_ingame_mapmechanic_loadscreen_gardenofterror.png',
    });
    const objectives = set.map('Garden of Terror')!.objectives;
    expect(objectives).toHaveLength(3);
    expect(objectives[0]!.title).toBeTruthy();
    expect(objectives[0]!.icons).toEqual([
      'ui_ingame_mapmechanic_loadscreen_gardenofterror_icon1.png',
    ]);
    // variants share a map id; the map itself keeps it
    expect(set.map('Volskaya')?.id).toBe('Volskaya Foundry');
    expect(set.map('VolskayaSandbox')?.id).toBe('Sandbox (Volskaya Foundry)');
    expect(set.map('Nowhere')).toBeUndefined();
    // patched like the rest
    expect((await provider.forBuild(97605)).map('TowersOfDoom')?.name).toBe('Towers of Doom II');
  });

  it("gives heroes-data builds heroes-data2's oldest maps, and no maps rather than failing", async () => {
    const set = await heroesToolChestProvider({ fetch: network().fetch }).forBuild(85267);
    expect(set.source).toBe('heroes-data');
    expect(set.map('Towers of Doom')?.name).toBe('Towers of Doom');

    const net = network();
    net.files.delete(`${HEROES_DATA2_RAW}/2.55.16.97039/data/mapdata_97039.json`);
    const none = await heroesToolChestProvider({ fetch: net.fetch }).forBuild(97039);
    expect(none.maps).toEqual({});
    expect(none.heroName('Barbarian')).toBe('Sonya');
  });
});

describe('heroesImages', () => {
  it('builds heroes-images URLs from the data file names', async () => {
    const set = await heroesToolChestProvider({ fetch: network().fetch }).latest();
    const img = heroesImages();
    const sonya = set.hero('Sonya')!;
    const base = 'https://cdn.jsdelivr.net/gh/HeroesToolChest/heroes-images@main/heroesimages';
    expect(img.portrait(sonya, 'minimap')).toBe(`${base}/heroportraits/${sonya.portraits.minimap}`);
    expect(img.portrait(sonya, 'partyFrame')).toBe(
      `${base}/heroportraits/${sonya.portraits.partyFrames[0]}`,
    );
    expect(img.icon(set.ability('BarbarianAncientSpear')!)).toBe(
      `${base}/abilitytalents/storm_ui_icon_sonya_ancientspear.png`,
    );
    expect(img.award(set.award('MVP')!, 'mvp', 'gold')).toBe(
      `${base}/matchawards/storm_ui_mvp_mvp_gold.png`,
    );
    expect(img.award(set.award('MVP')!, 'scoreScreen', 'red')).toBe(
      `${base}/matchawards/storm_ui_scorescreen_mvp_mvp_red.png`,
    );
    const garden = set.map('Garden of Terror')!;
    expect(img.map(garden, 'replayPreview')).toBe(
      `${base}/replaypreviews/replayspreviewimage_gardenofterror.png`,
    );
    expect(img.map(garden, 'loadingScreen')).toBe(
      `${base}/loadingscreens/ui_ingame_mapmechanic_loadscreen_gardenofterror.png`,
    );
    expect(img.mapObjective(garden.objectives[0]!.icons[0]!)).toBe(
      `${base}/mapobjectives/ui_ingame_mapmechanic_loadscreen_gardenofterror_icon1.png`,
    );
    expect(heroesImages({ baseUrl: 'https://example.test/img/' }).url('x', 'y.png')).toBe(
      'https://example.test/img/x/y.png',
    );
  });
});

describe('build lists', () => {
  it('serves the highest build at or below the request, else the lowest', () => {
    expect(nearest([76003, 85267, 96370], 85267)).toBe(85267);
    expect(nearest([76003, 85267, 96370], 90000)).toBe(85267);
    expect(nearest([76003, 85267, 96370], 100000)).toBe(96370);
    expect(nearest([76003, 85267, 96370], 66488)).toBe(76003);
  });

  it('parses directory names and merges the two repositories', () => {
    const older = parseBuildDirectories(
      ['2.55.15.96370', '2.48.0.76268_ptr', 'junk', '2.55.16.97039'],
      'heroes-data',
    );
    expect(older.map((b) => b.build)).toEqual([76268, 96370, 97039]);
    expect(older[0]).toEqual({
      build: 76268,
      version: '2.48.0',
      ptr: true,
      directory: '2.48.0.76268_ptr',
      source: 'heroes-data',
    });
    const newer = parseBuildDirectories(['2.55.16.97039', '2.55.17.97605'], 'heroes-data2');
    expect(mergeBuilds(older, newer).map((b) => `${b.build}@${b.source}`)).toEqual([
      '76268@heroes-data',
      '96370@heroes-data',
      '97039@heroes-data2',
      '97605@heroes-data2',
    ]);
  });
});

describe('applyJsonPatch', () => {
  it('applies add, remove, replace, move, copy and test', () => {
    const doc = { a: { 'b/c': 1, 'd~e': 2 }, list: [1, 2, 3] as unknown[] };
    applyJsonPatch(doc, [
      { op: 'replace', path: '/a/b~1c', value: 10 },
      { op: 'remove', path: '/a/d~0e' },
      { op: 'add', path: '/list/1', value: 'x' },
      { op: 'add', path: '/list/-', value: 'end' },
      { op: 'remove', path: '/list/0' },
      { op: 'copy', from: '/a', path: '/copy' },
      { op: 'move', from: '/copy/b~1c', path: '/moved' },
      { op: 'test', path: '/moved', value: 10 },
    ]);
    expect(doc).toEqual({ a: { 'b/c': 10 }, list: ['x', 2, 3, 'end'], copy: {}, moved: 10 });
    expect(() => applyJsonPatch(doc, [{ op: 'test', path: '/moved', value: 11 }])).toThrow(
      /test failed/,
    );
    expect(() => applyJsonPatch(doc, [{ op: 'remove', path: '/nope' }])).toThrow(
      /nothing to remove/,
    );
  });
});
