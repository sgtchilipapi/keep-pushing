# Planned Features

This document tracks candidate future improvements across combat architecture, API boundaries, and battle mechanics.

## Entry Index
- [ ] Entry 1: Canonical Combatant Contract and Adapter Layer

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