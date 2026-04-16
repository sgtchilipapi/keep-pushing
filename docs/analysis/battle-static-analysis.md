# Battle Simulation Static Analysis (Code-Confirmed)

Scope analyzed:
- `engine/battle/*`
- `engine/rng/xorshift32.ts`
- `app/api/combat/route.ts`
- `components/BattleReplay.tsx`
- `types/battle.ts`, `types/combat.ts` (shared battle/combat types)

This document records **only behavior directly present in code**. Any uncertain interpretation is marked **Needs Verification**.

## 1) Engine Architecture

### Entry points
1. `simulateBattle(input: BattleInput)` in `engine/battle/battleEngine.ts` is the simulation entry.
2. `POST(request)` in `app/api/combat/route.ts` validates payload and invokes `simulateBattle`.
3. UI trigger: `onSimulate` in `app/battle/page.tsx` posts to `/api/combat`; replay consumption happens in `components/BattleReplay.tsx`.

### Core execution flow
1. Seeded RNG created (`new XorShift32(input.seed)`).
2. Runtime entities created from snapshots:
   - Clone initial snapshots.
   - Apply flat passives once at battle start.
   - Initialize cooldown map for each active skill to `0`.
   - Initialize initiative to `0`; statuses `{}`.
3. For each round up to `maxRounds` (default `30`):
   - Emit `ROUND_START`.
   - Add initiative by speed to alive entities.
   - While any alive entity has initiative `>= 100`:
     - Select next actor by initiative desc, speed desc, entityId asc.
     - Stop turn loop early if actor or target hp `<= 0`.
     - Spend 100 initiative.
     - If actor stunned, emit `STUNNED_SKIP` and end that action.
     - Choose action via `chooseAction` from available skills.
     - Emit `ACTION`.
     - If non-basic skill, set cooldown and emit `COOLDOWN_SET`.
     - Apply conditional passives to attack context.
     - Resolve hit + damage (`resolveAttack`) and emit `HIT_RESULT`.
     - On hit:
       - Subtract hp, clamp min to `0`, emit `DAMAGE`.
       - Apply each status from skill, emitting `STATUS_APPLY` or `STATUS_REFRESH`.
       - If target hp becomes `0`, emit `DEATH`, set winner, break.
   - End-of-round phase:
     - Decrement cooldowns for both entities.
     - Decrement status durations + emit expirations.
     - Emit `ROUND_END`.
   - If winner set, break outer round loop.
4. If no winner after rounds, choose timeout winner (hp desc, then initiative desc, then entityId lexicographic asc) and reason `timeout`.
5. Emit `BATTLE_END`; return battle result.

### Main modules and responsibilities
- `battleEngine.ts`: orchestrates battle lifecycle, events, initiative loop, cooldown/status update timing, win resolution.
- `initiative.ts`: readiness checks, actor ordering, timeout winner tiebreaking.
- `aiDecision.ts`: skill candidate selection + deterministic scoring.
- `skillRegistry.ts`: static skill catalog + lookup + basic attack id constant.
- `resolveDamage.ts`: hit chance/damage math + RNG roll.
- `resolveStatus.ts`: status apply/refresh and round-end expiration.
- `statusRegistry.ts`: status IDs and fixed durations.
- `applyPassives.ts`: flat passive stat application and conditional passive modifiers at attack time.
- `passiveRegistry.ts`: passive definitions + lookup.
- `rng/xorshift32.ts`: deterministic RNG engine.
- `learning.ts`: learned skill-weight scoring contribution and post-battle weight updates (used by AI scoring input).
- `app/api/combat/route.ts`: request validation + simulation call + JSON response.
- `components/BattleReplay.tsx`: event-to-text rendering and final HP reconstruction from damage events.

