# Planned Features

This document tracks candidate future improvements across combat architecture, API boundaries, and battle mechanics.

## Entry Index
- [ ] Entry 1: Canonical Combatant Contract and Adapter Layer
- [ ] Entry 2: AI Decision System Redesign Trajectory

## Entry 1: Split Accuracy and Evade Roll Resolution

### Description
Consider replacing the single combined hit-threshold check with two independent checks (accuracy and evade).

### Current State
- Hit chance is resolved with one bounded basis-point threshold and one RNG roll.
- Existing balancing and replay expectations are tuned to this model.

### Desired Implementation
- Resolve `accuracySuccess` and `evadeSuccess` separately.
- Determine hit result from both outcomes and emit richer combat-log/replay details.

### Advantages
- Clearer semantics (miss vs dodge).
- Better support for dodge-reactive or accuracy-reactive mechanics.
- More expressive debugging and replay events.

### Disadvantages (including refactoring costs)
- Requires broad rebalance due to probability model shift.
- Changes RNG draw sequence, impacting deterministic replay/snapshots.
- Requires updates to event payloads, test fixtures, and hit-resolution assumptions.

## Entry 2: AI Decision System Redesign Trajectory

### Description
Summarize and execute a phased redesign of battle AI decision-making so scoring is feature-driven, intent-aware, and still deterministic/testable. For full rationale and detailed phase breakdown, see `docs/ai-decision-design-trajectory.md`.

### Current State
- AI uses a single-pass heuristic score over available skills.
- Skill ranking relies on `basePower`, hardcoded bonuses/penalties, and a learned residual term.
- Tactical context is shallow (mostly target-centric), with limited support for setup/future-turn value.

### Desired Implementation
- Expand to a richer deterministic `DecisionContext` (actor, target, cooldowns, statuses, turn/tempo).
- Refactor to explicit feature extraction with observable score contributions.
- Replace fixed constants with configurable feature weights (optionally archetype-specific).
- Add an intent layer (`finish`, `survive`, `control`, `setup`, `attrition`) and score skills across intents.
- Upgrade learning to operate as a bounded residual over interpretable features.
- Add lightweight one-turn foresight proxies before any deeper lookahead/search.

### Advantages
- Reduces brittle scripted behavior and hidden prioritization from constants.
- Improves extensibility for utility/control skills that do not map to raw damage.
- Preserves deterministic replay while improving transparency through score traces.
- Creates a safer path for balancing and future learning upgrades.

### Disadvantages (including refactoring costs)
- Requires staged refactors with parity tests to avoid behavior regressions.
- Increases model/config complexity (feature catalogs, weight tables, intent wiring).
- May require substantial rebalance/tuning and additional AI behavior tests.
- Lightweight foresight still adds implementation/test overhead before full planner benefits.
