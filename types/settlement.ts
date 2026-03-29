export type ZoneState = 0 | 1 | 2;

export interface EncounterCountEntry {
  zoneId: number;
  enemyArchetypeId: number;
  count: number;
}

export interface ZoneProgressDeltaEntry {
  zoneId: number;
  newState: ZoneState;
}

export interface ApplyBattleSettlementBatchV1Payload {
  characterId: string;
  batchId: number;
  startNonce: number;
  endNonce: number;
  battleCount: number;
  startStateHash: string;
  endStateHash: string;
  expDelta: number;
  zoneProgressDelta: ZoneProgressDeltaEntry[];
  encounterHistogram: EncounterCountEntry[];
  optionalLoadoutRevision?: number;
  batchHash: string;
  attestationSlot: number;
  attestationExpirySlot: number;
  signatureScheme: 0;
}

export interface ProgramConfigState {
  settlementPaused: boolean;
  maxBattlesPerBatch: number;
  maxHistogramEntriesPerBatch: number;
  trustedServerSigners: string[];
}

export interface CharacterRootState {
  characterId: string;
  authority: string;
  level: number;
  exp: number;
}

export interface CharacterStatsState {
  lastRecalcSlot: number;
}

export interface CharacterLoadoutState {
  loadoutRevision: number;
}

export interface CharacterWorldProgressState {
  highestMainZoneUnlocked: number;
  highestMainZoneCleared: number;
  updatedAtSlot: number;
}

export interface CharacterSettlementBatchCursorState {
  lastCommittedEndNonce: number;
  lastCommittedStateHash: string;
  lastCommittedBatchId: number;
  updatedAtSlot: number;
}

export interface ZoneRegistryEntry {
  zoneId: number;
  allowDirectLockedToCleared?: boolean;
}

export interface EnemyArchetypeRegistryEntry {
  enemyArchetypeId: number;
  expCapPerEncounter: number;
}

export interface SettlementValidationContext {
  currentSlot: number;
  playerAuthority: string;
  serverSigner: string;
  characterRoot: CharacterRootState;
  characterStats: CharacterStatsState;
  characterWorldProgress: CharacterWorldProgressState;
  zoneStates: Map<number, ZoneState>;
  loadout?: CharacterLoadoutState;
  cursor: CharacterSettlementBatchCursorState;
  programConfig: ProgramConfigState;
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
