# Combat Simulation Test Scenario Matrix

This document enumerates the complete set of combat simulation scenario categories that should be covered by automated tests for a deterministic, server-authoritative, 1v1 turn-based engine.

## 1) Input Contract & Validation

- Missing required top-level fields (`battleId`, `seed`, `playerInitial`, `enemyInitial`).
- Invalid field types (string vs number, nulls, arrays where objects expected).
- Out-of-range numeric stats (`hp`, `atk`, `def`, `spd`, `accuracyBP`, `evadeBP`).
- Invalid skill array cardinality (not exactly 2 active skills, malformed passive slots).
- Unknown `skillId` in loadout.
- Unknown passive IDs in loadout.
- Invalid/negative `maxRounds` and boundary values (`0`, `1`, very high).
- Duplicate `entityId` values between player and enemy.
- Invalid seed values (negative, zero, max uint32, non-integer).
- Contract mismatch regressions between API DTOs and engine input contracts.

## 2) Determinism, Replayability, and Reproducibility

- Same input + same seed produces byte-identical event logs.
- Same input + different seed changes at least one stochastic outcome when RNG is used.
- Deterministic tie-breaking with no RNG dependence (initiative/SPD/entityId order).
- Replay reconstruction from event log reproduces final HP/winner.
- Deterministic behavior under repeated simulation loops (N runs in-process).
- Snapshot-clone safety: input snapshots remain unchanged post-simulation.

## 3) Round Lifecycle Ordering

- Canonical phase order per round is preserved:
  1. Status resolution window
  2. Action resolution
  3. Status decrement/expire
  4. Cooldown decrement
  5. Round end event
- `ROUND_START` and `ROUND_END` emitted correctly for every played round.
- Early termination (death mid-round) short-circuits all remaining phase work.
- `BATTLE_END` emitted exactly once.

## 4) Initiative & Turn Scheduling

- Initiative accumulation occurs once per round for living entities only.
- Unit with initiative `<100` cannot act.
- Unit with high SPD can act multiple times in one round.
- Exact threshold behavior at initiative `== 100`.
- Spending initiative (`-100`) occurs per action attempt.
- Turn order tie-breakers validated in all combinations:
  - Higher initiative wins.
  - If equal initiative, higher SPD wins.
  - If equal SPD, lower/lexicographically-smaller `entityId` wins.
- Dead actors are excluded from scheduling.

## 5) Action Selection (AI Decision)

- Basic attack always available.
- Active skills available only when cooldown is `0`.
- Decision scoring chooses highest score deterministically.
- Tie scores resolved deterministically by stable tie-break rule.
- Learned weight term modifies decision but remains deterministic.
- Target-state-sensitive scoring paths (execute threshold, shield-break, anti-stun penalty).
- Behavior when all non-basic actions are gated.

## 6) Accuracy, Evasion, and Hit Resolution

- Guaranteed hit boundary cases (effective chance = 10000 BP).
- Guaranteed miss boundary cases (effective chance = 0 BP).
- Near-boundary basis-point cases (1 BP, 9999 BP).
- Correct integration of attacker accuracy and defender evasion.
- RNG roll inclusivity/exclusivity correctness (off-by-one checks).
- `HIT_RESULT` event consistency with subsequent `DAMAGE` emission.

## 7) Damage Calculation & HP State

- Base damage formula correctness for representative stat combinations.
- Minimum damage floor behavior (if applicable).
- High defense interactions and zero/near-zero damage paths.
- HP clamping at lower bound (`0`) and no negative HP.
- Overkill damage with immediate death handling.
- No damage event emitted when attack misses.

## 8) Death, Victory, and Timeout Resolution

- Death event emitted exactly once for defeated entity.
- Winner is actor opposite the dead target.
- Battle stops immediately after lethal resolution.
- Timeout winner selection at max rounds based on deterministic tiebreaks.
- Timeout tie matrix (HP tie, initiative tie, entityId tie-break).
- Correct `winReason`/terminal metadata for death vs timeout.

