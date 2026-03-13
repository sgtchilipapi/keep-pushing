import type { StatusId } from '../statusRegistry';

export type StatusResolvePhase = 'onApply' | 'onRoundStart';

export type StatusResolutionContext = {
  round: number;
  statusId: StatusId;
  sourceId: string;
  targetId: string;
  targetHpBefore: number;
  phase: StatusResolvePhase;
};

export type StatusResolutionResult = {
  hpDelta: number;
  controlLossApplied: boolean;
};

export type StatusResolverDefinition = {
  statusId: StatusId;
  priority: number;
  timings: readonly StatusResolvePhase[];
  resolve: (context: StatusResolutionContext) => StatusResolutionResult;
};

export type StatusResolverRegistry = Record<StatusId, StatusResolverDefinition>;
