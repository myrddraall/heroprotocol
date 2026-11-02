import { createHeroDataSet } from './dataSet.js';
import { readHeroesData2, readMaps5 } from './heroesData2.js';
import { applyJsonPatch, type JsonPatchOperation } from './jsonPatch.js';
import {
  heroesToolChestProvider,
  nearest,
  toolChestFiles,
  type HeroesToolChestOptions,
} from './providers.js';
import type {
  HeroData,
  HeroDataBuild,
  HeroDataOptions,
  HeroDataProvider,
  HeroDataSet,
  PictureIndex,
} from './types.js';
import type {
  RawAwards5,
  RawGameStrings5,
  RawHeroData5,
  RawMapData5,
  RawMapStrings5,
} from './heroesData2.js';

/** heroes-assets' site: both channels, each build's data and pictures. */
export const HEROES_ASSETS_BASE = 'https://myrddraall.github.io/heroes-assets';

export interface HeroesAssetsOptions extends HeroesToolChestOptions {
  /** heroes-assets' site (default: its GitHub Pages). */
  readonly assetsBaseUrl?: string;
}

const CHANNELS = ['live', 'ptr'] as const;
type Channel = (typeof CHANNELS)[number];

/** The site's `index.json`: what each channel holds now. */
type SiteIndex = Partial<Record<Channel, { readonly game: string; readonly version: string }>>;

/** A stored past build: per file (named with `{build}`), how the build after it turns into it. */
interface StoredPatch {
  readonly patch: Readonly<
    Record<string, JsonPatchOperation[] | { readonly full: unknown } | null>
  >;
}

const buildOf = (game: string): number => Number(game.split('.').pop());

/**
 * Hero data and pictures from heroes-assets (97039 on, live and PTR), and from HeroesToolChest's
 * archived heroes-data for the builds before it. A channel's newest build is read as HDP wrote
 * it (`<channel>/raw/`); a past one is rebuilt from it with the stored patches
 * (`<channel>/raw/history/`), newest first, and its pictures the same way from `pictures.json`
 * and the published history. Files are cached by the release that published them, so each
 * downloads once; the site's index is read fresh each session, so a new build shows without a
 * redeploy. Loaded sets are memoized per build and locale.
 */
