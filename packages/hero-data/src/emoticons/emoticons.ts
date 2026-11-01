/** One chat emote. */
export interface EmoticonInfo {
  /** Every code that types it, in every language (`:stukhappy:`, `:aplausos:`, `:)`). */
  readonly aliases: readonly string[];
  /** Its codes match only in this case (`B)`); otherwise in any. */
  readonly caseSensitive?: boolean;
  /** The hero it belongs to (`Stukov`); none for a generic one. */
  readonly heroId?: string;
  /** The skin it belongs to; a skin's emotes are never a hero's stand-in. */
  readonly skinId?: string;
  /** What it shows (`Happy`), which the hero swap matches on. */
  readonly expression?: string;
  /**
   * Its picture in heroes-images' `emoticons/`: a PNG, or an animated PNG (`.apng`). None for a
   * generic one (`:)`), which the game only shows as the sender's hero's version.
   */
  readonly image?: string;
}

/** The generated table (`emoticons.json`, `pnpm run generate.emoticons`). */
export interface EmoticonTable {
  /** The game build it was generated from. */
  readonly build: number;
  readonly emoticons: Record<string, EmoticonInfo>;
}

/** An emote with its id. */
export interface Emoticon extends EmoticonInfo {
  readonly id: string;
}

/** An emote that has a picture: what a chat line shows. */
export interface ShownEmoticon extends Emoticon {
  readonly image: string;
}

/** A piece of a chat line: plain text, or an emote with the code that was typed for it. */
export type ChatPiece =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'emoticon'; readonly emoticon: ShownEmoticon; readonly code: string };

/** The chat emotes, and the game's conversion of a typed line into text and emotes. */
export interface EmoticonSet {
  /** The game build the emotes are from. */
  readonly build: number;
  /** The emote a code types, before the hero swap; undefined for none. */
  byCode(code: string): Emoticon | undefined;
  /**
   * A typed chat line as the game shows it: each code an emote, a generic one (`:)`) as the
   * sender's hero's own version of the same expression. A generic code with no hero version (no
   * hero given) stays text, as it has no picture. `heroId` is the hero data's id (`DVa`), not the
   * replay's unit (`DVaPilot`).
   */
  parse(text: string, heroId: string | null): ChatPiece[];
}

/**
 * Codes are whole words (`:)`) or colon codes, which may run together
 * (`:ghostboogie::ghostboogie:`); everything else is text.
 */
const TOKENS = /(:[^\s:]+:|\s+)/;

export function createEmoticonSet(table: EmoticonTable): EmoticonSet {
  const exact = new Map<string, Emoticon>();
  const folded = new Map<string, Emoticon>();
  /** heroId → expression → the hero's own emote for it. */
  const heroVersions = new Map<string, Map<string, Emoticon>>();
  for (const [id, info] of Object.entries(table.emoticons)) {
    const e: Emoticon = { id, ...info };
    for (const a of info.aliases) {
      if (info.caseSensitive) exact.set(a, e);
      else if (!folded.has(a.toLowerCase())) folded.set(a.toLowerCase(), e);
    }
    if (info.heroId && !info.skinId && info.expression) {
      let versions = heroVersions.get(info.heroId);
      if (!versions) heroVersions.set(info.heroId, (versions = new Map()));
      if (!versions.has(info.expression)) versions.set(info.expression, e);
    }
  }

  const byCode = (code: string): Emoticon | undefined =>
    exact.get(code) ?? folded.get(code.toLowerCase());

  return {
    build: table.build,
    byCode,
    parse(text, heroId) {
      const pieces: ChatPiece[] = [];
      let plain = '';
      for (const token of text.split(TOKENS)) {
        if (token === '') continue;
        let e = /\s/.test(token) ? undefined : byCode(token);
        if (!e) {
          plain += token;
          continue;
        }
        if (!e.heroId && e.expression && heroId) {
          e = heroVersions.get(heroId)?.get(e.expression) ?? e;
        }
        if (!e.image) {
          plain += token;
          continue;
        }
        if (plain) pieces.push({ kind: 'text', text: plain });
        plain = '';
        pieces.push({ kind: 'emoticon', emoticon: { ...e, image: e.image }, code: token });
      }
      if (plain) pieces.push({ kind: 'text', text: plain });
      return pieces;
    },
  };
}

let loading: Promise<EmoticonSet> | undefined;

/** The chat emotes (the generated table, about 80 KB gzipped), loaded on first call. */
export function loadEmoticons(): Promise<EmoticonSet> {
  loading ??= import('./emoticons.json').then(
    (m) => createEmoticonSet((m as { default: EmoticonTable }).default),
    (err: unknown) => {
      loading = undefined;
      throw err;
    },
  );
  return loading;
}
