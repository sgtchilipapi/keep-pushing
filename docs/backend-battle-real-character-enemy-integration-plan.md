# Backend Battle Integration Plan: Real Characters, Enemy Archetypes, and Settlement-Ready Persistence

This document locks the backend plan for replacing raw snapshot-driven battle execution with character-driven, settlement-backed combat.

Current-program-over-doc precedence:
- If future-facing docs disagree with the implemented Anchor program, battle execution and persistence must follow the current `runana-program` settlement interface first and record the mismatch explicitly.
- This document is a battle-execution-specific companion to [backend-solana-integration-implementation-plan.md](/home/paps/projects/keep-pushing/docs/backend-solana-integration-implementation-plan.md), which remains the broader settlement integration reference.
- This plan adopts only the subset of enemy architecture needed for static archetype-driven MVP battle generation. It does not adopt persistent enemy instances from [solana-enemy-data-architecture-plan.md](/home/paps/projects/keep-pushing/docs/solana-enemy-data-architecture-plan.md).

## Status

Status: Locked implementation plan for real character-driven combat, static enemy archetype integration, replay persistence, and settlement-ready battle outcome persistence.

## Goals

- Use real DB-persisted characters as the player-side input to battle simulation.
- Use real code-authored enemy archetypes as the enemy-side input to battle simulation.
- Persist durable battle replay/history data for each real battle.
- Persist settlement-ready battle outcome ledger rows that feed the existing sealing and relay pipeline.
- Preserve compatibility with the current settlement layer, including existing batch sealing, canonical payload hashing, prepare, submit, and reconcile behavior.

## Non-Goals

- Do not invent world progression rules in this slice.
- Do not add learning persistence in this slice.
- Do not redesign the existing settlement lifecycle, transaction assembly, or submission/retry policy.
- Do not replace the existing raw snapshot sandbox route used for direct engine testing.

## Current State

- [app/api/combat/route.ts](/home/paps/projects/keep-pushing/app/api/combat/route.ts) is still a raw snapshot-in, raw battle-result-out route.
- [BattleOutcomeLedger](/home/paps/projects/keep-pushing/prisma/schema.prisma) and [SettlementBatch](/home/paps/projects/keep-pushing/prisma/schema.prisma) already exist and already support settlement sealing and reconciliation.
- Character chain identity assignment and cursor reconciliation already exist through the real character creation flow in [characterCreation.ts](/home/paps/projects/keep-pushing/lib/solana/characterCreation.ts).
- The backend currently has no canonical enemy catalog beyond numeric bootstrap examples and settlement-side `enemyArchetypeId` handling.
- Settlement sealing already assumes oldest-first contiguous battle nonces and builds canonical `encounterHistogram` and `zoneProgressDelta` values from persisted ledger rows.

## Locked Decisions

- Enemy archetypes are code-authored, not DB-authored, in MVP.
- The canonical MVP enemy catalog contains the 10 SSOT archetypes:
  - `Scrap Drone`
  - `Razor Hound`
  - `Plated Enforcer`
  - `Signal Witch`
  - `Nano Leech`
  - `Cloak Stalker`
  - `Overclock Brute`
  - `Ward Turret`
  - `Protocol Knight`
  - `Overseer Unit`
- Stable numeric `enemyArchetypeId` values are assigned as `100..109`.
- Each zone maps to a curated allowed set of archetypes, not a single archetype and not caller-selected direct overrides.
- Encounter selection within a zone uses weighted deterministic RNG based on the battle seed.
- Real battle replay persistence stores full replay payloads as JSON rather than normalizing events into separate tables.
- `zoneProgressDelta = []` for this slice.

## Architecture

### Enemy registry module

- Add a typed backend enemy registry module that owns:
  - `EnemyArchetypeDef`
  - stable `enemyArchetypeId`
  - display metadata
  - combat snapshot defaults
  - skill loadout
  - optional AI defaults
  - `expRewardBase`
- This registry is the single source of truth for:
  - battle enemy snapshot assembly
  - Solana bootstrap seeding inputs for `EnemyArchetypeRegistryAccount`
  - zone legality inputs for `ZoneEnemySetAccount`

### Zone encounter table module

- Add a typed zone encounter table module that owns:
  - `ZoneEncounterTable`
  - zone-to-archetype membership
  - per-archetype integer weights used for deterministic encounter selection
- The encounter table must stay consistent with the Solana bootstrap configuration used by settlement validation.

### Server-side battle snapshot assembly

- Build the player snapshot from persisted character state:
  - character base stats
  - equipped active skills
  - equipped passive skills
  - optional metadata such as `name` and `side`
- Build the enemy snapshot from the canonical enemy registry entry selected for the zone.

### New real encounter route

- Add a new public/backend route:
  - `POST /api/combat/encounter`
- This route is the settlement-backed combat path for real characters.
- Keep `POST /api/combat` unchanged as the raw snapshot sandbox path.

### Persistence transaction

- Real encounter execution persists two records atomically:
  - replay/history row
  - settlement ledger row
- The replay/history row is the durable battle record.
- The ledger row remains the settlement queue input for batch sealing.

## Data Model Changes

### Add `BattleRecord`

- Add a new `BattleRecord` model for durable replay/history persistence.
- Required fields:
  - `id`
  - `battleId`
  - `characterId`
  - `zoneId`
  - `enemyArchetypeId`
  - `seed`
  - `playerInitialJson`
  - `enemyInitialJson`
  - `winnerEntityId`
  - `roundsPlayed`
  - `eventsJson`
  - `createdAt`
  - `updatedAt`
