export type ZoneState = 0 | 1 | 2;
export type ProgressZoneState = 1 | 2;
export type SettlementSchemaVersion = 2;
export type SettlementSignatureScheme = 0;

export interface EncounterCountEntry {
  zoneId: number;
  enemyArchetypeId: number;
  count: number;
}

export interface ZoneProgressDeltaEntry {
  zoneId: number;
  newState: ProgressZoneState;
}

export interface SettlementBatchPayloadV2 {
  characterId: string;
  batchId: number;
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
  expMultiplierNum: number;
  expMultiplierDen: number;
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
  zoneRegistry: Map<number, ZoneRegistryEntry>;
  zoneEnemySet: Map<number, Set<number>>;
  enemyArchetypes: Map<number, EnemyArchetypeRegistryEntry>;
}

export interface SettlementApplyResult {
  characterRoot: CharacterRootState;
  characterStats: CharacterStatsState;
  characterWorldProgress: CharacterWorldProgressState;
  zoneStates: Map<number, ZoneState>;
  cursor: CharacterSettlementBatchCursorState;
}
