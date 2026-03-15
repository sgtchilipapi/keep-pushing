import type { BattleEvent } from '../../types/battle';

const canonicalAction: BattleEvent = {
  type: 'ACTION',
  round: 1,
  actorId: 'alpha',
  targetId: 'beta',
  skillId: '1001'
};

void canonicalAction;

const legacyAction: BattleEvent = {
  type: 'ACTION',
  round: 1,
  actorId: 'alpha',
  targetId: 'beta',
  skillId: '1001',
  // @ts-expect-error actorEntityId is removed from canonical ACTION payloads.
  actorEntityId: 'alpha'
};

void legacyAction;

const legacyHitResult: BattleEvent = {
  type: 'HIT_RESULT',
  round: 1,
  actorId: 'alpha',
  targetId: 'beta',
  skillId: '1000',
  rollBP: 1234,
  hitChanceBP: 8000,
  didHit: true,
  // @ts-expect-error roll was renamed to rollBP.
  roll: 1234
};

void legacyHitResult;

const legacyStatusApply: BattleEvent = {
  type: 'STATUS_APPLY',
  round: 1,
  sourceId: 'alpha',
  targetId: 'beta',
  statusId: 'stunned',
  remainingTurns: 1,
  // @ts-expect-error sourceEntityId is removed from canonical status payloads.
  sourceEntityId: 'alpha'
};

void legacyStatusApply;
