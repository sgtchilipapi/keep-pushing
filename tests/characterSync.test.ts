import { deriveCharacterSyncState } from "../lib/characterSync";

describe("deriveCharacterSyncState", () => {
  it("keeps local-only characters battle eligible before chain creation", () => {
    expect(
      deriveCharacterSyncState({
        chain: null,
        latestBattleSettlementStatus: "AWAITING_FIRST_SYNC",
        oldestPendingRunSequence: null,
      }),
    ).toEqual({
      syncPhase: "LOCAL_ONLY",
      battleEligible: true,
    });
  });

  it("blocks battles while the first settlement batch is still unresolved", () => {
    expect(
      deriveCharacterSyncState({
        chain: {
          chainCreationStatus: "CONFIRMED",
          lastReconciledBatchId: 0,
        },
        latestBattleSettlementStatus: "SEALED",
        oldestPendingRunSequence: 1,
      }),
    ).toEqual({
      syncPhase: "INITIAL_SETTLEMENT_REQUIRED",
      battleEligible: false,
    });
  });

  it("treats later confirmed-character batches as ordinary settlement backlog", () => {
    expect(
      deriveCharacterSyncState({
        chain: {
          chainCreationStatus: "CONFIRMED",
          lastReconciledBatchId: 1,
        },
        latestBattleSettlementStatus: "PENDING",
        oldestPendingRunSequence: 2,
      }),
    ).toEqual({
      syncPhase: "SETTLEMENT_PENDING",
      battleEligible: true,
    });
  });
});
