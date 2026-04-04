export interface AllocateNextBattleNonceArgs {
  latestLocalBattleNonce: number | null;
  lastReconciledEndNonce: number;
}

function assertSafeInteger(value: number, field: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must be a safe integer >= ${minimum}`);
  }
}

export function allocateNextBattleNonce(args: AllocateNextBattleNonceArgs): number {
  assertSafeInteger(args.lastReconciledEndNonce, 'lastReconciledEndNonce', 0);

  if (args.latestLocalBattleNonce !== null) {
    assertSafeInteger(args.latestLocalBattleNonce, 'latestLocalBattleNonce', 0);
    return args.latestLocalBattleNonce + 1;
  }

  return args.lastReconciledEndNonce + 1;
}
