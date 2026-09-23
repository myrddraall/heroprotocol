import type { RawAttributes } from '@myrddraall/heroprotocol';
import type { HeroRole } from '../model/records.js';

/** Lobby-wide attributes live in scope 16; per-slot attributes in scope `slot + 1`. */
export const LOBBY_SCOPE = 16;

export function attribute(
  attrs: RawAttributes | undefined,
  scope: number,
  id: number,
): string | null {
  const value = attrs?.scopes[scope]?.[id]?.[0]?.value;
  return value === undefined ? null : value;
}

const ROLES: Readonly<Record<string, HeroRole>> = {
  assa: 'assassin',
  warr: 'warrior',
  supp: 'support',
  spec: 'specialist',
};

export function heroRoleOf(code: string | null): HeroRole | null {
  if (code === null || code.trim() === '') return null;
  return ROLES[code] ?? code;
}
