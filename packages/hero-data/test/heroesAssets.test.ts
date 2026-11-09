import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HEROES_ASSETS_BASE,
  HEROES_DATA_RAW,
  HEROES_DATA_TREE_API,
  heroesAssetsProvider,
  heroesImages,
  scalingRank,
  scalingTotals,
  type TextCache,
} from '../src/index.js';

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

const site = HEROES_ASSETS_BASE;
const ICON = 'storm_ui_icon_sonya_ancientspear.png';
const WAR_PAINT = 'BarbarianWarPaint|BarbarianFuryWarPaintTalent|Passive|Level1';

/**
 * A fake network: heroes-assets with live 2.57.0.98348 (current) and 2.57.0.98304 (a past build
 * that renames War Paint and Towers of Doom, and whose icon for Ancient Spear is a history file),
 * PTR 2.57.0.98217 (current, no past builds); and heroes-data's archived 2.50.0.85267.
 */
function network() {
  const files = new Map<string, string>();
  const put = (url: string, body: unknown): void =>
    void files.set(url, typeof body === 'string' ? body : JSON.stringify(body));

  put(`${site}/index.json`, {
    live: { game: '2.57.0.98348', version: '2.57.9834800' },
    ptr: { game: '2.57.0.98217', version: '2.57.9821700-ptr' },
  });
  const raw = (channel: string, build: number) => {
    const at = `${site}/${channel}/raw`;
    put(`${at}/data/herodata_${build}.json`, fixture('herodata_98025_trimmed.json'));
    put(`${at}/data/matchawarddata_${build}.json`, fixture('matchawarddata_98025.json'));
    put(`${at}/data/mapdata_${build}.json`, fixture('mapdata_98025_trimmed.json'));
    put(
      `${at}/gamestrings/gamestrings_${build}_enus.json`,
      fixture('gamestrings_98025_enus_trimmed.json'),
    );
    put(
      `${at}/gamestrings/gamestrings_mapdata_${build}_enus.json`,
      fixture('gamestrings_mapdata_98025_enus_trimmed.json'),
    );
  };
  raw('live', 98348);
  raw('ptr', 98217);
  put(`${site}/live/raw/history/index.json`, [{ game: '2.57.0.98304', origin: 'hdp' }]);
  put(`${site}/live/raw/history/2.57.0.98304.json`, {
    game: '2.57.0.98304',
    patch: {
      'gamestrings/gamestrings_{build}_enus.json': [
        {
          op: 'replace',
          path: `/items/talent/name/${WAR_PAINT.replaceAll('/', '~1')}`,
          value: 'War Paint II',
        },
      ],
      'gamestrings/gamestrings_mapdata_{build}_enus.json': [
        { op: 'replace', path: '/items/map/name/Towers of Doom', value: 'Towers of Doom II' },
      ],
      'data/skindata_{build}.json': null,
    },
  });
  put(`${site}/ptr/raw/history/index.json`, []);

  put(`${site}/live/pictures.json`, {
    files: {
      [ICON]: {
        sheet: 'heroes/sheets/Barbarian/hero.webp',
        rect: [0, 128, 128, 128],
        size: [512, 640],
      },
      'storm_ui_mvp_mvp_gold.png': {
        sheet: 'awards/awards.webp',
        rect: [10, 20, 30, 40],
        size: [100, 200],
      },
      'storm_emoji_cat_blink_anim_sheet.apng': {
        file: 'emoticons/animated/storm_emoji_cat_blink_anim_sheet.webp',
      },
    },
    maps: {
      garden_of_terror: { replayPreview: 'maps/images/replayspreviewimage_gardenofterror.webp' },
      towers_of_doom: {
        replayPreview: 'maps/images/replayspreviewimage_towersofdoom.webp',
        replayPreviewSheet: {
          sheet: 'maps/previews.webp',
          rect: [419, 0, 417, 234],
          size: [2560, 2856],
        },
      },
    },
  });
  put(`${site}/live/history/index.json`, [
    { game: '2.57.0.98304', origin: 'hdp', patch: '2.57.0.98304.json' },
  ]);
  put(`${site}/live/history/2.57.0.98304.json`, {
    game: '2.57.0.98304',
    patch: {
      'pictures.json': [
        { op: 'replace', path: `/files/${ICON}/sheet`, value: '../files/abc.webp' },
      ],
    },
  });

  // live's camps and unit cards for Infernal Shrines (heroes-assets' built maps/ and strings)
  put(`${site}/live/maps/index.json`, {
    infernal_shrines: {
      key: 'Infernal Shrines',
      normalizedId: 'infernal_shrines',
      sheet: 'sheets/infernal_shrines.webp',
      icons: {
        storm_ui_ingame_targetinfopanel_unit_boe_building_fort_heaven: [0, 0, 64, 64],
        storm_ui_ingame_targetinfopanel_unit_boe_building_fort_hell: [64, 0, 64, 64],
      },
      units: 'units/infernal_shrines.json',
    },
    garden_of_terror: {
      key: 'Garden of Terror',
      normalizedId: 'garden_of_terror',
      sheet: null,
      icons: {},
      units: null,
    },
  });
  put(`${site}/live/maps/units/infernal_shrines.json`, {
    scalingTicks: { tickSeconds: 60, maxTicks: 60 },
    camps: [
      {
        id: 'SiegeCamp1',
        category: 'siege',
        defenders: [{ unit: 'MercSiegeTrooperDefender', count: 3 }],
        mercs: [{ unit: 'MercSiegeTrooperLaner', count: 3 }],
        respawnSeconds: 180,
        firstSpawnSeconds: 30,
        elite: false,
        soloable: true,
        captureXp: 0,
        defenderScaling: 'MercSiegeTrooperDefenderScaling',
        mercScaling: 'MercSiegeTrooperLanerScaling',
        levels: [],
      },
    ],
    units: {
      TownTownHallL2: {
        damageType: 'Structure',
        life: { amount: 17380, scale: 0, regenRate: 0, regenScale: 0 },
        weapons: [
          {
            nameId: 'TownHallL2Weapon',
            range: 8,
            minimumRange: 0,
            period: 1,
            damage: 375,
            damageScale: 0,
          },
        ],
        attributes: ['Structure'],
        portraits: [
          'storm_ui_ingame_targetinfopanel_unit_boe_building_fort_heaven',
          'storm_ui_ingame_targetinfopanel_unit_boe_building_fort_hell',
        ],
      },
    },
    scaling: {
      MercSiegeTrooperLanerScaling: [
        {},
        { 'VitalMaxArray.Life': 40, 'DamageDealtScaled.Basic': 1 },
      ],
    },
  });
  put(`${site}/live/strings/en-US/maps.json`, {
    infernal_shrines: {
      name: 'Infernal Shrines',
      camps: { SiegeCamp1: 'Impaler' },
      units: { TownTownHallL2: { name: 'Fort', description: null } },
    },
  });

  // heroes-data (archived): one old build
  put(HEROES_DATA_TREE_API, { tree: [{ path: 'heroesdata', sha: 'abc' }] });
  put(HEROES_DATA_TREE_API.replace(/master$/, 'abc'), { tree: [{ path: '2.50.0.85267' }] });
  const old = `${HEROES_DATA_RAW}/2.50.0.85267`;
  put(`${old}/data/herodata_85267_localized.json`, fixture('herodata_96370_trimmed.json'));
  put(`${old}/data/matchawarddata_85267_localized.json`, fixture('matchawarddata_96370.json'));
  put(
    `${old}/gamestrings/gamestrings_85267_enus.json`,
    fixture('gamestrings_96370_enus_trimmed.json'),
  );

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

describe('heroesAssetsProvider', () => {
  it("lists both channels' builds, current and past, and heroes-data's older ones", async () => {
    const builds = await heroesAssetsProvider({ fetch: network().fetch }).builds();
    expect(builds.map((b) => [b.build, b.source, b.ptr, b.directory])).toEqual([
      [85267, 'heroes-data', false, '2.50.0.85267'],
      [98217, 'heroes-assets', true, 'ptr/2.57.0.98217'],
      [98304, 'heroes-assets', false, 'live/2.57.0.98304'],
      [98348, 'heroes-assets', false, 'live/2.57.0.98348'],
    ]);
  });

  it("serves a channel's newest build as published, with its pictures", async () => {
    const set = await heroesAssetsProvider({ fetch: network().fetch }).latest();
    expect(set).toMatchObject({ build: 98348, source: 'heroes-assets', exact: true });
    expect(set.hero('Barbarian')?.name).toBe('Sonya');
    expect(set.talent('BarbarianWarPaint')?.name).toBe('War Paint');
    expect(set.award('MVP')?.name).toBe('MVP');
    expect(set.map('Towers of Doom')?.name).toBe('Towers of Doom');
    expect(set.pictures?.base).toBe(`${site}/live/`);
  });

  it('rebuilds a past build from the newest with its patches, data and pictures alike', async () => {
    const set = await heroesAssetsProvider({ fetch: network().fetch }).forBuild(98310);
    expect(set).toMatchObject({ build: 98304, requestedBuild: 98310, exact: false });
    expect(set.talent('BarbarianWarPaint')?.name).toBe('War Paint II');
    expect(set.map('Towers of Doom II')?.normalizedId).toBe('towers_of_doom');
    expect(heroesImages({ data: set }).icon(set.ability('BarbarianAncientSpear')!)).toEqual({
      src: `${site}/files/abc.webp`,
      rect: [0, 128, 128, 128],
      size: [512, 640],
    });
  });

  it("serves builds before heroes-assets' oldest from heroes-data", async () => {
    const set = await heroesAssetsProvider({ fetch: network().fetch }).forBuild(90000);
    expect(set).toMatchObject({ build: 85267, source: 'heroes-data', requestedBuild: 90000 });
    expect(set.hero('Barbarian')?.name).toBe('Sonya');
    expect(set.pictures).toBeUndefined();
  });

  it('serves PTR builds only when asked to', async () => {
    const { fetch } = network();
    // without PTR, the nearest build at or below 98217 is heroes-data's 85267
    expect((await heroesAssetsProvider({ fetch }).forBuild(98217)).build).toBe(85267);
    expect((await heroesAssetsProvider({ fetch, includePtr: true }).forBuild(98217)).build).toBe(
      98217,
    );
  });

  it("caches a release's files for good and reads the site's index fresh, working offline from the cache", async () => {
    const net = network();
    const cache = memoryCache();
    await heroesAssetsProvider({ fetch: net.fetch, cache }).forBuild(98304);
    expect([...cache.store.keys()]).toContain(
      'heroes-assets/live/2.57.9834800/raw/history/2.57.0.98304.json',
    );
    net.goOffline();
    const set = await heroesAssetsProvider({ fetch: net.fetch, cache }).forBuild(98304);
    expect(set.talent('BarbarianWarPaint')?.name).toBe('War Paint II');
  });
});

describe("heroesImages with a build's pictures", () => {
  it('gives sprites in sheets and files of their own, falling back to heroes-images for a name the build lacks', async () => {
    const set = await heroesAssetsProvider({ fetch: network().fetch }).latest();
    const img = heroesImages({ data: set });
    expect(img.icon(set.ability('BarbarianAncientSpear')!)).toEqual({
      src: `${site}/live/heroes/sheets/Barbarian/hero.webp`,
      rect: [0, 128, 128, 128],
      size: [512, 640],
    });
    expect(img.award(set.award('MVP')!, 'mvp', 'gold')).toEqual({
      src: `${site}/live/awards/awards.webp`,
      rect: [10, 20, 30, 40],
      size: [100, 200],
    });
    expect(img.emoticon({ image: 'storm_emoji_cat_blink_anim_sheet.apng' })).toEqual({
      src: `${site}/live/emoticons/animated/storm_emoji_cat_blink_anim_sheet.webp`,
    });
    expect(img.map(set.map('Garden of Terror')!, 'replayPreview')).toEqual({
      src: `${site}/live/maps/images/replayspreviewimage_gardenofterror.webp`,
    });
    const sonya = set.hero('Sonya')!;
    expect(img.portrait(sonya, 'minimap')).toEqual({
      src: `https://raw.githubusercontent.com/HeroesToolChest/heroes-images/main/heroesimages/heroportraits/${sonya.portraits.minimap}`,
    });
  });
});

describe('heroesImages with a fallback build', () => {
  it("takes what a build without pictures needs from the newest build's, heroes-images only for a name neither lists", async () => {
    const latest = await heroesAssetsProvider({ fetch: network().fetch }).latest();
    // a build before heroes-assets: no pictures of its own
    const img = heroesImages({ data: {}, fallback: latest });
    expect(img.icon(latest.ability('BarbarianAncientSpear')!)).toEqual({
      src: `${site}/live/heroes/sheets/Barbarian/hero.webp`,
      rect: [0, 128, 128, 128],
      size: [512, 640],
    });
    expect(img.map(latest.map('Garden of Terror')!, 'replayPreview')).toEqual({
      src: `${site}/live/maps/images/replayspreviewimage_gardenofterror.webp`,
    });
    const sonya = latest.hero('Sonya')!;
    expect(img.portrait(sonya, 'minimap')!.src).toMatch(
      /^https:\/\/raw\.githubusercontent\.com\/HeroesToolChest\//,
    );
  });

  it("prefers the build's own pictures to the fallback's", async () => {
    const latest = await heroesAssetsProvider({ fetch: network().fetch }).latest();
    const own = {
      pictures: {
        base: 'https://example.test/old/',
        files: { 'storm_ui_icon_sonya_ancientspear.png': { file: 'old/spear.webp' } },
        maps: {},
      },
    };
    const spear = latest.ability('BarbarianAncientSpear')!;
    expect(
      heroesImages({ data: own, fallback: latest }).icon({
        ...spear,
        icon: 'storm_ui_icon_sonya_ancientspear.png',
      }),
    ).toEqual({
      src: 'https://example.test/old/old/spear.webp',
    });
  });
});

describe('heroesImages map previews', () => {
  it("gives a map's preview from the sheet of every map's, where the build has it", async () => {
    const set = await heroesAssetsProvider({ fetch: network().fetch }).latest();
    const img = heroesImages({ data: set });
    expect(img.map(set.map('Towers of Doom')!, 'replayPreview')).toEqual({
      src: `${site}/live/maps/previews.webp`,
      rect: [419, 0, 417, 234],
      size: [2560, 2856],
    });
    // a map without a place in the sheet keeps its file
    expect(img.map(set.map('Garden of Terror')!, 'replayPreview')?.rect).toBeUndefined();
  });
});

describe('map units', () => {
  it("reads a map's camps and unit cards from live's newest release, with its strings and portraits", async () => {
    const units = await heroesAssetsProvider({ fetch: network().fetch }).mapUnits!(
      'Infernal Shrines',
    );
    expect(units?.camps[0]).toMatchObject({
      id: 'SiegeCamp1',
      label: 'Impaler',
      respawnSeconds: 180,
    });
    const fort = units?.units['TownTownHallL2'];
    expect(fort?.name).toBe('Fort');
    expect(fort?.life?.amount).toBe(17380);
    expect(fort?.weapons[0]?.damage).toBe(375);
    // one per team, from the map's sheet; its size the icons' extent while the index has none
    expect(fort?.portraits).toEqual([
      {
        src: `${site}/live/maps/sheets/infernal_shrines.webp`,
        rect: [0, 0, 64, 64],
        size: [128, 64],
      },
      {
        src: `${site}/live/maps/sheets/infernal_shrines.webp`,
        rect: [64, 0, 64, 64],
        size: [128, 64],
      },
    ]);
  });

  it('finds a map by its normalized id, and has none for a map without unit cards', async () => {
    const provider = heroesAssetsProvider({ fetch: network().fetch });
    expect(await provider.mapUnits!('infernal_shrines')).not.toBeNull();
    expect(await provider.mapUnits!('garden_of_terror')).toBeNull();
    expect(await provider.mapUnits!('Nowhere')).toBeNull();
  });

  it('scales: a rank a tick a minute from the gates, capped; each field summed up to it', () => {
    const ticks = { tickSeconds: 60, maxTicks: 60 };
    const levels = [{}, { 'VitalMaxArray.Life': 40 }, { 'VitalMaxArray.Life': 40, KillXPBonus: 2 }];
    expect(scalingRank(-30, ticks, levels.length)).toBe(0);
    expect(scalingRank(119, ticks, levels.length)).toBe(1);
    // no further than the behaviour's last level
    expect(scalingRank(600, ticks, levels.length)).toBe(2);
    expect(scalingTotals(levels, 0)).toEqual({});
    expect(scalingTotals(levels, 2)).toEqual({ 'VitalMaxArray.Life': 80, KillXPBonus: 2 });
  });
});
