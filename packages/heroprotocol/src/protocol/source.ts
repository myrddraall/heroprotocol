import { ProtocolNotFoundError } from '../errors.js';
import { convertPythonProtocol } from './convert.js';
import type { BuildIndex, ProtocolDefinition } from './definition.js';
import { BUILD_INDEX, BUNDLED, REPRESENTATIVES } from './data/index.js';

/**
 * Where protocol definitions come from.
 *
 * `load(build)` returns the definition for an exact published build, or
 * undefined if this source has never heard of it. `index()` returns whatever
 * build → representative mapping the source knows, so the registry can learn
 * about new builds.
 */
export interface ProtocolSource {
  readonly name: string;
  index(): Promise<BuildIndex>;
  load(build: number): Promise<ProtocolDefinition | undefined>;
}

/** The 36 definitions compiled into the package, lazily imported. */
export function bundledSource(): ProtocolSource {
  const cache = new Map<number, Promise<ProtocolDefinition>>();
  return {
    name: 'bundled',
    async index() {
      return BUILD_INDEX;
    },
    async load(build) {
      const rep = BUILD_INDEX[String(build)];
      if (rep === undefined) return undefined;
      let p = cache.get(rep);
      if (p === undefined) {
        const loader = BUNDLED[rep];
        if (loader === undefined) return undefined;
        p = loader();
        cache.set(rep, p);
      }
      return p;
    },
  };
}

/** The subset of `fetch` this source needs, typed structurally so no DOM or Node lib is required. */
export type FetchLike = (
  url: string,
  init?: { readonly signal?: AbortSignal; readonly headers?: Readonly<Record<string, string>> },
) => Promise<ResponseLike>;

export interface ResponseLike {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export interface FetchSourceOptions {
  /** Defaults to the global `fetch`. */
  readonly fetch?: FetchLike;
  /** Per-request timeout in ms. Default 15 000. */
  readonly timeoutMs?: number;
  /** Retries on network error / 5xx. Default 2. */
  readonly retries?: number;
  readonly rawBase?: string;
  readonly treeUrl?: string;
}

const RAW_BASE = 'https://raw.githubusercontent.com/Blizzard/heroprotocol/master/heroprotocol/versions';
const TREE_URL = 'https://api.github.com/repos/Blizzard/heroprotocol/git/trees/master?recursive=1';

/**
 * Blizzard's GitHub repository, for builds newer than the bundle.
 *
 * This is the runtime path that lets a brand-new game build parse without a
 * release of this library. Two things make it cheap in practice: the upstream
 * tree listing carries each file's blob SHA, so a new build whose SHA matches a
 * bundled representative is classified as "same protocol" without downloading
 * the file at all; and when it genuinely is a new definition, one ~27 KB
 * download is converted to data — never executed.
 */
export function fetchSource(options: FetchSourceOptions = {}): ProtocolSource {
  const doFetch: FetchLike = options.fetch ?? requireGlobalFetch();
  const timeoutMs = options.timeoutMs ?? 15_000;
  const retries = options.retries ?? 2;
  const rawBase = options.rawBase ?? RAW_BASE;
  const treeUrl = options.treeUrl ?? TREE_URL;
  const shaToRep = new Map(REPRESENTATIVES.map((r) => [r.sha, r.build]));
  const converted = new Map<number, Promise<ProtocolDefinition>>();
  let indexPromise: Promise<BuildIndex> | undefined;

  async function get(url: string): Promise<ResponseLike> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const res = await doFetch(url, { signal: ctl.signal, headers: { accept: 'application/vnd.github+json, text/plain' } });
        if (res.ok || (res.status >= 400 && res.status < 500)) return res;
        lastError = new Error(`HTTP ${res.status}`);
      } catch (e) {
        lastError = e;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  return {
    name: 'fetch',
    index() {
      indexPromise ??= (async () => {
        const res = await get(treeUrl);
        if (!res.ok) throw new Error(`upstream tree listing: HTTP ${res.status}`);
        const tree = (await res.json()) as { tree: { path: string; sha: string }[] };
        const out: Record<string, number> = {};
        for (const t of tree.tree) {
          const m = /^heroprotocol\/versions\/protocol(\d+)\.py$/.exec(t.path);
          if (m === null) continue;
          const build = Number(m[1]);
          // Known SHA → an existing representative; new SHA → the build is its own representative.
          out[String(build)] = shaToRep.get(t.sha) ?? build;
        }
        return out;
      })();
      return indexPromise;
    },
    async load(build) {
      let p = converted.get(build);
      if (p === undefined) {
        p = (async () => {
          const res = await get(`${rawBase}/protocol${build}.py`);
          if (res.status === 404) throw new ProtocolNotFoundError(build, 'Blizzard has not published a protocol for this build');
          if (!res.ok) throw new Error(`protocol${build}.py: HTTP ${res.status}`);
          return convertPythonProtocol(await res.text(), build);
        })();
        converted.set(build, p);
      }
      try {
        return await p;
      } catch (e) {
        if (e instanceof ProtocolNotFoundError) return undefined;
        throw e;
      }
    },
  };
}

function requireGlobalFetch(): FetchLike {
  const f = (globalThis as { fetch?: FetchLike }).fetch;
  if (f === undefined) throw new Error('fetchSource: no fetch implementation available; pass one in options');
  return f;
}

/** Try each source in order. */
export function compositeSource(...sources: ProtocolSource[]): ProtocolSource {
  return {
    name: sources.map((s) => s.name).join('+'),
    async index() {
      const out: Record<string, number> = {};
      for (const s of sources) {
        try {
          Object.assign(out, await s.index());
        } catch {
          // an unreachable source contributes nothing
        }
      }
      return out;
    },
    async load(build) {
      for (const s of sources) {
        const def = await s.load(build);
        if (def !== undefined) return def;
      }
      return undefined;
    },
  };
}

/** Bundled definitions only — the default for offline / deterministic use. */
export const defaultSource: ProtocolSource = bundledSource();

/** Bundled first, then Blizzard's repository for anything newer. */
export function onlineSource(options?: FetchSourceOptions): ProtocolSource {
  return compositeSource(bundledSource(), fetchSource(options));
}
