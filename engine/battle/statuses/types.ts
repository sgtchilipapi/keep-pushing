import type { StatusId } from './statusRegistry';

/**
 * Enumerates battle lifecycle points where a status resolver may run.
 *
 * @remarks
 * `onApply` executes immediately after a status is successfully applied.
 * `onRoundStart` executes at the beginning of each round before normal actor turns.
 */
export type StatusResolvePhase = 'onApply' | 'onRoundStart';

/**
 * Input payload passed to a status resolver invocation.
 *
 * @remarks
 * This context provides deterministic battle state needed to resolve a status effect
 * without giving direct mutation access to combatant objects.
 */
export type StatusResolutionContext = {
  /** 1-based round number in which this resolution occurs. */
  round: number;
  /** Status currently being resolved. */
  statusId: StatusId;
  /** Entity ID of the combatant that originally applied the status. */
  sourceId: string;
  /** Entity ID of the combatant currently affected by the status. */
  targetId: string;
  /** Target HP value immediately before applying this resolver's result. */
  targetHpBefore: number;
  /** Lifecycle phase that triggered this resolver execution. */
  phase: StatusResolvePhase;
};

/**
 * Output produced by a status resolver.
 *
 * @remarks
 * The engine applies `hpDelta` additively to target HP and clamps at zero.
 * A negative `hpDelta` deals damage; a positive `hpDelta` heals.
 */
export type StatusResolutionResult = {
  /** Signed HP change to apply to the target for this resolution step. */
  hpDelta: number;
  /** Whether this status instance applies control loss semantics for this resolution. */
  controlLossApplied: boolean;
};

/**
 * Canonical resolver configuration for a specific status effect.
 *
 * @remarks
 * Definitions are registered once and reused by the battle engine for all status
 * resolution calls.
 */
export type StatusResolverDefinition = {
  /** Status this resolver handles. */
  statusId: StatusId;
  /** Ascending execution order among resolvers in the same phase. */
  priority: number;
  /** Phases in which this resolver is eligible to run. */
  timings: readonly StatusResolvePhase[];
  /**
   * Pure resolution function that computes effect output from a contextual snapshot.
   *
   * @param context - Runtime metadata for the current status resolution call.
   * @returns The status effect outcome to emit and apply.
   */
  resolve: (context: StatusResolutionContext) => StatusResolutionResult;
};

/**
 * Complete map of resolver definitions keyed by status ID.
 *
 * @remarks
 * Registry consumers expect every {@link StatusId} to have a corresponding resolver.
 */
export type StatusResolverRegistry = Record<StatusId, StatusResolverDefinition>;
