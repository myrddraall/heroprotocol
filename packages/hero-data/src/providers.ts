import {
  compileHeroData,
  createHeroDataSet,
  type RawAwards,
  type RawGameStrings,
  type RawHeroData,
} from './compile.js';
import { KNOWN_BUILDS } from './data/builds.js';
import type {
  HeroData,
  HeroDataBuild,
  HeroDataOptions,
  HeroDataProvider,
  HeroDataSet,
} from './types.js';

/** A provider over data compiled ahead of time (bundled, or cached by the app). */
export function staticHeroData(data: HeroData | readonly HeroData[]): HeroDataProvider {
  const sets = (Array.isArray(data) ? data : [data]) as readonly HeroData[];
  if (sets.length === 0) throw new Error('staticHeroData: no data');
  return {
    async forBuild(build) {
      const chosen = nearest(
        sets.map((s) => s.build),
        build,
      );
      return createHeroDataSet(
        sets.find((s) => s.build === chosen)!,
        build,
      );
    },
  };
}

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
  /** Builds to choose from (default: the bundled index, refreshed by `refreshBuilds`). */
  readonly builds?: readonly HeroDataBuild[];
  /** Serve PTR builds too (default false). */
  readonly includePtr?: boolean;
  /** Raw content root (default GitHub raw for `HeroesToolChest/heroes-data@master`). */
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

export const HEROES_DATA_RAW =
  'https://raw.githubusercontent.com/HeroesToolChest/heroes-data/master/heroesdata';
export const HEROES_DATA_TREE_API =
  'https://api.github.com/repos/HeroesToolChest/heroes-data/git/trees/master';

/**
 * Hero data from HeroesToolChest/heroes-data (MIT; archived in 2026 but served).
 * Picks the nearest published build at or below the replay's, fetches its hero,
 * award and game-string files (≈5 MB, once per build — give it a `cache`), and
 * compiles them. Compiled sets are memoized per build and locale.
 */
export function heroesToolChestProvider(options: HeroesToolChestOptions = {}): HeroDataProvider & {
  /** Re-read the list of published builds from GitHub (unauthenticated: 60 requests/hour). */
  refreshBuilds(): Promise<readonly HeroDataBuild[]>;
} {
  const fetchImpl: FetchLike =
    options.fetch ?? (globalThis as unknown as { fetch: FetchLike }).fetch;
  if (!fetchImpl) throw new Error('heroesToolChestProvider: no fetch available — pass one');
  const base = (options.baseUrl ?? HEROES_DATA_RAW).replace(/\/$/, '');
  let builds: readonly HeroDataBuild[] = options.builds ?? KNOWN_BUILDS;
  const memo = new Map<string, Promise<HeroData>>();

  const candidates = (): HeroDataBuild[] => {
    const all = options.includePtr ? builds : builds.filter((b) => !b.ptr);
    return all.length > 0 ? [...all] : [...builds];
  };

  const text = async (path: string): Promise<string> => {
    const cached = await options.cache?.get(path);
    if (cached !== undefined) return cached;
    const url = `${base}/${path}`;
    const controller = typeof AbortController === 'undefined' ? undefined : new AbortController();
    const timer =
      controller && options.timeoutMs
        ? setTimeout(() => controller.abort(), options.timeoutMs)
        : undefined;
    try {
      const res = await fetchImpl(url, controller ? { signal: controller.signal } : undefined);
      if (!res.ok) throw new Error(`hero-data: ${res.status} fetching ${url}`);
      const body = await res.text();
      await options.cache?.set(path, body);
      return body;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  const load = (entry: HeroDataBuild, locale: string): Promise<HeroData> => {
    const key = `${entry.directory}/${locale}`;
    let p = memo.get(key);
    if (!p) {
      p = (async () => {
        const dir = `${entry.directory}`;
        const [heroes, awards, strings] = await Promise.all([
          text(`${dir}/data/herodata_${entry.build}_localized.json`).then(
            (t) => JSON.parse(t) as RawHeroData,
          ),
          text(`${dir}/data/matchawarddata_${entry.build}_localized.json`)
            .then((t) => JSON.parse(t) as RawAwards)
            .catch(() => undefined),
          text(`${dir}/gamestrings/gamestrings_${entry.build}_${locale}.json`).then(
            (t) => JSON.parse(t) as RawGameStrings,
          ),
        ]);
        return compileHeroData({
          build: entry.build,
          locale,
          heroes,
          ...(awards ? { awards } : {}),
          strings,
        });
      })();
      memo.set(key, p);
      p.catch(() => memo.delete(key));
    }
    return p;
  };

  return {
    async forBuild(build: number, opts: HeroDataOptions = {}): Promise<HeroDataSet> {
      const locale = opts.locale ?? 'enus';
      const list = candidates();
      const chosen = nearest(
        list.map((b) => b.build),
        build,
      );
      const entry = list.find((b) => b.build === chosen)!;
      return createHeroDataSet(await load(entry, locale), build);
    },
    async refreshBuilds(): Promise<readonly HeroDataBuild[]> {
      const res = await fetchImpl(HEROES_DATA_TREE_API);
      if (!res.ok) throw new Error(`hero-data: ${res.status} listing builds`);
      const root = JSON.parse(await res.text()) as { tree: { path: string; sha: string }[] };
      const dir = root.tree.find((t) => t.path === 'heroesdata');
      if (!dir) throw new Error('hero-data: no heroesdata directory in the tree');
      const sub = await fetchImpl(`${HEROES_DATA_TREE_API.replace(/master$/, '')}${dir.sha}`);
      if (!sub.ok) throw new Error(`hero-data: ${sub.status} listing builds`);
      const tree = JSON.parse(await sub.text()) as { tree: { path: string }[] };
      builds = parseBuildDirectories(tree.tree.map((t) => t.path));
      return builds;
    },
  };
}

/** `2.55.15.96370` / `2.48.0.76268_ptr` directory names → build entries, ascending. */
export function parseBuildDirectories(names: readonly string[]): HeroDataBuild[] {
  const out: HeroDataBuild[] = [];
  for (const name of names) {
    const m = /^(\d+\.\d+\.\d+)\.(\d+)(_ptr)?$/.exec(name);
    if (!m) continue;
    out.push({ build: Number(m[2]), version: m[1]!, ptr: m[3] !== undefined, directory: name });
  }
  return out.sort((a, b) => a.build - b.build || Number(a.ptr) - Number(b.ptr));
}
