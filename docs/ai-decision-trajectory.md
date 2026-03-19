# AI Decision Trajectory

This file is the canonical entrypoint for the AI decision redesign trajectory, which now explicitly favors **Option B: weak-prior + learning hybrid**.

- Updated assessment and trajectory: `docs/ai-decision-design-trajectory.md`
- Detailed execution plan: `docs/ai-decision-implementation-plan.md`

## Delivery Status

- Slice 1 completed on the current branch: richer `DecisionContext` plumbing and versioned context logging are in place.
- Slice 2 completed on the current branch: intent-aware tactical behavior (`finish` / `survive` / `control` / `setup` / `attrition`) now shapes scoring.
- Slice 3 completed on the current branch: deterministic opponent prediction and one-turn projection terms now feed `decision-trace.v4` scoring and scenario coverage.
- Next planned slice: learning-model upgrades that keep weak priors stable while residual learning becomes the dominant long-run policy signal.