### Data flow between modules
- API request body (`playerInitial`, `enemyInitial`, `seed`) -> `simulateBattle`.
- `simulateBattle` calls:
  - `applyFlatPassives` (startup entity transformation).
  - `applyRoundInitiative`, `hasReadyActor`, `nextActorIndex`, `timeoutWinner`.
  - `chooseAction` (consumes cooldowns, target status snapshot, learned weights).
  - `getSkillDef` for selected skill.
  - `applyConditionalPassives` (attack-time stat/accuracy modification).
  - `resolveAttack` using RNG.
  - `applyStatus` and `decrementStatusesAtRoundEnd`.
- `BattleResult.events` consumed by replay component and by learning utilities (`buildSkillContributions`).

## 2) State Model

### `CombatantSnapshot` (`engine/battle/battleEngine.ts`)
Fields:
- `entityId: string` unique combatant identifier.
- `hp, hpMax, atk, def, spd, accuracyBP, evadeBP: number` combat stats.
- `activeSkillIds: [string, string]` exactly two active skills.
- `passiveSkillIds?: [string, string]` optional passive skill pair.
Read:
- Throughout simulation for initiative, attack, decision, win checks.
Mutated:
- Initial input snapshots are not mutated directly; cloned copies are used.

### `BattleInput` (`battleEngine.ts`)
Fields:
- `battleId`, `seed`, `playerInitial`, `enemyInitial`, optional `playerSkillWeights`, `enemySkillWeights`, `maxRounds`.
Read:
- All simulation initialization and per-turn decision contexts.
Mutated:
- Not mutated.

### `BattleEvent` union (`battleEngine.ts`)
Represents emitted timeline event types:
`ROUND_START`, `STUNNED_SKIP`, `ACTION`, `HIT_RESULT`, `STATUS_APPLY`, `STATUS_REFRESH`, `STATUS_EXPIRE`, `DAMAGE`, `COOLDOWN_SET`, `DEATH`, `ROUND_END`, `BATTLE_END`.
Read:
- Replay renderer, learning contribution builder.
Mutated:
- Appended to `events` array only.

### `BattleResult` (`battleEngine.ts`)
Fields:
- `battleId`, `seed`, `playerInitial`, `enemyInitial`, `events`, `winnerEntityId`, `roundsPlayed`.
Read:
- API response consumer and replay.
Mutated:
- Constructed once at return.

### `RuntimeEntity` (`battleEngine.ts`, internal)
`CombatantSnapshot` plus:
- `initiative: number`
- `cooldowns: Record<string, number>`
- `statuses: ActiveStatuses`
Read:
- turn readiness/order, action gating, hit/damage input, end conditions.
Mutated:
- `initiative` (+spd each round, -100 per action).
- `cooldowns` (set on active-skill use; decremented each round).
- `statuses` (applied/refreshed on hit; decremented/removed at round end).
- `hp` (reduced on hit damage).

### `ActiveStatuses` (`resolveStatus.ts`)
Type: `Partial<Record<StatusId, number>>`.
Meaning: map from status id to remaining turns.
Read:
- stun skip condition, target status list for AI scoring, status decrement.
Mutated:
- `applyStatus`, `decrementStatusesAtRoundEnd`.

### `StatusDef` and `StatusId` (`statusRegistry.ts`)
- `StatusId`: `'stunned' | 'shielded' | 'broken_armor' | 'silenced' | 'resist'`.
- `StatusDef`: `{id, durationTurns}`.
Read:
- `applyStatus` loads duration.
Mutated:
- registry immutable at runtime.

### `SkillDef` (`skillRegistry.ts`)
Fields:
- `skillId`, `basePower`, `accuracyModBP`, `cooldownTurns`, `tags`, optional `executeThresholdBP`, optional `appliesStatusIds`.
Read:
- decision scoring and action execution.
Mutated:
- definitions immutable.

### `AttackSnapshot`, `AttackSkill`, `AttackResolution` (`resolveDamage.ts`)
Read:
- attack resolution calculations.
Mutated:
- none (pure computation objects).

### `DecisionCombatantSnapshot`, `CandidateAction` (`aiDecision.ts`)
Read:
- AI scoring and selected skill output.
Mutated:
- none.

