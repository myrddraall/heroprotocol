import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HEROES_ASSETS_BASE,
  HEROES_DATA_RAW,
  HEROES_DATA_TREE_API,
  heroesAssetsProvider,
  heroesImages,
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
      src: `https://cdn.jsdelivr.net/gh/HeroesToolChest/heroes-images@main/heroesimages/heroportraits/${sonya.portraits.minimap}`,
    });
  });
});
