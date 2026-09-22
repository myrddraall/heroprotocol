export interface ReplayColor {
  readonly m_a: number;
  readonly m_r: number;
  readonly m_g: number;
  readonly m_b: number;
}

export interface ReplayToon {
  readonly m_id: number;
  readonly m_programId: string;
  readonly m_realm: number;
  readonly m_region: number;
}

export interface ReplayDetailsPlayer {
  readonly m_color: ReplayColor;
  readonly m_control: number;
  readonly m_handicap: number;
  readonly m_hero: string;
  readonly m_name: string;
  readonly m_observe: number;
  readonly m_race: string;
  readonly m_result: number;
  readonly m_teamId: number;
  readonly m_toon: ReplayToon;
  readonly m_workingSetSlotId: number;
}

export interface ReplayDetails {
  readonly m_cacheHandles: readonly string[];
  readonly m_defaultDifficulty: number;
  readonly m_difficulty: string;
  readonly m_gameSpeed: number;
  readonly m_isBlizzardMap: boolean;
  readonly m_mapFileName: string;
  readonly m_miniSave: boolean;
  readonly m_modPaths: null;
  readonly m_playerList: readonly ReplayDetailsPlayer[];
  readonly m_restartAsTransitionMap: boolean;
  readonly m_thumbnail: { readonly m_file: string };
  readonly m_timeLocalOffset: number;
  /** Windows FILETIME: 100 ns ticks since 1601-01-01. */
  readonly m_timeUTC: number;
  readonly m_title: string;
}
