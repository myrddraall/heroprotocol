import { sha1Hex } from '../util/sha1.js';

/** Hash for an unparameterized run. */
export const NO_PARAMS = '-';

/** JSON with object keys sorted at every level, so equal params hash equal. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function paramsHash(params: unknown): string {
  if (params === undefined || params === null) return NO_PARAMS;
  return sha1Hex(stableStringify(params)).slice(0, 16);
}
