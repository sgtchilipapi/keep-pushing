import type { StatusId } from './statusRegistry';
import type { StatusResolverDefinition, StatusResolverRegistry } from './types';

const NO_OP_RESOLVE: StatusResolverDefinition['resolve'] = () => ({
  hpDelta: 0,
  controlLossApplied: false
});

const STUN_RESOLVE: StatusResolverDefinition['resolve'] = () => ({
  hpDelta: 0,
  controlLossApplied: true
});

const DAMAGE_OVER_TIME_RESOLVE: StatusResolverDefinition['resolve'] = () => ({
  hpDelta: 5,
  controlLossApplied: false
})

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
    timings: ['onApply', 'onRoundStart'],
    resolve: NO_OP_RESOLVE
  },
  broken_armor: {
    statusId: 'broken_armor',
    priority: 30,
    timings: ['onApply', 'onRoundStart'],
    resolve: NO_OP_RESOLVE
  },
  overheated: {
    statusId: 'overheated',
    priority: 40,
    timings: ['onApply', 'onRoundStart'],
    resolve: DAMAGE_OVER_TIME_RESOLVE
  },
  recovering: {
    statusId: 'recovering',
    priority: 50,
    timings: ['onApply', 'onRoundStart'],
    resolve: NO_OP_RESOLVE
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