### Passive model (`passiveRegistry.ts` / `applyPassives.ts`)
- `PassiveStatKey`, `PassiveStatModifiers`, `PassiveCondition` (`target_hp_below_bp`), `ConditionalPassiveModifier`, `PassiveDef`.
Read:
- at setup (flat) and attack-time (conditional).
Mutated:
- registry immutable; derived modified snapshots are new objects.

### Learning model (`learning.ts`)
- `ArchetypeSkillWeights`: `Record<string, number>`.
- `SkillContribution`: `{damageDealt, statusTurnsApplied}`.
- `SkillContributions`: per-skill contribution map.
Read:
- chooseAction via `scoreLearnedWeightTerm`.
Mutated:
- `updateSkillWeights` returns new map (does not mutate input object directly).

### Shared types (`types/battle.ts`, `types/combat.ts`)
- Define alternative battle/combat interfaces with `number` entity IDs and different event payload shapes.
- **Needs Verification**: These appear not wired into `engine/battle/*` or API route; likely legacy or parallel type surface.

## 3) Implemented Mechanics

### M1. Initiative accumulation
- Files/functions: `initiative.ts` / `applyRoundInitiative`.
- Trigger: every round start before action loop.
- Resolution:
  1. For each combatant with `hp > 0`, `initiative += spd`.
- State change: initiative increases only for living entities.
- Outputs/events: none directly.

### M2. Ready actor eligibility
- Files/functions: `initiative.ts` / `hasReadyActor`.
- Trigger: action loop condition.
- Resolution: true if any combatant has `hp > 0` and `initiative >= 100`.
- State change: none.
- Outputs/events: none.

### M3. Turn order tiebreaking
- Files/functions: `initiative.ts` / `nextActorIndex`, `compareTurnOrder`.
- Trigger: each action selection.
- Resolution order among ready living combatants:
  1. higher initiative
  2. higher speed
  3. lexicographically smaller `entityId`
- State change: none.
- Outputs/events: none.

### M4. Action initiative cost
- Files/functions: `battleEngine.ts` in action loop.
- Trigger: actor selected and before stun check.
- Resolution: `actor.initiative -= 100`.
- State change: initiative spend always occurs even if stunned.
- Outputs/events: may be followed by `STUNNED_SKIP`.

### M5. Stun skip behavior
- Files/functions: `battleEngine.ts` (`if (actor.statuses.stunned > 0)`).
- Trigger: actor has positive stunned turns when acting.
- Resolution:
  1. Emit `STUNNED_SKIP`.
  2. `continue` without action choice/attack.
- State change: only initiative was already reduced.
- Outputs/events: `STUNNED_SKIP`.

### M6. Action candidate availability via cooldown
- Files/functions: `aiDecision.ts` / `chooseAction`.
- Trigger: non-stunned actor turn.
- Resolution:
  1. Candidate list starts with `1000` always.
  2. Add each active skill where cooldown is exactly `0`.
- State change: none.
- Outputs/events: chosen skill returned.

### M7. Skill scoring (base + bonuses + penalties + learned term)
- Files/functions: `aiDecision.ts` / `scoreSkill`.
- Trigger: skill ranking in `chooseAction`.
- Resolution:
  1. Base score = `basePower`.
  2. `+200` if non-basic skill.
  3. Execute tag: if target HP% BP <= threshold, `+500`.
  4. Stun tag against already stunned target: `-10000`.
  5. Shieldbreak tag against shielded target: `+350`.
  6. Add learned weight term from `learning.ts`.
  7. Select highest score; tie by `skillId` lexicographic ascending.
- State change: none.
- Outputs/events: affects `ACTION.skillId`.

### M8. Unknown skill handling
- Files/functions: `skillRegistry.ts` / `getSkillDef`; used in `chooseAction` and engine execution.
- Trigger: candidate skill id missing from registry.
- Resolution: throws `Error('Unknown skillId: ...')`.
- State change: simulation aborts via exception.
- Outputs/events: no graceful battle event; caller error path.

