export type ZoneState = 0 | 1 | 2;
export type ProgressZoneState = 1 | 2;
export type SettlementSchemaVersion = 2;
export type SettlementSignatureScheme = 0 | 1;
export type RunTerminalStatus =
  | "COMPLETED"
  | "FAILED"
  | "ABANDONED"
  | "EXPIRED"
  | "SEASON_CUTOFF";

export interface EncounterCountEntry {
  zoneId: number;
  enemyArchetypeId: number;
  count: number;
}

export interface RunEncounterCountEntry {
  enemyArchetypeId: number;
  count: number;
}

export interface ZoneProgressDeltaEntry {
  zoneId: number;
  newState: ProgressZoneState;
}

export interface SettlementRunSummary {
  closedRunSequence: number;
  zoneId: number;
  topologyVersion: number;
  topologyHash: string;
  terminalStatus: RunTerminalStatus;
  rewardedBattleCount: number;
  rewardedEncounterHistogram: RunEncounterCountEntry[];
  zoneProgressDelta: ZoneProgressDeltaEntry[];
  firstRewardedBattleTs: number;
  lastRewardedBattleTs: number;
}

export interface SettlementBatchPayloadV2 {
  characterId: string;
  batchId: number;
  startRunSequence?: number;
  endRunSequence?: number;
  runSummaries?: SettlementRunSummary[];
  // Compatibility mirrors for older retry/sync surfaces.
  startNonce: number;
  endNonce: number;
  battleCount: number;
  startStateHash: string;
  endStateHash: string;
  zoneProgressDelta: ZoneProgressDeltaEntry[];
  encounterHistogram: EncounterCountEntry[];
  optionalLoadoutRevision?: number;
  batchHash: string;
  firstBattleTs: number;
  lastBattleTs: number;
  seasonId: number;
  schemaVersion: SettlementSchemaVersion;
  signatureScheme: SettlementSignatureScheme;
}

export type SettlementBatchPayloadPreimageV2 = Omit<SettlementBatchPayloadV2, "batchHash">;

export type SettlementEndStateHashPreimageV2 = Omit<
  SettlementBatchPayloadPreimageV2,
  "endStateHash"
>;

export interface ProgramConfigState {
  settlementPaused: boolean;
  maxBattlesPerBatch: number;
  maxRunsPerBatch?: number;
  maxHistogramEntriesPerBatch: number;
  trustedServerSigner: string;
}

export interface SeasonPolicyState {
  seasonId: number;
  seasonStartTs: number;
  seasonEndTs: number;
  commitGraceEndTs: number;
}

export interface CharacterRootState {
  characterId: string;
  authority: string;
  characterCreationTs: number;
  name?: string;
  classId?: number;
}

export interface CharacterStatsState {
  level: number;
  totalExp: number;
}

export interface CharacterWorldProgressState {
  highestUnlockedZoneId: number;
  highestClearedZoneId: number;
}

export interface CharacterSettlementBatchCursorState {
  lastCommittedEndNonce: number;
  lastCommittedStateHash: string;
  lastCommittedBatchId: number;
  lastCommittedBattleTs: number;
  lastCommittedSeasonId: number;
  updatedAtSlot: number;
}

export interface ZoneRegistryEntry {
  zoneId: number;
  topologyVersion?: number;
  topologyHash?: string;
  totalSubnodeCount?: number;
  expMultiplierNum: number;
  expMultiplierDen: number;
}

export interface ZoneEnemyRuleEntry {
  enemyArchetypeId: number;
  maxPerRun: number;
}

export interface EnemyArchetypeRegistryEntry {
  enemyArchetypeId: number;
  expRewardBase: number;
}

export interface SettlementValidationContext {
  currentUnixTimestamp: number;
  currentSlot: number;
  playerAuthority: string;
  serverSigner: string;
  characterRoot: CharacterRootState;
  characterStats: CharacterStatsState;
  characterWorldProgress: CharacterWorldProgressState;
  zoneStates: Map<number, ZoneState>;
  cursor: CharacterSettlementBatchCursorState;
  programConfig: ProgramConfigState;
  seasonPolicy: SeasonPolicyState;
  zoneRegistry: Map<string | number, ZoneRegistryEntry>;
  zoneEnemySet: Map<string | number, ZoneEnemyRuleEntry[] | Set<number>>;
  enemyArchetypes: Map<number, EnemyArchetypeRegistryEntry>;
}

export interface SettlementApplyResult {
  characterRoot: CharacterRootState;
  characterStats: CharacterStatsState;
  characterWorldProgress: CharacterWorldProgressState;
  zoneStates: Map<number, ZoneState>;
  cursor: CharacterSettlementBatchCursorState;
}