- `battleId` must be unique and shared with the matching settlement ledger row.

### Keep `BattleOutcomeLedger` as the settlement queue

- `BattleOutcomeLedger` remains the settlement queue model and is not promoted to the replay/history store.
- It continues to hold settlement-facing fields only:
  - `characterId`
  - `battleId`
  - `battleNonce`
  - `battleTs`
  - `seasonId`
  - `zoneId`
  - `enemyArchetypeId`
  - `zoneProgressDeltaJson`
  - settlement lifecycle status fields

### Linkage

- `BattleRecord` and `BattleOutcomeLedger` are linked by the shared `battleId`.
- The persistence flow must create both records in one DB transaction.

## Execution Flow

1. Validate request payload for `characterId`, `zoneId`, and `seed`.
2. Load the persisted character and the related equipped skills/passives.
3. Verify the character is chain-confirmed:
   - `chainCreationStatus = CONFIRMED`
   - reconciled cursor fields are present
4. Resolve the active season from current configured season policy.
5. Validate zone access using the character’s current world-access model.
6. Resolve the zone’s curated encounter table.
7. Pick the enemy archetype deterministically using weighted RNG derived from the request seed.
8. Build `playerInitial` from DB character data.
9. Build `enemyInitial` from the selected enemy archetype definition.
10. Run the battle engine through `simulateBattle(...)`.
11. Allocate the next `battleNonce` for the character:
    - use the highest local ledger nonce if pending/sealed rows exist
    - otherwise use `lastReconciledEndNonce + 1`
    - perform allocation under a per-character DB lock/advisory lock so concurrent encounters cannot collide
12. Persist:
    - `BattleRecord`
    - `BattleOutcomeLedger`
13. Return the persisted battle metadata plus the battle result payload.

## Settlement Compatibility

- Existing settlement sealing remains oldest-first and contiguous by nonce.
- `encounterHistogram` and settlement batch timestamps continue to be derived from persisted `BattleOutcomeLedger` rows.
- No change is introduced to:
  - canonical `endStateHash` derivation policy
  - canonical `batchHash` derivation policy
  - settlement instruction account-envelope loading
  - settlement prepare/sign/submit flow
  - reconciliation and retry classification
- The only upstream change is that settlement ledger rows now come from real character-driven encounter execution instead of manual or ad hoc inserts.

## API Contracts

### New route

- `POST /api/combat/encounter`

### Request

- `characterId: string`
- `zoneId: number`
- `seed: number`

### Response

- `battleId: string`
- `characterId: string`
- `zoneId: number`
- `enemyArchetypeId: number`
- `battleNonce: number`
- `seasonId: number`
- `battleTs: number`
- `settlementStatus: "PENDING"`
- `battleResult: BattleResult`

### Existing interfaces that remain unchanged

- `CombatantSnapshot`
- `BattleResult`
- `SettlementBatchPayloadV2`
- settlement sealing / relay lifecycle types

## Important Interfaces To Call Out

- Public/backend route addition:
  - `POST /api/combat/encounter`
- New backend types:
  - `EnemyArchetypeDef`
  - `ZoneEncounterTable`
  - `BattleRecord`
- Existing interfaces that remain unchanged:
  - `CombatantSnapshot`
  - `BattleResult`
  - `SettlementBatchPayloadV2`
  - settlement sealing / relay lifecycle types

## Testing Plan

- Enemy selection determinism:
  - weighted deterministic RNG picks the same archetype for the same seed and zone
  - different seeds produce expected deterministic variation
- Character snapshot assembly:
  - DB character state maps correctly into `CombatantSnapshot`
  - equipped skills/passives are preserved
- Nonce allocation:
  - first post-confirmation battle starts at `lastReconciledEndNonce + 1`
  - concurrent requests cannot allocate the same nonce
- Atomic persistence:
  - replay row and ledger row are both created or both rolled back
- Settlement compatibility:
  - persisted ledger rows seal into batches unchanged under the current sealing flow
  - histograms and timestamps match the persisted rows
- Localnet manual flow:
  - create and confirm a real character
  - execute real encounter battles
  - verify DB rows
  - prepare and submit settlement successfully

## Assumptions

- Active season is resolved from the current configured season policy rather than inferred from arbitrary client input.
- Confirmed characters already have reconciled cursor state because character creation submission persists the cursor snapshot during confirmation.
- Replay storage is JSON on `BattleRecord`, not per-event rows.
- World progression remains unresolved in this slice.
- No unlock or clear transitions are introduced in this document.
- All persisted real battles emit `zoneProgressDelta = []` until a separate progression spec is locked.

## Cross-References

- [backend-solana-integration-implementation-plan.md](/home/paps/projects/keep-pushing/docs/backend-solana-integration-implementation-plan.md)
- [local-solana-character-test-runbook.md](/home/paps/projects/keep-pushing/docs/local-solana-character-test-runbook.md)
- [solana-enemy-data-architecture-plan.md](/home/paps/projects/keep-pushing/docs/solana-enemy-data-architecture-plan.md)
- [solana-battle-outcome-validation-mvp-unified-plan.md](/home/paps/projects/keep-pushing/docs/solana-battle-outcome-validation-mvp-unified-plan.md)