### M9. Cooldown set on active skill usage
- Files/functions: `battleEngine.ts`.
- Trigger: selected skill is not basic attack.
- Resolution:
  1. `actor.cooldowns[skillId] = cooldownTurns`.
  2. Emit `COOLDOWN_SET`.
- State change: cooldown map updated.
- Outputs/events: `COOLDOWN_SET`.

### M10. End-of-round cooldown decrement
- Files/functions: `battleEngine.ts` / `decrementCooldowns`.
- Trigger: every round end (both entities), even if winner decided mid-round.
- Resolution: for each active skill `cooldown = max(0, cooldown - 1)`.
- State change: cooldown reduction floor at 0.
- Outputs/events: none.

### M11. Flat passive application at battle start
- Files/functions: `applyPassives.ts` / `applyFlatPassives`, `collectFlatModifiers`.
- Trigger: runtime entity initialization.
- Resolution:
  1. Gather all passive `flatStats` deltas across passive IDs.
  2. Sum per stat key.
  3. Add to snapshot stats.
- State change: runtime base stats modified once before battle loop.
- Outputs/events: none.

### M12. Conditional passive application at each attack
- Files/functions: `applyPassives.ts` / `applyConditionalPassives`.
- Trigger: after skill selected, before `resolveAttack`.
- Resolution:
  1. Iterate actor passive IDs.
  2. For each conditional modifier, evaluate condition.
  3. If matched: apply actor stat deltas, target stat deltas, and add skill accuracy modifier.
  4. Multiple matching modifiers accumulate in iteration order.
- State change: no persistent mutation to runtime entities from conditional passives; modified local attack snapshots only.
- Outputs/events: none directly; influences hit/damage.

### M13. Supported passive conditions
- Files/functions: `passiveRegistry.ts`, `applyPassives.ts` / `conditionMatches`.
- Trigger: conditional passive check.
- Resolution:
  - Only implemented condition kind: `target_hp_below_bp` using floor hp percent basis points.
- State change: none.
- Outputs/events: none.

### M14. Hit chance calculation and clamp
- Files/functions: `resolveDamage.ts` / `calculateHitChanceBP`, `clamp`.
- Trigger: every resolved attack.
- Resolution: `actor.accuracyBP - target.evadeBP + skill.accuracyModBP`, clamped to `[500, 9500]`.
- State change: none.
- Outputs/events: value emitted in `HIT_RESULT.hitChanceBP`.

### M15. RNG hit roll and hit success
- Files/functions: `resolveDamage.ts` / `resolveAttack`; RNG in `xorshift32.ts`.
- Trigger: every resolved attack.
- Resolution:
  1. `rollBP = rng.nextInt(1, 10000)`.
  2. Hit if `rollBP <= hitChanceBP`.
- State change: RNG state advances.
- Outputs/events: `HIT_RESULT` with roll + didHit.

### M16. Damage formula
- Files/functions: `resolveDamage.ts` / `calculateDamage`.
- Trigger: attack hit.
- Resolution:
  1. `raw = basePower + actor.atk`.
  2. `damage = floor(raw * 100 / (100 + target.def))`.
  3. Final damage `max(1, damage)`.
- State change: target HP reduction in engine.
- Outputs/events: `DAMAGE.amount`.

### M17. HP mutation and clamp
- Files/functions: `battleEngine.ts`.
- Trigger: on hit.
- Resolution: `target.hp = max(0, target.hp - damage)`.
- State change: target hp lowered, not below 0.
- Outputs/events: `DAMAGE` with `targetHpAfter`.

### M18. On-hit status application/refresh
- Files/functions: `battleEngine.ts`, `resolveStatus.ts` / `applyStatus`.
- Trigger: attack hits and skill has `appliesStatusIds`.
- Resolution per status id:
  1. Lookup status def duration.
  2. If status currently active (`>0`), emit `STATUS_REFRESH`; else `STATUS_APPLY`.
  3. Set remaining turns to full duration.
- State change: target status map updated.
- Outputs/events: status apply/refresh events.

