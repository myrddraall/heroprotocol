import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compileHeroData,
  createHeroDataSet,
  type RawAwards,
  type RawGameStrings,
  type RawHeroData,
} from '../src/compile.js';
import { KNOWN_BUILDS } from '../src/data/builds.js';
import {
  heroesToolChestProvider,
  nearest,
  parseBuildDirectories,
  staticHeroData,
  type TextCache,
} from '../src/providers.js';

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
const heroes = JSON.parse(fixture('herodata_96370_trimmed.json')) as RawHeroData;
const awards = JSON.parse(fixture('matchawarddata_96370.json')) as RawAwards;
const strings = JSON.parse(fixture('gamestrings_96370_enus_trimmed.json')) as RawGameStrings;
const data = compileHeroData({ build: 96370, locale: 'enus', heroes, awards, strings });

describe('compileHeroData', () => {
  it('resolves the ids a replay carries to names', () => {
    const set = createHeroDataSet(data);
    // hero: internal id (lobby / PlayerSpawned), attribute id, unit id, display name
    for (const key of ['Barbarian', 'Barb', 'HeroBarbarian', 'Sonya', 'sonya'])
      expect(set.hero(key)?.name, key).toBe('Sonya');
    expect(set.hero('Barbarian')).toMatchObject({
      role: 'Warrior',
      expandedRole: 'Bruiser',
      title: 'Wandering Barbarian',
      franchise: 'Diablo',
      attributeId: 'Barb',
    });
    expect(set.heroName('Malthael')).toBe('Malthael');
    expect(set.heroName('NotAHero')).toBe('NotAHero');
    // talents: TalentChosen.PurchaseName is the nameId
    for (const [id, name, level] of [
      ['BarbarianWarPaint', 'War Paint', 1],
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
    expect(set.hero('Barbarian')!.talents.map((t) => t.level)).toEqual(
      [...set.hero('Barbarian')!.talents.map((t) => t.level)].sort((a, b) => a - b),
    );
    expect(
      set.hero('Barbarian')!.talents.filter((t) => t.level === 20).length,
    ).toBeGreaterThanOrEqual(3);
    // abilities
    expect(set.ability('BarbarianAncientSpear')).toMatchObject({
      name: 'Ancient Spear',
      abilityType: 'Q',
      kind: 'basic',
      heroId: 'Barbarian',
    });
    // awards: id, gameLink, or the stripped score-screen name — including the one without the Boolean suffix
    expect(set.award('ClutchHealer')?.name).toBe('Clutch Healer');
    expect(set.award('EndOfMatchAwardClutchHealerBoolean')?.name).toBe('Clutch Healer');
    expect(set.award('MVP')?.name).toBe('MVP');
    expect(set.award('MostAltarDamageDone')?.id).toBe('MostAltarDamage');
    expect(Object.keys(data.awards)).toHaveLength(38);
  });

  it('is plain JSON', () => {
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });
});

describe('build selection', () => {
  it('serves the highest build at or below the request, else the lowest', () => {
    expect(nearest([76003, 85267, 96370], 85267)).toBe(85267);
    expect(nearest([76003, 85267, 96370], 90000)).toBe(85267);
    expect(nearest([76003, 85267, 96370], 100000)).toBe(96370);
    expect(nearest([76003, 85267, 96370], 66488)).toBe(76003);
  });

  it('parses directory names and ships a bundled index', () => {
    expect(
      parseBuildDirectories(['2.55.15.96370', '2.48.0.76268_ptr', 'junk', '2.47.2.76003']),
    ).toEqual([
      { build: 76003, version: '2.47.2', ptr: false, directory: '2.47.2.76003' },
      { build: 76268, version: '2.48.0', ptr: true, directory: '2.48.0.76268_ptr' },
      { build: 96370, version: '2.55.15', ptr: false, directory: '2.55.15.96370' },
    ]);
    expect(KNOWN_BUILDS.length).toBeGreaterThan(100);
    expect(KNOWN_BUILDS[0]!.build).toBe(76003);
    expect(KNOWN_BUILDS.at(-1)!.build).toBeGreaterThanOrEqual(96370);
    for (let i = 1; i < KNOWN_BUILDS.length; i++)
      expect(KNOWN_BUILDS[i]!.build).toBeGreaterThanOrEqual(KNOWN_BUILDS[i - 1]!.build);
  });
});

describe('providers', () => {
  it('staticHeroData serves compiled sets and flags inexact builds', async () => {
    const provider = staticHeroData([data, { ...data, build: 80000 }]);
    const exact = await provider.forBuild(96370);
    expect(exact.exact).toBe(true);
    const older = await provider.forBuild(85267);
    expect(older).toMatchObject({ build: 80000, requestedBuild: 85267, exact: false });
    expect((await provider.forBuild(70000)).build).toBe(80000);
  });

  it('heroesToolChestProvider fetches the nearest non-PTR build once, through the cache, and compiles it', async () => {
    const urls: string[] = [];
    const files: Record<string, unknown> = {
      'herodata_85267_localized.json': heroes,
      'matchawarddata_85267_localized.json': awards,
      'gamestrings_85267_enus.json': strings,
    };
    const fetchImpl = async (url: string) => {
      urls.push(url);
      const name = url.split('/').at(-1)!;
      const body = files[name];
      return {
        ok: body !== undefined,
        status: body !== undefined ? 200 : 404,
        text: async () => JSON.stringify(body),
      };
    };
    const store = new Map<string, string>();
    const cache: TextCache = {
      get: async (k) => store.get(k),
      set: async (k, v) => void store.set(k, v),
    };
    const provider = heroesToolChestProvider({
      fetch: fetchImpl,
      cache,
      builds: parseBuildDirectories([
        '2.47.2.76003',
        '2.50.0.85267',
        '2.51.0.86000_ptr',
        '2.55.15.96370',
      ]),
    });
    const set = await provider.forBuild(85900); // 86000 is PTR → 85267
    expect(set).toMatchObject({ build: 85267, requestedBuild: 85900, exact: false });
    expect(set.talentName('BarbarianWarPaint')).toBe('War Paint');
    expect(urls).toHaveLength(3);
    expect(urls[0]).toBe(
      'https://raw.githubusercontent.com/HeroesToolChest/heroes-data/master/heroesdata/2.50.0.85267/data/herodata_85267_localized.json',
    );
    expect(store.size).toBe(3);

    // memoized per build+locale: no more fetches; a different requested build with the same nearest reuses the compile
    const again = await provider.forBuild(85267);
    expect(again.exact).toBe(true);
    expect(urls).toHaveLength(3);

    // a fresh provider with the same cache reads from it instead of the network
    const cachedOnly = heroesToolChestProvider({
      fetch: async () => {
        throw new Error('network');
      },
      cache,
      builds: parseBuildDirectories(['2.50.0.85267']),
    });
    expect((await cachedOnly.forBuild(85267)).heroName('Barbarian')).toBe('Sonya');

    // awards are optional; a 404 there still yields a set
    const noAwards = heroesToolChestProvider({
      fetch: async (url: string) =>
        url.includes('matchaward')
          ? { ok: false, status: 404, text: async () => '' }
          : fetchImpl(url),
      builds: parseBuildDirectories(['2.50.0.85267']),
    });
    expect(Object.keys((await noAwards.forBuild(85267)).awards)).toHaveLength(0);
    // a missing hero file fails loudly
    const broken = heroesToolChestProvider({
      fetch: async () => ({ ok: false, status: 500, text: async () => '' }),
      builds: parseBuildDirectories(['2.50.0.85267']),
    });
    await expect(broken.forBuild(85267)).rejects.toThrow(/500/);
  });

  it('refreshBuilds re-reads the directory list from the tree API', async () => {
    const fetchImpl = async (url: string) => ({
      ok: true,
      status: 200,
      text: async () =>
        url.endsWith('/master')
          ? JSON.stringify({ tree: [{ path: 'heroesdata', sha: 'abc' }] })
          : JSON.stringify({ tree: [{ path: '2.60.0.99000' }, { path: '2.47.2.76003' }] }),
    });
    const provider = heroesToolChestProvider({
      fetch: fetchImpl,
      builds: parseBuildDirectories(['2.47.2.76003']),
    });
    const builds = await provider.refreshBuilds();
    expect(builds.map((b) => b.build)).toEqual([76003, 99000]);
  });
});
