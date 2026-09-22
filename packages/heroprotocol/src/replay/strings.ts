let decoder: TextDecoder | undefined;

/**
 * Replace every byte blob in a decoded value with its UTF-8 text.
 *
 * Blizzard's format has one blob type for names, map titles, hero handles and
 * a few genuinely binary hashes alike; the reference decoders return bytes for
 * all of them and callers decide. This library decodes them all as text (with
 * U+FFFD for invalid sequences), which is what every consumer of the previous
 * version relied on — and what the 2018 port silently stopped doing the moment
 * `Buffer` became `Uint8Array`, because its check was `instanceof Buffer`.
 */
export function stringifyBlobs<T>(value: T): T {
  return walk(value) as T;
}

function walk(v: unknown): unknown {
  if (v instanceof Uint8Array) {
    decoder ??= new TextDecoder('utf-8');
    return decoder.decode(v);
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) v[i] = walk(v[i]);
    return v;
  }
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) o[k] = walk(o[k]);
    return o;
  }
  return v;
}

/** True if decoding produced a replacement character — a sign the bytes were not text. */
export function hasReplacementChar(s: string): boolean {
  return s.includes('�');
}
