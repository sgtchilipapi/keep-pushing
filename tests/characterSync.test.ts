import { deriveCharacterSyncState } from "../lib/characterSync";

describe("deriveCharacterSyncState", () => {
  it("blocks battles until the character has been created on chain", () => {
    expect(
      deriveCharacterSyncState({
        chain: null,
        latestBattleSettlementStatus: "AWAITING_FIRST_SYNC",
        nextSettlementBatch: null,
      }),
    ).toEqual({
      syncPhase: "LOCAL_ONLY",
      battleEligible: false,
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
        nextSettlementBatch: {
          batchId: 1,
          status: "SEALED",
        },
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
        nextSettlementBatch: {
          batchId: 2,
          status: "SEALED",
        },
      }),
    ).toEqual({
      syncPhase: "SETTLEMENT_PENDING",
      battleEligible: true,
    });
  });
});