export function heroesAssetsProvider(options: HeroesAssetsOptions = {}): HeroDataProvider {
  const site = (options.assetsBaseUrl ?? HEROES_ASSETS_BASE).replace(/\/$/, '');
  const files = toolChestFiles(options);
  const older = heroesToolChestProvider(options);
  const memo = new Map<string, Promise<HeroData>>();
  let index: Promise<SiteIndex> | undefined;
  let buildList: Promise<readonly HeroDataBuild[]> | undefined;

  const siteIndex = (): Promise<SiteIndex> => {
    index ??= files
      .fresh('heroes-assets/index.json', `${site}/index.json`)
      .then((text) => JSON.parse(text) as SiteIndex);
    index.catch(() => (index = undefined));
    return index;
  };

  /** A file of a channel's release: cached for good, under the release that published it. */
  const published = async (channel: Channel, path: string): Promise<string> => {
    const release = (await siteIndex())[channel]!.version;
    const key = `heroes-assets/${channel}/${release}/${path}`;
    const cached = await options.cache?.get(key);
    if (cached !== undefined) return cached;
    const body = await files.get(`${site}/${channel}/${path}`);
    await options.cache?.set(key, body);
    return body;
  };
  const json = async <T>(channel: Channel, path: string): Promise<T> =>
    JSON.parse(await published(channel, path)) as T;

  /** A channel's builds, newest first: its own, then its past ones. */
  const channelGames = async (channel: Channel): Promise<string[]> => {
    const current = (await siteIndex())[channel];
    if (!current) return [];
    const past = await json<{ game: string }[]>(channel, 'raw/history/index.json').catch(() => []);
    return [current.game, ...past.map((p) => p.game)];
  };

  const builds = (): Promise<readonly HeroDataBuild[]> => {
    buildList ??= (async () => {
      const assets: HeroDataBuild[] = [];
      for (const channel of CHANNELS) {
        for (const game of await channelGames(channel).catch(() => [])) {
          assets.push({
            build: buildOf(game),
            version: game.split('.').slice(0, 3).join('.'),
            ptr: channel === 'ptr',
            directory: `${channel}/${game}`,
            source: 'heroes-assets',
          });
        }
      }
      // heroes-assets starts at 97039; heroes-data (archived) has the builds before
      const oldest = Math.min(...assets.map((b) => b.build));
      const archived = (await older.builds().catch(() => [])).filter(
        (b) => b.source === 'heroes-data' && b.build < oldest,
      );
      if (assets.length === 0) return older.builds();
      return [...archived, ...assets].sort((a, b) => a.build - b.build);
    })();
    buildList.catch(() => (buildList = undefined));
    return buildList;
  };

  /**
   * A build's files, by name with `{build}`: the channel's newest as published, then each past
   * build's patches applied in turn down to `game`. A file the build lacks is `undefined`.
   */
  const rawFiles = async (
    channel: Channel,
    game: string,
    names: readonly string[],
  ): Promise<Map<string, unknown>> => {
    const games = await channelGames(channel);
    const current = buildOf(games[0]!);
    const docs = new Map<string, unknown>();
    await Promise.all(
      names.map(async (name) => {
        const doc = await json<unknown>(
          channel,
          `raw/${name.replace('{build}', String(current))}`,
        ).catch(() => undefined);
        if (doc !== undefined) docs.set(name, doc);
      }),
    );
    for (const past of games.slice(1, games.indexOf(game) + 1)) {
      const { patch } = await json<StoredPatch>(channel, `raw/history/${past}.json`);
      applyPatches(docs, patch, names);
    }
    return docs;
  };

  /** A build's pictures (`pictures.json`), the same way from the published history. */
  const pictures = async (channel: Channel, game: string): Promise<PictureIndex | undefined> => {
    try {
      const games = await channelGames(channel);
      const docs = new Map<string, unknown>([
        ['pictures.json', await json<unknown>(channel, 'pictures.json')],
      ]);
      for (const past of games.slice(1, games.indexOf(game) + 1)) {
        const { patch } = await json<StoredPatch>(channel, `history/${past}.json`);
        applyPatches(docs, patch, ['pictures.json']);
      }
      const index = docs.get('pictures.json') as Omit<PictureIndex, 'base'>;
      return { base: `${site}/${channel}/`, files: index.files, maps: index.maps };
    } catch {
      return undefined; // pictures then come from heroes-images
    }
  };

  const load = (entry: HeroDataBuild, locale: string): Promise<HeroData> => {
    const key = `${entry.directory}/${locale}`;
    let p = memo.get(key);
    if (!p) {
      const [channel, game] = entry.directory.split('/') as [Channel, string];
      const names = {
        heroes: 'data/herodata_{build}.json',
        awards: 'data/matchawarddata_{build}.json',
        maps: 'data/mapdata_{build}.json',
        strings: `gamestrings/gamestrings_{build}_${locale}.json`,
        mapStrings: `gamestrings/gamestrings_mapdata_{build}_${locale}.json`,
      };
      p = Promise.all([
        rawFiles(channel, game, Object.values(names)),
        pictures(channel, game),
      ]).then(([docs, pictureIndex]) => {
        const heroes = docs.get(names.heroes) as RawHeroData5 | undefined;
        const strings = docs.get(names.strings) as RawGameStrings5 | undefined;
        if (!heroes || !strings)
          throw new Error(`hero-data: ${entry.directory} has no hero data in ${locale}`);
        const mapData = docs.get(names.maps) as RawMapData5 | undefined;
        return {
          build: entry.build,
          source: 'heroes-assets' as const,
          locale,
          ...readHeroesData2(heroes, docs.get(names.awards) as RawAwards5 | undefined, strings),
          maps: mapData
            ? readMaps5(mapData, docs.get(names.mapStrings) as RawMapStrings5 | undefined)
            : {},
          ...(pictureIndex && { pictures: pictureIndex }),
        };
      });
      memo.set(key, p);
      p.catch(() => memo.delete(key));
    }
    return p;
  };

  const serve = async (build: number | undefined, opts: HeroDataOptions): Promise<HeroDataSet> => {
    const all = await builds();
    const served = options.includePtr ? all : all.filter((b) => !b.ptr);
    const list = served.length > 0 ? served : all;
    const chosen =
      build === undefined
        ? Math.max(...list.map((b) => b.build))
        : nearest(
            list.map((b) => b.build),
            build,
          );
    const entry = list.find((b) => b.build === chosen)!;
    if (entry.source !== 'heroes-assets') {
      return createHeroDataSet(await older.forBuild(entry.build, opts), build ?? chosen);
    }
    return createHeroDataSet(await load(entry, opts.locale ?? 'enus'), build ?? chosen);
  };

  return {
    forBuild: (build, opts = {}) => serve(build, opts),
    latest: (opts = {}) => serve(undefined, opts),
    builds,
  };
}

/** Applies a stored patch to the named files (in place: the docs are this load's own copies). */
function applyPatches(
  docs: Map<string, unknown>,
  patch: StoredPatch['patch'],
  names: readonly string[],
): void {
  for (const name of names) {
    const change = patch[name];
    if (change === undefined) continue;
    if (change === null) docs.delete(name);
    else if (Array.isArray(change)) docs.set(name, applyJsonPatch(docs.get(name), change));
    else docs.set(name, structuredClone(change.full));
  }
}