### M19. End-of-round status decrement and expiration
- Files/functions: `resolveStatus.ts` / `decrementStatusesAtRoundEnd`.
- Trigger: each round end for each combatant.
- Resolution:
  1. Iterate sorted status IDs.
  2. If remaining <=0, delete.
  3. Else decrement by 1.
  4. If reaches <=0, delete and emit `STATUS_EXPIRE`.
- State change: status durations decrease/remove.
- Outputs/events: zero or more `STATUS_EXPIRE`.

### M20. Death detection
- Files/functions: `battleEngine.ts`.
- Trigger: immediately after damage on hit.
- Resolution: if `target.hp === 0`, emit `DEATH`, set winner=actor, reason='death', break action loop.
- State change: terminal winner state set.
- Outputs/events: `DEATH`.

### M21. Round boundary events
- Files/functions: `battleEngine.ts`.
- Trigger: each loop round start/end.
- Resolution: emit `ROUND_START` then `ROUND_END` each processed round.
- State change: none.
- Outputs/events: round markers.

### M22. Timeout winner tiebreak
- Files/functions: `initiative.ts` / `timeoutWinner`; used in `battleEngine.ts`.
- Trigger: no death winner after `maxRounds`.
- Resolution priority:
  1. higher hp
  2. higher initiative
  3. lexicographically smaller entityId
- State change: winner and reason set.
- Outputs/events: `BATTLE_END` reason `timeout`.

### M23. Battle end event
- Files/functions: `battleEngine.ts`.
- Trigger: after death win or timeout decision.
- Resolution: emit `BATTLE_END` with final round, winner entity ID, reason.
- State change: none.
- Outputs/events: `BATTLE_END`.

### M24. Learning contribution extraction
- Files/functions: `learning.ts` / `buildSkillContributions`.
- Trigger: explicit caller use (not inside `simulateBattle`).
- Resolution:
  - Tracks latest `ACTION` skill per actor.
  - Credits `DAMAGE` by actor to latest action skill damage.
  - Credits `STATUS_APPLY/REFRESH` by source to latest action skill statusTurns using event remainingTurns.
- State change: returns contribution map only.
- Outputs/events: none.

### M25. Learning weight update rule
- Files/functions: `learning.ts` / `updateSkillWeights`.
- Trigger: explicit caller use (external to engine loop).
- Resolution:
  - For each skill contribution compute damage/status parts.
  - Weighted contribution: 70% damage, 30% status.
  - Delta scaled by learningRate and sign (+win/-loss).
  - Clamp resulting weights to [-1000, 1000].
- State change: returns new weight map.
- Outputs/events: none.

### M26. API payload validation and rejection
- Files/functions: `app/api/combat/route.ts`.
- Trigger: POST request.
- Resolution:
  - Invalid JSON -> 400 with `Invalid JSON body.`.
  - Invalid shape/types -> 400 with payload error message.
  - Valid -> simulate and return JSON result.
- State change: none in engine state.
- Outputs/events: HTTP response surface.

### M27. Replay output derivation
- Files/functions: `components/BattleReplay.tsx`.
- Trigger: render with `BattleResult`.
- Resolution:
  - Initial HP state from initial snapshots.
  - Apply each `DAMAGE` event’s `targetHpAfter` to derive displayed final HP.
  - Render per-event text mapping by event type.
- State change: UI state memo only.
- Outputs/events: visual log lines.

## 4) Supported Actions / Commands

### A1. Basic attack (`1000`)
- Preconditions:
  - Actor has turn and is not stunned.
  - Always candidate regardless of cooldowns.
- Execution path:
  - `chooseAction` may select it if highest score/tiebreak.
  - No cooldown set event.
  - Resolve attack/hit/damage/status list (empty by default).
- Mutations:
  - May reduce target hp.
- Side effects:
  - `ACTION`, `HIT_RESULT`, maybe `DAMAGE`, maybe `DEATH`.
- Rejection/failure:
  - None specific.

