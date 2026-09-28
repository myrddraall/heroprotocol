import type { HeroPortraits } from './types.js';

/** Portrait file names as both hdp 4 and hdp 5 publish them. */
export interface RawPortraits {
  readonly draftScreen?: string;
  readonly heroSelect?: string;
  readonly leaderboard?: string;
  readonly loading?: string;
  readonly minimap?: string;
  readonly partyPanel?: string;
  readonly partyFrames?: readonly string[];
  readonly target?: string;
  readonly targetInfo?: string;
}

export const nul = (v: string | undefined): string | null =>
  v === undefined || v === '' ? null : v;

/** Gendered award names (`<lang rule="gender" word="%gender%">Bulwark,Bulwark</lang>`) → the first form. */
export const ungender = (v: string | undefined): string | null =>
  nul(
    v?.replace(/<lang\b[^>]*>([^<]*)<\/lang>/g, (_, forms: string) => forms.split(',')[0]!.trim()),
  );

export function portraits(raw: RawPortraits | undefined): HeroPortraits {
  return {
    draftScreen: nul(raw?.draftScreen),
    heroSelect: nul(raw?.heroSelect),
    leaderboard: nul(raw?.leaderboard),
    loading: nul(raw?.loading),
    minimap: nul(raw?.minimap),
    partyPanel: nul(raw?.partyPanel),
    partyFrames: (raw?.partyFrames ?? []).filter((f) => f !== ''),
    target: nul(raw?.target),
    targetInfo: nul(raw?.targetInfo),
  };
}

export const levelOf = (key: string): number => Number(key.replace(/^level/i, '')) || 0;
