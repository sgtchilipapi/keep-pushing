export type PassiveStatKey = 'hp' | 'hpMax' | 'atk' | 'def' | 'spd' | 'accuracyBP' | 'evadeBP';

export type PassiveStatModifiers = Partial<Record<PassiveStatKey, number>>;

export type PassiveCondition =
  | {
      kind: 'target_hp_below_bp';
      thresholdBP: number;
    };

export type ConditionalPassiveModifier = {
  when: PassiveCondition;
  actorStats?: PassiveStatModifiers;
  targetStats?: PassiveStatModifiers;
  skillAccuracyModBP?: number;
};

export type PassiveDef = {
  passiveId: string;
  flatStats?: PassiveStatModifiers;
  conditional?: ConditionalPassiveModifier[];
};

const PASSIVE_REGISTRY: Record<string, PassiveDef> = {
  EAGLE_EYE: {
    passiveId: 'EAGLE_EYE',
    flatStats: {
      accuracyBP: 1000
    }
  },
  EXECUTIONER_FOCUS: {
    passiveId: 'EXECUTIONER_FOCUS',
    conditional: [
      {
        when: {
          kind: 'target_hp_below_bp',
          thresholdBP: 3000
        },
        skillAccuracyModBP: 1200
      }
    ]
  }
};

export function getPassiveDef(passiveId: string): PassiveDef {
  const passive = PASSIVE_REGISTRY[passiveId];
  if (passive === undefined) {
    throw new Error(`Unknown passiveId: ${passiveId}`);
  }

  return passive;
}
