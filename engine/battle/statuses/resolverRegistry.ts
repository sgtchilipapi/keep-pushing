import type { StatusId } from './statusRegistry';
import { getStatusDef } from './statusRegistry';
import type { StatusResolverDefinition, StatusResolverRegistry } from './types';

const NO_OP_RESOLVE: StatusResolverDefinition['resolve'] = () => ({
  hpDelta: 0,
  controlLossApplied: false
});

const STUN_RESOLVE: StatusResolverDefinition['resolve'] = () => ({
  hpDelta: 0,
  controlLossApplied: true
});

const DAMAGE_OVER_TIME_RESOLVE: StatusResolverDefinition['resolve'] = ({ statusId }) => ({
  hpDelta: getStatusDef(statusId).roundStartHpDelta,
  controlLossApplied: false
});

const HEAL_OVER_TIME_RESOLVE: StatusResolverDefinition['resolve'] = ({ statusId, targetHpBefore }) => ({
  hpDelta: targetHpBefore > 0 ? getStatusDef(statusId).roundStartHpDelta : 0,
  controlLossApplied: false
});

export const STATUS_RESOLVER_REGISTRY: StatusResolverRegistry = {
  stunned: {
    statusId: 'stunned',
    priority: 10,
    timings: ['onApply', 'onRoundStart'],
    resolve: STUN_RESOLVE
  },
  shielded: {
    statusId: 'shielded',
    priority: 20,
    timings: ['onApply'],
    resolve: NO_OP_RESOLVE
  },
  broken_armor: {
    statusId: 'broken_armor',
    priority: 30,
    timings: ['onApply'],
    resolve: NO_OP_RESOLVE
  },
  overheated: {
    statusId: 'overheated',
    priority: 40,
    timings: ['onRoundStart'],
    resolve: DAMAGE_OVER_TIME_RESOLVE
  },
  recovering: {
    statusId: 'recovering',
    priority: 50,
    timings: ['onRoundStart'],
    resolve: HEAL_OVER_TIME_RESOLVE
  }
};

export function getStatusResolver(statusId: StatusId): StatusResolverDefinition {
  const resolver = STATUS_RESOLVER_REGISTRY[statusId];
  if (resolver === undefined) {
    throw new Error(`Missing status resolver for statusId: ${statusId}`);
  }

  return resolver;
}

export function hasStatusResolveTiming(statusId: StatusId, phase: 'onApply' | 'onRoundStart'): boolean {
  return getStatusResolver(statusId).timings.includes(phase);
}

export function getResolversForRoundStart(statusIds: readonly StatusId[]): StatusResolverDefinition[] {
  return statusIds
    .map((statusId) => getStatusResolver(statusId))
    .filter((resolver) => resolver.timings.includes('onRoundStart'))
    .sort((left, right) => left.priority - right.priority || left.statusId.localeCompare(right.statusId));
}
