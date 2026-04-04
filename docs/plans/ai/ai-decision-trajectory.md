# AI Decision Trajectory

This file is the canonical entrypoint for the AI decision redesign trajectory, which now explicitly favors **Option B: weak-prior + learning hybrid**.

- Updated assessment and trajectory: `docs/plans/ai/ai-decision-design-trajectory.md`
- Detailed execution plan: `docs/plans/ai/ai-decision-implementation-plan.md`

## Delivery Status

- Slice 1 completed on the current branch: richer `DecisionContext` plumbing and versioned context logging are in place.
- Slice 2 completed on the current branch: intent-aware tactical behavior (`finish` / `survive` / `control` / `setup` / `attrition`) now shapes scoring.
- Slice 3 completed on the current branch: deterministic opponent prediction and one-turn projection terms now feed projection-aware scoring, including full selected-action weight breakdowns, and scenario coverage.
- Slice 4 completed on the current branch: near-neutral learning states now add bounded feature-level residuals with confidence/decay, emit `decision-trace.v6` scoring breakdowns, and ship with deterministic regression-league progression coverage.
- Next planned slice: optional rollout/config gating to promote the feature model by default once broader league and replay gates are institutionalized.