## 9) Cooldown Mechanics

- Cooldown set when non-basic skill is used.
- Cooldown not set for basic attack.
- Cooldown decrements once per round at end-of-round window.
- Cooldowns never drop below zero.
- Skill becomes re-eligible exactly when cooldown reaches zero.
- Multiple skills maintain independent cooldown counters.

## 10) Status Effect Application & Lifecycle

- Status apply on hit only (if design requires hit-gated application).
- Initial application emits `STATUS_APPLY` with correct duration.
- Reapplication/refresh emits `STATUS_REFRESH` and refreshes duration correctly.
- Status expiry emits `STATUS_EXPIRE` at correct timing.
- Multiple concurrent statuses on one entity coexist correctly.
- Unknown status ID handling (reject/fail-fast).

## 11) Status Timing Windows

- `onApply` effects resolve immediately upon successful apply.
- `onRoundStart` effects resolve before any actions.
- Deterministic resolution priority among multiple status handlers.
- Deterministic multi-target order (`SPD` desc then `entityId` asc).
- Death caused by status tick short-circuits subsequent action processing.

## 12) Specific Status Behaviors

- **Stun:** actor loses action, initiative already spent, emits skip event.
- **Shielded:** mitigation/interaction behavior validated across hit/miss and damage values.
- **Broken Armor:** defense reduction effect and duration behavior.
- **Silenced:** action restriction behavior (active-skill lockout if applicable).
- **Resist:** reduced chance/effect interaction for incoming statuses.
- Interaction matrix of status vs status (e.g., shieldbreak vs shielded, stun reapply while stunned).

## 13) Passive Skill Mechanics

- Flat passives applied once at battle initialization.
- Conditional passives activated only when condition is met.
- Conditional passives not leaked across turns when condition stops matching.
- Multiple passives stack order and cumulative math.
- Passive effects reflected in attack snapshots and event outcomes.

## 14) Learning/Adaptation Hooks

- Skill contribution attribution from event log is correct.
- Post-battle weight update is deterministic for same battle log.
- Positive/negative reinforcement updates bounded as expected.
- Learning updates do not mutate original input weight maps.
- Updated weights influence future action choice in expected direction.

## 15) Event Log Integrity & Contract Stability

- Every emitted event matches schema and required fields.
- Event chronology is valid (no impossible ordering).
- IDs in events (`actorId`, `targetId`, etc.) always refer to valid entities.
- Event count sanity (no duplicate terminal events, no missing starts/ends).
- Backward compatibility snapshots for public event contract changes.

## 16) API Route Integration

- Route accepts valid payload and returns successful result shape.
- Route rejects invalid payload with stable error contract/status code.
- API→engine mapping preserves values and canonical IDs.
- Engine exceptions transformed into expected server responses.

## 17) Performance & Stability

- Large batch simulation smoke tests complete under acceptable time.
- Max-round battles complete without memory growth anomalies.
- No infinite loops in initiative/action processing.
- Deterministic performance under repeated seeded runs.

## 18) Regression & Fuzz Suites

- Golden replay snapshots for representative archetype matchups.
- Seed sweep/property-based tests for invariant checking:
  - HP never below zero.
  - Exactly one winner at termination.
  - Terminal event emitted exactly once.
  - No actions by dead entities.
- Historical bug reproductions locked as regression tests.

## 19) Security & Trust Boundaries

- Client-provided snapshot tampering is validated/sanitized per API policy.
- Prevent impossible stat/skill injections from client payload.
- No reliance on client-reported outcomes.
- Deterministic server-only simulation remains authoritative.

## 20) Recommended Coverage Strategy

- **Unit tests:** pure math/ordering modules (initiative, damage, status helpers).
- **Integration tests:** full engine simulations with scenario-specific seeds.
- **Contract tests:** API schema and event payload compatibility.
- **Snapshot tests:** complete battle timelines for deterministic replay verification.
- **Property tests:** broad invariant checks across random seeds and generated builds.
