import { allocateNextBattleNonce } from '../lib/combat/battleNonce';

describe('allocateNextBattleNonce', () => {
  it('uses the latest local nonce when present', () => {
    expect(
      allocateNextBattleNonce({
        latestLocalBattleNonce: 9,
        lastReconciledEndNonce: 4,
      }),
    ).toBe(10);
  });

  it('falls back to the reconciled cursor when no local battles exist', () => {
    expect(
      allocateNextBattleNonce({
        latestLocalBattleNonce: null,
        lastReconciledEndNonce: 4,
      }),
    ).toBe(5);
  });

  it('rejects invalid cursor values', () => {
    expect(() =>
      allocateNextBattleNonce({
        latestLocalBattleNonce: null,
        lastReconciledEndNonce: -1,
      }),
    ).toThrow(/ERR_INVALID_LASTRECONCILEDENDNONCE/);
  });
});
