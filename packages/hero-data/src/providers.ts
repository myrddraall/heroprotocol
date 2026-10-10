import { createHeroDataSet } from './dataSet.js';
import {
  readHeroesData,
  type HeroDataTables,
  type RawAwards,
  type RawGameStrings,
  type RawHeroData,
} from './heroesData.js';
import {
  readHeroesData2,
  readMaps5,
  type RawAwards5,
  type RawGameStrings5,
  type RawHeroData5,
  type RawMapData5,
  type RawMapStrings5,
} from './heroesData2.js';
import { applyJsonPatch, type JsonPatchOperation } from './jsonPatch.js';
import type {
  HeroData,
  HeroDataBuild,
  HeroDataOptions,
  HeroDataProvider,
  HeroDataSet,
  HeroDataSource,
  MapInfo,
} from './types.js';

/** The build to serve for `wanted`: the highest known build ≤ wanted, else the lowest known. */
export function nearest(builds: readonly number[], wanted: number): number {
  const sorted = [...builds].sort((a, b) => a - b);
  let best = sorted[0]!;
  for (const b of sorted) if (b <= wanted) best = b;
  return best;
}

export interface FetchLike {
  (
    url: string,
    init?: { readonly signal?: unknown },
  ): Promise<{
    readonly ok: boolean;
    readonly status: number;
    text(): Promise<string>;
  }>;
}

