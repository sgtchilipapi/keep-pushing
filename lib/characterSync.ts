import type {
  BattleOutcomeLedgerStatus,
  CharacterChainCreationStatus,
} from "./prisma";
import type { CharacterSyncPhase } from "../types/api/frontend";

export interface CharacterSyncDerivationInput {
  chain: {
    chainCreationStatus: CharacterChainCreationStatus;
    lastReconciledBatchId: number | null;
  } | null;
  latestBattleSettlementStatus: BattleOutcomeLedgerStatus | null;
  oldestPendingRunSequence: number | null;
}

export interface CharacterSyncDerivationResult {
  syncPhase: CharacterSyncPhase;
  battleEligible: boolean;
}

function hasInitialSettlementPendingRun(
  args: CharacterSyncDerivationInput,
): boolean {
  const lastReconciledBatchId = args.chain?.lastReconciledBatchId ?? 0;

  return args.oldestPendingRunSequence === 1 && lastReconciledBatchId < 1;
}

export function deriveCharacterSyncState(
  input: CharacterSyncDerivationInput,
): CharacterSyncDerivationResult {
  const chainStatus = input.chain?.chainCreationStatus ?? "NOT_STARTED";
  const latestSettlementStatus = input.latestBattleSettlementStatus;
  const initialSettlementRequired =
    chainStatus === "CONFIRMED" &&
    (latestSettlementStatus === "AWAITING_FIRST_SYNC" ||
      hasInitialSettlementPendingRun(input));

  if (input.chain === null || chainStatus === "NOT_STARTED") {
    return {
      syncPhase: "LOCAL_ONLY",
      battleEligible: true,
    };
  }

  if (chainStatus === "FAILED") {
    return {
      syncPhase: "FAILED",
      battleEligible: false,
    };
  }

  if (chainStatus === "PENDING" || chainStatus === "SUBMITTED") {
    return {
      syncPhase: "CREATING_ON_CHAIN",
      battleEligible: false,
    };
  }

  if (initialSettlementRequired) {
    return {
      syncPhase: "INITIAL_SETTLEMENT_REQUIRED",
      battleEligible: false,
    };
  }

  if (
    latestSettlementStatus === "PENDING" ||
    latestSettlementStatus === "SEALED" ||
    input.oldestPendingRunSequence !== null
  ) {
    return {
      syncPhase: "SETTLEMENT_PENDING",
      battleEligible: true,
    };
  }

  return {
    syncPhase: "SYNCED",
    battleEligible: true,
  };
}