### A2. Active skill: `1001`
- Preconditions:
  - In actor `activeSkillIds` and cooldown exactly 0.
- Execution path:
  - Selected by scoring.
  - Cooldown set to 2.
  - Attack resolution with basePower 170.
  - On hit applies `broken_armor` (duration from status registry: 2).
- Mutations:
  - cooldown map, target hp, target statuses.
- Side effects:
  - `ACTION`, `COOLDOWN_SET`, `HIT_RESULT`, optional `DAMAGE`, `STATUS_APPLY/REFRESH`, optional `DEATH`.
- Rejection/failure:
  - Excluded from candidates while cooldown > 0.

### A3. Active skill: `1002`
- Preconditions:
  - In actor `activeSkillIds` and cooldown exactly 0.
- Execution path:
  - Selected by scoring (execute/stun tags affect score).
  - Cooldown set to 3.
  - Attack resolution with basePower 140 and accuracyMod +300.
  - On hit applies `stunned` (duration 1).
- Mutations:
  - cooldown map, target hp, target statuses.
- Side effects:
  - same event pattern as above.
- Rejection/failure:
  - Excluded while cooldown > 0.

### A4. API command: `POST /api/combat`
- Preconditions:
  - JSON body with numeric `seed`, valid combatant snapshots for player/enemy.
- Execution path:
  - validation -> `simulateBattle` -> JSON response.
- Mutations:
  - none persistent.
- Side effects:
  - HTTP 200 result or 400 validation error.
- Rejection/failure:
  - invalid JSON/shape returns 400.
  - unhandled simulation exception (e.g., unknown skill/passive) **Needs Verification** on exact HTTP behavior (no local catch around simulation call).

## 5) Resolution Order

Exact sequence in one round:
1. `ROUND_START` event.
2. Initiative accumulation.
3. Repeat while ready actor exists:
   1. Determine actor index (`nextActorIndex`).
   2. Resolve actor/target references.
   3. Early break if actor or target dead.
   4. Spend initiative (-100).
   5. If stunned -> emit `STUNNED_SKIP`, continue.
   6. Choose action (`chooseAction`).
   7. Emit `ACTION`.
   8. If non-basic -> set cooldown + emit `COOLDOWN_SET`.
   9. Apply conditional passives (attack context only).
   10. Resolve attack (`resolveAttack`): hit chance, RNG roll, didHit, damage.
   11. Emit `HIT_RESULT`.
   12. If hit:
       - mutate target hp and emit `DAMAGE`.
       - apply skill statuses in listed order; emit apply/refresh events.
       - if hp zero -> emit `DEATH`, set winner/reason, break action loop.
4. End-of-round always executed for processed round:
   1. decrement player cooldowns
   2. decrement enemy cooldowns
   3. decrement player statuses and emit expiries
   4. decrement enemy statuses and emit expiries
   5. emit `ROUND_END`
5. If winner exists -> stop additional rounds.
6. If no winner after all rounds -> timeout winner selection.
7. Emit `BATTLE_END`.

## 6) Event / Output Surface

### Engine events (`BattleEvent` in `battleEngine.ts`)
1. `ROUND_START`: `{type, round}`
   - Source: start of each round.
2. `STUNNED_SKIP`: `{type, round, actorId}`
   - Source: actor has `stunned > 0` when turn comes.
3. `ACTION`: `{type, round, actorId, targetId, skillId}`
   - Source: after action selected.
4. `HIT_RESULT`: `{type, round, actorId, targetId, hitChanceBP, rollBP, didHit}`
   - Source: after resolveAttack.
5. `STATUS_APPLY` / `STATUS_REFRESH`: `{type, round, targetId, statusId, sourceId, remainingTurns}`
   - Source: `applyStatus` on successful hit status application.
6. `STATUS_EXPIRE`: `{type, round, targetId, statusId}`
   - Source: round-end decrement expiration.
7. `DAMAGE`: `{type, round, actorId, targetId, amount, targetHpAfter}`
   - Source: on hit damage application.
