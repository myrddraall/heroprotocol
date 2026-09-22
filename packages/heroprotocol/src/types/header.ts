export interface ReplayVersion {
  readonly m_baseBuild: number;
  readonly m_build: number;
  readonly m_flags: number;
  readonly m_major: number;
  readonly m_minor: number;
  readonly m_revision: number;
}

export interface ReplayHeader {
  readonly m_dataBuildNum: number;
  readonly m_elapsedGameLoops: number;
  readonly m_ngdpRootKey: { readonly m_data: string };
  readonly m_replayCompatibilityHash: { readonly m_data: string };
  readonly m_signature: string;
  readonly m_type: number;
  readonly m_useScaledTime: boolean;
  readonly m_version: ReplayVersion;
}
