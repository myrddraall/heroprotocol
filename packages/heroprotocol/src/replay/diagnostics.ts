export type SectionName =
  | 'header'
  | 'details'
  | 'initData'
  | 'attributes'
  | 'trackerEvents'
  | 'messageEvents'
  | 'gameEvents';

export const ALL_SECTIONS: readonly SectionName[] = [
  'header',
  'details',
  'initData',
  'attributes',
  'trackerEvents',
  'messageEvents',
  'gameEvents',
];

/** MPQ file name for each section other than the header, which lives in the MPQ user-data block. */
export const SECTION_FILES: Readonly<Record<Exclude<SectionName, 'header'>, string>> = {
  details: 'replay.details',
  initData: 'replay.initData',
  attributes: 'replay.attributes.events',
  trackerEvents: 'replay.tracker.events',
  messageEvents: 'replay.message.events',
  gameEvents: 'replay.game.events',
};

export type SectionStatus = 'ok' | 'partial' | 'failed' | 'skipped';

/** How the protocol that decoded a section was chosen. */
export type Provenance = 'exact' | 'nearest' | 'fetched';

export interface DecodeAttempt {
  readonly protocol: number;
  readonly provenance: Provenance;
  readonly error?: string;
  /** For event streams: how many events decoded before the error. */
  readonly eventsDecoded?: number;
}

export interface SectionDiagnostic {
  readonly status: SectionStatus;
  /** The protocol whose result was kept, when there is one. */
  readonly protocol?: number;
  readonly provenance?: Provenance;
  readonly attempts: readonly DecodeAttempt[];
  /** Event streams only. */
  readonly eventsDecoded?: number;
  /** Event streams that stopped early: where. */
  readonly failedAt?: {
    readonly usedBits: number;
    readonly totalBits: number;
    readonly lastGameloop: number;
  };
  readonly error?: string;
}

export interface Diagnostics {
  /** From the header: the build the game recorded. */
  readonly build: number;
  /** The protocol most sections used. */
  readonly protocol: number;
  readonly provenance: Provenance;
  readonly sections: Readonly<Record<SectionName, SectionDiagnostic>>;
  /** True when every requested section is `ok`. */
  readonly complete: boolean;
}