8. `COOLDOWN_SET`: `{type, round, actorId, skillId, cooldownRemainingTurns}`
   - Source: non-basic skill chosen.
9. `DEATH`: `{type, round, entityId}`
   - Source: hp reaches 0 due to hit.
10. `ROUND_END`: `{type, round}`
    - Source: end-of-round maintenance completed.
11. `BATTLE_END`: `{type, round, winnerEntityId, reason}` where reason in `death|timeout`.
    - Source: simulation termination.

### API output
- HTTP 200: serialized `BattleResult`.
- HTTP 400: JSON `{error: string}` for invalid JSON or invalid payload shape.

### UI output mapping
- Replay maps each engine event type to a text line; final HP display derived from damage events.

## 7) Determinism / RNG

### RNG usage locations
- Only battle hit roll uses RNG: `resolveAttack` -> `rng.nextInt(1, 10000)`.

### Seed handling
- Seed passed from input to `XorShift32` constructor.
- Seed normalized with bitwise `|0` (32-bit signed conversion).
- If normalized seed is `0`, internal state forced to `1`.

### Ordering guarantees affecting determinism
- Actor order deterministic by initiative/speed/entityId.
- Candidate skill tie deterministic by `skillId` lexicographic order.
- Status iteration at round end sorted by status ID.
- Passive iteration follows provided passive ID order.
- Skill status application order follows `appliesStatusIds` array order.

### Possible nondeterministic surfaces
- Engine core appears deterministic for fixed input snapshots/weights/seed.
- **Needs Verification**: JavaScript number edge behavior if non-finite values (`NaN`, `Infinity`) are injected (validation only checks `typeof number`, not finiteness in API route).

## 8) Boundary / Edge Handling

### Invalid inputs
- API validates object shape and primitive types only.
- Missing/wrong typed fields -> 400.
- `activeSkillIds` must be array length 2 of strings.
- `passiveSkillIds` is not validated in API helper but optional in engine type; unknown passive IDs throw if present and used.

### Duplicate actions / repeated scheduling
- No action queue; actions selected immediately on each ready turn.
- Duplicate skill usage allowed whenever cooldown permits.

### Empty states
- Engine assumes exactly two combatants from input.
- No support for zero-combatant battles.

### Simultaneous state changes
- Single-threaded sequential resolution; one actor processed at a time.
- No simultaneous damage exchange mechanics implemented.

### Zero/negative values
- Damage minimum 1 on hit even with high defense.
- HP clamp to min 0 when damaged.
- Status remaining <=0 cleaned up on decrement.
- Cooldowns clamped to min 0.
- Initiative can become negative/large positive without explicit bounds.
- If `hpMax <=0`, hp percentage helpers return 0 (in decision and passive condition checks).

### Overflow/underflow
- Arithmetic uses JS number.
- RNG bounds check protects invalid range in `nextInt`.
- No explicit overflow guards on stats/initiative/hp except local clamps.
- **Needs Verification**: behavior under extremely large numeric stat inputs.

### Dead units acting
- Dead units are excluded from readiness and initiative gain (`hp > 0` checks).
- Action loop breaks if actor or target hp <=0 before executing action.

### Stun/silence/disable-like behavior
- `stunned`: actively checked and causes turn skip.
- `silenced`: status exists in registry but no logic checks it during action choice/execution.
- `shielded`, `broken_armor`, `resist`: only influence behavior where explicitly referenced:
  - `shielded` affects AI score bonus for shieldbreak-tag skill.
  - `broken_armor` and `resist` have no direct mechanical effect in damage/status code.

### Battle end races
- On lethal hit, winner set immediately; inner loop breaks.
- End-of-round maintenance/events still run for that round before loop exits.
- Final `BATTLE_END` emitted once after loop.

## 9) Implicit Behaviors

