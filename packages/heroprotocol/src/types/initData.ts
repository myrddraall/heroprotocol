export interface ReplayInitData {
  readonly m_syncLobbyState: SyncLobbyState;
}

export interface SyncLobbyState {
  readonly m_gameDescription: GameDescription;
  readonly m_lobbyState: LobbyState;
  readonly m_userInitialData: readonly UserInitialData[];
}

export interface GameOptions {
  readonly m_advancedSharedControl: boolean;
  readonly m_amm: boolean;
  readonly m_ammId: number;
  readonly m_battleNet: boolean;
  readonly m_clientDebugFlags: number;
  readonly m_competitive: boolean;
  readonly m_cooperative: boolean;
  readonly m_fog: number;
  readonly m_heroDuplicatesAllowed: boolean;
  readonly m_lockTeams: boolean;
  readonly m_noVictoryOrDefeat: boolean;
  readonly m_observers: number;
  readonly m_practice: boolean;
  readonly m_randomRaces: boolean;
  readonly m_teamsTogether: boolean;
  readonly m_userDifficulty: number;
}

export interface GameDescription {
  readonly m_cacheHandles: readonly string[];
  readonly m_defaultAIBuild: number;
  readonly m_defaultDifficulty: number;
  readonly m_gameCacheName: string;
  readonly m_gameOptions: GameOptions;
  readonly m_gameSpeed: number;
  readonly m_gameType: number;
  readonly m_hasExtensionMod: boolean;
  readonly m_isBlizzardMap: boolean;
  readonly m_isCoopMode: boolean;
  readonly m_isPremadeFFA: boolean;
  readonly m_mapAuthorName: string;
  readonly m_mapFileName: string;
  readonly m_mapFileSyncChecksum: number;
  readonly m_mapSizeX: number;
  readonly m_mapSizeY: number;
  readonly m_maxColors: number;
  readonly m_maxControls: number;
  readonly m_maxObservers: number;
  readonly m_maxPlayers: number;
  readonly m_maxRaces: number;
  readonly m_maxTeams: number;
  readonly m_maxUsers: number;
  readonly m_modFileSyncChecksum: number;
  readonly m_randomValue: number;
  readonly m_slotDescriptions: readonly SlotDescription[];
}

export interface SlotDescription {
  readonly m_allowedAIBuilds: readonly number[];
  readonly m_allowedColors: readonly number[];
  readonly m_allowedControls: readonly number[];
  readonly m_allowedDifficulty: readonly number[];
  readonly m_allowedObserveTypes: readonly number[];
  readonly m_allowedRaces: readonly number[];
}

export interface LobbyState {
  readonly m_defaultAIBuild: number;
  readonly m_defaultDifficulty: number;
  readonly m_gameDuration: number;
  readonly m_hostUserId: number;
  readonly m_isSinglePlayer: boolean;
  readonly m_maxObservers: number;
  readonly m_phase: number;
  readonly m_pickedMapTag: number;
  readonly m_randomSeed: number;
  readonly m_slots: readonly LobbySlot[];
}

export interface LobbySlot {
  readonly m_aiBuild: number;
  readonly m_announcerPack: string;
  readonly m_artifacts: readonly string[];
  readonly m_banner: string;
  readonly m_colorPref: number;
  readonly m_control: number;
  readonly m_difficulty: number;
  readonly m_handicap: number;
  readonly m_hasSilencePenalty: boolean;
  readonly m_hasVoiceSilencePenalty?: boolean;
  readonly m_hero: string;
  readonly m_heroMasteryTiers?: readonly { readonly m_hero: string; readonly m_tier: number }[];
  readonly m_logoIndex: number;
  readonly m_mount: string;
  readonly m_observe: number;
  readonly m_racePref: { readonly m_race: number | null };
  readonly m_rewards: readonly number[];
  readonly m_skin: string;
  readonly m_spray?: string;
  readonly m_tandemLeaderUserId: number | null;
  readonly m_teamId: number;
  readonly m_toonHandle: string;
  readonly m_userId: number | null;
  readonly m_voiceLine?: string;
  readonly m_workingSetSlotId: number | null;
}

export interface UserInitialData {
  readonly m_banner: string;
  readonly m_clanLogo: string | null;
  readonly m_clanTag: string;
  readonly m_combinedRaceLevels: number;
  readonly m_customInterface: boolean;
  readonly m_examine: boolean;
  readonly m_name: string;
  readonly m_hero: string;
  readonly m_highestLeague: number;
  readonly m_mount: string;
  readonly m_observe: number;
  readonly m_racePreference: { readonly m_race: number | null };
  readonly m_randomSeed: number;
  readonly m_skin: string;
  readonly m_spray?: string;
  readonly m_teamPreference: { readonly m_team: number | null };
  readonly m_testAuto: boolean;
  readonly m_testMap: boolean;
  readonly m_testType: boolean;
  readonly m_toonHandle: string;
}