/** Optional cache for the raw files (a few MB per build); key → file text. */
export interface TextCache {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

export interface HeroesToolChestOptions {
  readonly fetch?: FetchLike;
  readonly cache?: TextCache;
  /** Serve PTR builds too (default false). */
  readonly includePtr?: boolean;
  /** Raw content roots of the two repositories' `heroesdata/` folders (defaults: GitHub raw). */
  readonly baseUrls?: Partial<Record<HeroDataSource, string>>;
  /** Tree API URL for heroes-data's `heroesdata/` listing (default: GitHub). */
  readonly heroesDataTreeApi?: string;
  readonly timeoutMs?: number;
}

export const HEROES_DATA_RAW =
  'https://raw.githubusercontent.com/HeroesToolChest/heroes-data/master/heroesdata';
export const HEROES_DATA2_RAW =
  'https://raw.githubusercontent.com/HeroesToolChest/heroes-data2/main/heroesdata';
export const HEROES_DATA_TREE_API =
  'https://api.github.com/repos/HeroesToolChest/heroes-data/git/trees/master';

/** heroes-data2's `heroesdata/.version.json`. */
interface VersionIndex {
  readonly versions: readonly string[];
}
/** heroes-data2's per-version `.hdp.json`. */
interface VersionMeta {
  readonly json: 'full' | 'patch';
  readonly 'depends-on': string;
  readonly extracted: boolean;
  readonly files: {
    readonly '[data]'?: Readonly<Record<string, unknown>>;
    readonly '[gamestrings]'?: Readonly<Record<string, unknown>>;
  };
}

/**
 * Hero data loaded at runtime from HeroesToolChest: `heroes-data2` for builds from
 * 97039 on, and the archived `heroes-data` for older ones. Nothing is bundled — the
 * list of builds is discovered on first use (heroes-data2's `.version.json` fresh each
 * session; heroes-data's listing once, then from the cache, since it is archived), so a
 * new patch is picked up without a redeploy. Raw files go through `cache`; loaded sets
 * are memoized per build and locale.
 */
export function heroesToolChestProvider(options: HeroesToolChestOptions = {}): HeroDataProvider {
  const fetchImpl: FetchLike =
    options.fetch ?? (globalThis as unknown as { fetch: FetchLike }).fetch;
  if (!fetchImpl) throw new Error('heroesToolChestProvider: no fetch available — pass one');
  const base: Record<HeroDataSource, string> = {
    'heroes-data': (options.baseUrls?.['heroes-data'] ?? HEROES_DATA_RAW).replace(/\/$/, ''),
    'heroes-data2': (options.baseUrls?.['heroes-data2'] ?? HEROES_DATA2_RAW).replace(/\/$/, ''),
  };
  const treeApi = options.heroesDataTreeApi ?? HEROES_DATA_TREE_API;
  const memo = new Map<string, Promise<HeroData>>();
  const metas = new Map<string, Promise<VersionMeta>>();
  let buildList: Promise<readonly HeroDataBuild[]> | undefined;

  const get = async (url: string): Promise<string> => {
    const controller = typeof AbortController === 'undefined' ? undefined : new AbortController();
    const timer =
      controller && options.timeoutMs
        ? setTimeout(() => controller.abort(), options.timeoutMs)
        : undefined;
    try {
      const res = await fetchImpl(url, controller ? { signal: controller.signal } : undefined);
      if (!res.ok) throw new Error(`hero-data: ${res.status} fetching ${url}`);
      return await res.text();
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  /** A file that never changes once published: cache first, then network. */
  const immutable = async (source: HeroDataSource, path: string): Promise<string> => {
    const key = `${source}/${path}`;
    const cached = await options.cache?.get(key);
    if (cached !== undefined) return cached;
    const body = await get(`${base[source]}/${path}`);
    await options.cache?.set(key, body);
    return body;
  };

  /** A file that changes as new builds ship: network first, cache as the offline fallback. */
  const fresh = async (key: string, url: string): Promise<string> => {
    try {
      const body = await get(url);
      await options.cache?.set(key, body);
      return body;
    } catch (err) {
      const cached = await options.cache?.get(key);
      if (cached !== undefined) return cached;
      throw err;
    }
  };

  const listHeroesData = async (): Promise<HeroDataBuild[]> => {
    const key = 'heroes-data/.builds.json';
    let names = await options.cache?.get(key);
    if (names === undefined) {
      const root = JSON.parse(await get(treeApi)) as { tree: { path: string; sha: string }[] };
      const dir = root.tree.find((t) => t.path === 'heroesdata');
      if (!dir) throw new Error('hero-data: no heroesdata directory in the heroes-data tree');
      const sub = JSON.parse(await get(treeApi.replace(/[^/]+$/, dir.sha))) as {
        tree: { path: string }[];
      };
      names = JSON.stringify(sub.tree.map((t) => t.path));
      await options.cache?.set(key, names);
    }
    return parseBuildDirectories(JSON.parse(names) as string[], 'heroes-data');
  };

  const listHeroesData2 = async (): Promise<HeroDataBuild[]> => {
    const index = JSON.parse(
      await fresh('heroes-data2/.version.json', `${base['heroes-data2']}/.version.json`),
    ) as VersionIndex;
    return parseBuildDirectories(index.versions, 'heroes-data2');
  };

  const builds = (): Promise<readonly HeroDataBuild[]> => {
    buildList ??= (async () => {
      const [older, newer] = await Promise.all([
        listHeroesData().catch(() => [] as HeroDataBuild[]),
        listHeroesData2().catch(() => [] as HeroDataBuild[]),
      ]);
      if (older.length === 0 && newer.length === 0)
        throw new Error('hero-data: could not list builds from either source');
      return mergeBuilds(older, newer);
    })();
    buildList.catch(() => (buildList = undefined));
    return buildList;
  };

  const candidates = async (): Promise<HeroDataBuild[]> => {
    const all = await builds();
    const served = options.includePtr ? all : all.filter((b) => !b.ptr);
    return served.length > 0 ? [...served] : [...all];
  };

  const loadHeroesData = async (entry: HeroDataBuild, locale: string): Promise<HeroDataTables> => {
    const dir = entry.directory;
    const [heroes, awards, strings] = await Promise.all([
      immutable('heroes-data', `${dir}/data/herodata_${entry.build}_localized.json`).then(
        (t) => JSON.parse(t) as RawHeroData,
      ),
      immutable('heroes-data', `${dir}/data/matchawarddata_${entry.build}_localized.json`)
        .then((t) => JSON.parse(t) as RawAwards)
        .catch(() => undefined),
      immutable('heroes-data', `${dir}/gamestrings/gamestrings_${entry.build}_${locale}.json`).then(
        (t) => JSON.parse(t) as RawGameStrings,
      ),
    ]);
    return readHeroesData(heroes, awards, strings);
  };

  const meta = (dir: string): Promise<VersionMeta> => {
    let p = metas.get(dir);
    if (!p) {
      p = immutable('heroes-data2', `${dir}/.hdp.json`).then((t) => JSON.parse(t) as VersionMeta);
      metas.set(dir, p);
      p.catch(() => metas.delete(dir));
    }
    return p;
  };

  /**
   * Rebuild one heroes-data2 file in full form. A version is either "full" or a JSON
   * patch against the version it `depends-on`, so walk back to the nearest full
   * version and apply the patches forward. Skipped versions (`extracted: false`)
   * carry no files and are passed over.
   */
  const rebuild = async (
    dir: string,
    folder: 'data' | 'gamestrings',
    fileKey: string,
  ): Promise<unknown> => {
    const chain: { dir: string; meta: VersionMeta }[] = [];
    for (let cur = dir; ;) {
      const m = await meta(cur);
      chain.unshift({ dir: cur, meta: m });
      if (m.extracted && m.json === 'full') break;
      if (!m['depends-on'] || chain.length > 500)
        throw new Error(`hero-data: no full version behind ${dir}`);
      cur = m['depends-on'];
    }
    let doc: unknown;
    for (const { dir: d, meta: m } of chain) {
      if (!m.extracted) continue;
      const name = m.files[folder === 'data' ? '[data]' : '[gamestrings]']?.[fileKey];
      if (typeof name !== 'string') throw new Error(`hero-data: ${d} has no ${fileKey} file`);
      const body = JSON.parse(await immutable('heroes-data2', `${d}/${folder}/${name}`)) as unknown;
      doc = m.json === 'full' ? body : applyJsonPatch(doc, body as JsonPatchOperation[]);
    }
    return doc;
  };

  const loadHeroesData2 = async (entry: HeroDataBuild, locale: string): Promise<HeroDataTables> => {
    const dir = entry.directory;
    const [heroes, awards, strings] = await Promise.all([
      rebuild(dir, 'data', 'herodata') as Promise<RawHeroData5>,
      (rebuild(dir, 'data', 'matchawarddata') as Promise<RawAwards5>).catch(() => undefined),
      rebuild(dir, 'gamestrings', locale) as Promise<RawGameStrings5>,
    ]);
    return readHeroesData2(heroes, awards, strings);
  };

  /**
   * Maps for an entry. Only heroes-data2 publishes them, so a heroes-data build gets the
   * oldest heroes-data2 build's maps. Maps are optional: a failure yields none.
   */
  const loadMaps = async (
    entry: HeroDataBuild,
    locale: string,
  ): Promise<Record<string, MapInfo>> => {
    try {
      const dir =
        entry.source === 'heroes-data2'
          ? entry.directory
          : (await builds()).find((b) => b.source === 'heroes-data2')?.directory;
      if (!dir) return {};
      const [maps, strings] = await Promise.all([
        rebuild(dir, 'data', 'mapdata') as Promise<RawMapData5>,
        (rebuild(dir, 'gamestrings', `mapdata|${locale}`) as Promise<RawMapStrings5>).catch(
          () => undefined,
        ),
      ]);
      return readMaps5(maps, strings);
    } catch {
      return {};
    }
  };

  const load = (entry: HeroDataBuild, locale: string): Promise<HeroData> => {
    const key = `${entry.source}/${entry.directory}/${locale}`;
    let p = memo.get(key);
    if (!p) {
      p = Promise.all([
        entry.source === 'heroes-data2'
          ? loadHeroesData2(entry, locale)
          : loadHeroesData(entry, locale),
        loadMaps(entry, locale),
      ]).then(([tables, maps]) => ({
        build: entry.build,
        source: entry.source,
        locale,
        ...tables,
        maps,
      }));
      memo.set(key, p);
      p.catch(() => memo.delete(key));
    }
    return p;
  };

  const serve = async (build: number | undefined, opts: HeroDataOptions): Promise<HeroDataSet> => {
    const list = await candidates();
    const numbers = list.map((b) => b.build);
    const chosen = build === undefined ? Math.max(...numbers) : nearest(numbers, build);
    const entry = list.find((b) => b.build === chosen)!;
    return createHeroDataSet(await load(entry, opts.locale ?? 'enus'), build ?? chosen);
  };

  return {
    forBuild: (build, opts = {}) => serve(build, opts),
    latest: (opts = {}) => serve(undefined, opts),
    builds,
  };
}

/** Both repositories' builds, ascending; heroes-data2 wins where a directory is in both. */
export function mergeBuilds(
  heroesData: readonly HeroDataBuild[],
  heroesData2: readonly HeroDataBuild[],
): HeroDataBuild[] {
  const newer = new Set(heroesData2.map((b) => b.directory));
  return [...heroesData.filter((b) => !newer.has(b.directory)), ...heroesData2].sort(
    (a, b) => a.build - b.build || Number(a.ptr) - Number(b.ptr),
  );
}

/** `2.55.15.96370` / `2.48.0.76268_ptr` directory names → build entries, ascending. */
export function parseBuildDirectories(
  names: readonly string[],
  source: HeroDataSource,
): HeroDataBuild[] {
  const out: HeroDataBuild[] = [];
  for (const name of names) {
    const m = /^(\d+\.\d+\.\d+)\.(\d+)(_ptr)?$/.exec(name);
    if (!m) continue;
    out.push({
      build: Number(m[2]),
      version: m[1]!,
      ptr: m[3] !== undefined,
      directory: name,
      source,
    });
  }
  return out.sort((a, b) => a.build - b.build || Number(a.ptr) - Number(b.ptr));
}
