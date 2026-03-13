import type { StatusId } from '../statusRegistry';
import type { StatusResolverDefinition, StatusResolverRegistry } from './types';

const NO_OP_RESOLVE: StatusResolverDefinition['resolve'] = () => ({
  hpDelta: 0,
  controlLossApplied: false
});

const CONTROL_LOSS_RESOLVE: StatusResolverDefinition['resolve'] = () => ({
  hpDelta: 0,
  controlLossApplied: true
});

export const STATUS_RESOLVER_REGISTRY: StatusResolverRegistry = {
  stunned: {
    statusId: 'stunned',
    priority: 10,
    timings: ['onApply', 'onRoundStart'],
    resolve: CONTROL_LOSS_RESOLVE
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
  silenced: {
    statusId: 'silenced',
    priority: 40,
    timings: ['onApply', 'onRoundStart'],
    resolve: CONTROL_LOSS_RESOLVE
  },
  resist: {
    statusId: 'resist',
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