1. A stunned actor still spends 100 initiative before skipping.
2. Stun with duration 1 applied during a round will typically be decremented at same round end, expiring before next round (depending on apply timing), which can produce immediate `STATUS_EXPIRE` after apply.
3. Battle can process multiple actions by same actor in one round if initiative remains >=100 after spending (high speed accumulation effect).
4. Timeout winner can be decided by lexicographically smaller `entityId` when hp and initiative tie.
5. `1000` always available ensures an action choice always exists for non-stunned actors.
6. Passive conditional effects do not persist to entity base stats; they affect only current attack resolution snapshot.
7. If both entities start with hp <=0, action loop effectively does nothing and timeout winner rules decide outcome.
8. API accepts any numeric seed (including non-integer); RNG constructor coerces to 32-bit int.
9. Round-end cooldown/status decrements happen even in round where death occurred before `ROUND_END`.

## 10) Master Feature Index (Distinct Implemented Behaviors)

1. Deterministic seeded RNG (XorShift32).
2. Zero-seed normalization to internal state 1.
3. Per-round initiative gain by speed for living entities.
4. Ready threshold at initiative >=100.
5. Turn selection by initiative, then speed, then entityId.
6. Fixed initiative cost of 100 per attempted action.
7. Stun skip gate (`stunned > 0`) with skip event.
8. Always-available basic attack candidate.
9. Active skill availability gated by exact cooldown=0.
10. Skill scoring from basePower.
11. Non-basic action score bonus (+200).
12. Execute bonus when target HP% below threshold (+500).
13. Wasted stun penalty when target already stunned (-10000).
14. Shieldbreak bonus when target shielded (+350).
15. Learned-weight additive scoring term.
16. Deterministic skill tie-break by skillId.
17. Unknown skill throws hard error.
18. Non-basic skill cooldown set and event emission.
19. Flat passive stat aggregation and one-time application.
20. Unknown passive throws hard error.
21. Conditional passive evaluation on actor passive list.
22. Conditional passive support for target HP threshold condition.
23. Conditional passive can modify actor stats for attack snapshot.
24. Conditional passive can modify target stats for attack snapshot.
25. Conditional passive can modify skill accuracy modifier.
26. Hit chance formula with clamp [500, 9500].
27. Random roll in [1,10000] inclusive.
28. Hit succeeds when roll <= hitChance.
29. Damage formula floor((basePower+atk)*100/(100+def)).
30. Damage minimum 1 on hit.
31. Miss deals 0 damage.
32. Target HP clamps to minimum 0 after hit.
33. Skill status effects apply only on hit.
34. Status apply vs refresh distinction by existing active status.
35. Status duration sourced from status registry.
36. Round-end status decrement by 1.
37. Status deletion and `STATUS_EXPIRE` on expiration.
38. Status iteration order sorted by statusId at decrement.
39. Death check immediately after damage.
40. Death emits event and ends action loop.
41. Round start marker event.
42. Round end marker event.
43. End-of-round cooldown decrement for both entities.
44. End-of-round status decrement for both entities.
45. Max rounds default to 30 if unspecified.
46. Timeout winner resolution by hp, then initiative, then entityId.
47. Battle end event includes reason `death|timeout`.
48. Result includes cloned initial snapshots and full event log.
49. API JSON parse failure returns 400 error.
50. API payload schema mismatch returns 400 error.
51. API success returns simulated battle JSON.
52. Replay component reconstructs HP from damage events.
53. Replay component maps event types to human-readable log lines.
54. Learning utility builds skill contributions from event stream.
55. Learning utility updates skill weights using win/loss-signed contribution and clamps.

## Confirmed vs Needs Verification Summary

### Confirmed (code-direct)
- All items M1–M27 and master features 1–55 above are directly implemented in inspected code.

### Needs Verification
1. Whether `types/battle.ts` and `types/combat.ts` are active production types or legacy/unused.
2. Exact API behavior for uncaught engine exceptions (unknown skill/passive etc.) since route does not wrap `simulateBattle` in try/catch.
3. Numeric edge behavior when non-finite numbers are provided in payload fields typed as `number`.
4. Extreme-number stability (very large stats/values) due to JS number precision limits.
