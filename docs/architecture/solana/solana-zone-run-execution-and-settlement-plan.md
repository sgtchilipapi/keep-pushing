# Solana Zone-Run Execution And Run-Native Settlement Plan

## 1) Purpose and status

This document captures the agreed next-phase redesign for real zone mechanics and run-native settlement.

Status:

- design-locked,
- playable core loop now implemented across server execution, local DB persistence, and the app dashboard for manual testing,
- run-native settlement and on-chain validation redesign not implemented yet,
- intended to become the canonical direction for zone traversal and run-native settlement work.

This document now also contains the unified implementation checklist across:

- product/player-facing UX
- backend/API work
- settlement transport rewrite
- on-chain redesign
- migration and test work

Core direction:

- gameplay becomes zone-run based instead of one-request-one-battle,
- nodes and subnodes remain server-authored and server-executed,
- on-chain validation remains bounded-legality and reward-bound focused,
- settlement continuity becomes run-native instead of battle-native,
- batches contain whole closed runs and never split a run.

Authoritative companion docs:

- [SSOT.md](/home/paps/projects/keep-pushing/docs/architecture/SSOT.md)
- [user-flow-spec-gap-analysis.md](/home/paps/projects/keep-pushing/docs/architecture/user-flow-spec-gap-analysis.md)
- [reconciliation-inconsistencies.md](/home/paps/projects/keep-pushing/docs/architecture/reconciliation-inconsistencies.md)
- [deferred-settlement-api-spec.md](/home/paps/projects/keep-pushing/docs/api/deferred-settlement-api-spec.md)

## 1.1) Reconciled MVP decisions

The following reconciliations are locked for the unified MVP plan:

- preserve the **run-native zone-run direction**,
- preserve the **play first, DB persisted first, sync later** first-sync architecture,
- treat anonymous users as **real server-backed users** from first open,
- allow exactly **1 anon character** and up to **3 wallet-linked characters**,
- keep roster slot ownership **server-side**,
- choose `name` and `classId` during local-first character creation,
- mirror `name` and `classId` on-chain when first sync creates the Solana character,
- keep server attestation for settlement,
- replace separate player settlement-permit signing with **player transaction-signer authorization**,
- target **one wallet approval** for first sync and later settlement,
- prefer **client-built or client-finalized, client-submitted** Solana transactions,
- use `/api/zone-runs/*` for canonical gameplay execution,
- allow `/api/runs/:runId` style read/share routes as product-layer result surfaces,
- treat grace as **sync/closure-only**, not as continued normal season gameplay.

## 2) Canonical server run model

A zone run is a durable server-side session.

Canonical rules:

- a character may have at most one active zone run at a time,
- each zone topology version has exactly one explicit start node,
- zone completion occurs by finishing an explicit terminal node,
- graph shape is a forward-only DAG,
- branch merges are allowed,
- branch choices happen only between nodes,
- there are no extra branch gates beyond authored graph connectivity,
- topology visibility is adjacent-only,
- the player sees the current node and legal next branches, not the full future graph.

Node/subnode semantics:

- a node contains an ordered sequence of subnodes,
- each subnode is consumed one at a time,
- each subnode carries its own authored combat-trigger probability,
- combat resolution occurs when the player enters the subnode,
- if the subnode resolves as no-combat, it is still consumed and traversal continues,
- no-combat traversal is persisted in the run action history, not as a battle ledger row.

Canonical mutating run actions:

1. `start run`
   - creates the active run record,
   - binds `zone_id`, `season_id`, `topology_version`, `topology_hash`, and root run seed,
   - positions the run at the start node,
   - returns the initial active-run snapshot,
   - does not consume the first subnode.
2. `choose branch`
   - valid only at node boundaries,
   - validates that the selected outgoing edge is legal from the current node,
   - commits the next node,
   - returns the next pending subnode without consuming it.
3. `advance subnode`
   - consumes exactly one subnode,
   - resolves no-combat or combat inline,
   - if combat occurs, selects the enemy, simulates the battle, persists the combat result, and returns the battle payload plus updated run snapshot.
4. `use pause skill`
   - valid only during post-battle pause,
   - may be repeated multiple times before continue,
   - applies only tagged out-of-combat support/recovery skills,
   - persists as run action history only.
5. `continue after battle`
   - explicitly exits post-battle pause,
   - re-enables traversal.
6. `abandon run`
   - valid at any point,
   - closes the run without zone completion.

Transport requirement:

- every mutating run action must support idempotent retry semantics,
- canonical API retries use an `Idempotency-Key` request header per mutating action,
- the server replays the stored action response for repeated identical request keys,
- every mutating run action returns the full updated active-run snapshot,
- a dedicated active-run read endpoint must exist for reload/resume,
- the broader character read model should expose only a lightweight active-run summary.

## 3) Canonical encounter generation and carryover

Encounter determinism:

- run randomness is derived from `run_seed + stable authored ids/coordinates`,
- authored node and subnode ids must be stable explicit ids, not implicit array positions only,
- a run freezes to the topology version active at run start.

Enemy selection policy:

- combat subnodes use node-local enemy pools,
- enemy appearance caps apply across the whole run, not per node,
- if a rolled archetype is exhausted, the server rerolls within the remaining legal node-local pool,
- if the filtered legal pool becomes empty, the combat-capable subnode degrades into traversal-only and is still consumed.

Between-encounter carryover:

- runs are attrition-based, not independent fresh battles,
- the carryover surface is curated and canonical:
  - HP,
  - cooldowns,
  - tagged statuses,
  - run modifiers,
- initiative resets each encounter,
- every consumed subnode applies one out-of-combat tick after that step resolves,
- post-battle pause does not consume a tick by itself,
- the next consumed subnode does,
- tagged carryover cooldowns tick on those traversal ticks,
- tagged statuses persist between encounters and also consume one traversal tick per consumed subnode.

Post-battle pause:

- every combat resolution enters an explicit post-battle pause,
- the run remains paused until the player sends an explicit continue action,
- the player may use multiple tagged support/recovery skills during one pause before continuing,
- using such a pause skill does not consume traversal,
- consumable item use is explicitly out of scope for this design lock.

## 4) Canonical run endings and gameplay progression

Run terminal conditions:

- successful completion by finishing a legal terminal node,
- failure by losing a combat,
- manual abandon,
- server idle expiry,
- season cutoff.

Season policy:

- a run is bound to the season active at run start,
- it may not continue once that season's playable window closes,
- idle expiry is allowed and is treated like abandon,
- season-cutoff closure is also treated like abandon for settlement semantics.

Progression semantics:

- topology traversal progress never carries into the next run,
- zone progression is success-only,
- only a successfully completed run may clear the zone and unlock the next zone,
- next-zone unlock happens immediately in server gameplay state on successful run completion.

Reward semantics:

- successful run: reward-eligible wins settle, and success-only zone progression settles,
- failed run: prior reward-eligible wins settle, terminal losing combat does not,
- abandoned / expired / season-cutoff run: prior reward-eligible wins settle, but no zone progression settles.

## 5) Canonical persistence model

Server storage must use distinct records for execution, closure, and combat history.

Required durable record families:

1. `ActiveZoneRun`
   - canonical live execution state,
   - current node/subnode position,
   - branch availability,
   - carryover combat snapshot,
   - post-battle pause state,
   - run seed and frozen topology identity.
2. `ClosedZoneRunSummary`
   - created when the run reaches a terminal state,
   - stores terminal status,
   - settleable flag,
   - rewarded combat count,
   - rewarded encounter histogram,
   - success-only zone progress delta.
3. combat ledger rows
   - one row per resolved combat encounter,
   - canonical combat history for replay/audit.
4. run action history
   - no-combat traversal,
   - branch commits,
   - pause-skill usage,
   - continue events,
   - abandon/expiry closure events.

Important persistence rules:

- no-combat traversal must not create combat ledger rows,
- pause-skill actions must not create pseudo-battles,
- terminal losing combats remain in durable history/audit records,
- terminal losing combats are omitted from sealed settlement summaries.

## 6) Canonical settlement unit and continuity redesign

Settlement becomes run-native.

Canonical unit:

- the settlement unit is a closed settleable run, not an individual battle.

A closed run is settleable if:

- it has at least one reward-eligible win, or
- it has a success-only zone progress delta.

Zero-value closed runs:

- do not receive canonical settlement sequence numbers,
- are not sealed into settlement batches,
- remain history/audit only.

Run sequencing:

- canonical continuity uses `closed_run_sequence`,
- a settleable run receives its sequence number at run close,
- on-chain replay/continuity ranges are run-sequence based,
- batch continuity remains batch-id + state-hash + run-sequence-range based.

Batching rules:

- a batch contains a contiguous range of settleable closed runs,
- a batch may mix successful, failed, abandoned, expired, or season-cutoff closed runs,
- a batch must remain single-season,
- batching is oldest-contiguous greedy fit,
- if adding the next whole run would violate a limit, the sealer stops before adding it,
- no run may ever be split across two batches.

## 7) Canonical on-chain account and payload changes

Nodes and subnodes remain off-chain.

On-chain zone metadata changes:

- zone metadata must be versioned by `zone_id + topology_version`,
- enemy-cap rules must follow the same version set as the zone metadata,
- zone metadata must include:
  - total subnode count,
  - topology version,
  - topology hash anchor.

`ZoneEnemySetAccount` replacement/extension:

- the old raw `Vec<u16>` legality shape is no longer sufficient,
- canonical rule-entry shape is:
  - `enemy_archetype_id`,
  - `max_per_run`,
- weights and node-local pools remain server-only.

Run-summary identity:

- canonical sealed run summary identity includes:
  - `zone_id`,
  - `topology_version`,
  - `terminal_status`.

Batch payload direction:

- the canonical batch payload becomes run-summary native,
- the old top-level battle aggregate histogram is replaced by `run_summaries`,
- top-level zone delta is removed,
- zone progression is derived from success-only run summaries during validation/apply.

Required run-summary surface:

- `zone_id: u16`
- `topology_version: u16` (or governance-approved project width)
- `terminal_status: u8`
- `rewarded_battle_count: u16`
- `rewarded_encounter_histogram: Vec<RunEncounterCountEntry>`
- `zone_progress_delta: Option<ZoneProgressDeltaEntry>` for successful runs only

Required batch-scope additions/changes:

- `start_run_sequence`
- `end_run_sequence`
- `run_summaries`
- `max_runs_per_batch` program policy
- batch-wide total histogram-row cap across all run summaries combined

## 8) Canonical on-chain validation rules for the run-native model

The chain continues to validate bounded legality and reward bounds, not exact path truth.

Canonical run-native checks:

1. batch continuity
   - `batch_id` monotonic,
   - `start_run_sequence` and `end_run_sequence` contiguous with the cursor,
   - `start_state_hash` matches the cursor,
   - season and time anchors remain monotonic.
2. batch packing rules
   - batch is single-season,
   - run count does not exceed `max_runs_per_batch`,
   - total histogram rows do not exceed the batch-wide cap.
3. per-run legality
   - referenced zone/version metadata accounts must match the run summary,
   - every rewarded histogram archetype must be legal for that zone/version,
   - each rewarded histogram row count must respect `max_per_run`,
   - `rewarded_battle_count` must equal the run histogram sum,
   - `rewarded_battle_count <= zone.total_subnode_count`.
4. zone progression legality
   - only successful run summaries may carry `zone_progress_delta`,
   - incomplete runs must carry no zone progress delta,
   - zone progress remains monotonic under the same locked -> unlocked -> cleared policy family.
5. reward derivation
   - EXP is derived only from rewarded encounter rows,
   - no server-provided EXP input is accepted,
   - terminal losing combats are not reward inputs because they are not present in sealed run summaries.
6. throughput
   - throughput remains enforced on-chain,
   - throughput counts rewarded combats only under this compact sealed surface.

Intentional non-goals that remain server-only:

- exact node-by-node traversal validation,
- exact subnode-by-subnode traversal validation,
- validation of no-combat traversal volume,
- validation of omitted terminal losing combats.

## 9) API and compatibility direction

Canonical gameplay API direction:

- introduce dedicated zone-run APIs,
- keep the current direct encounter route as a non-canonical sandbox/testing path,
- do not keep both direct encounters and zone runs as equal canonical gameplay modes.

Recommended server API family:

- account/session:
  - `POST /api/auth/anon`
  - `POST /api/auth/wallet/challenge`
  - `POST /api/auth/wallet/verify`
- character/class/season:
  - `GET /api/classes`
  - `GET /api/characters`
  - `POST /api/characters`
  - `GET /api/characters/:characterId`
  - `GET /api/characters/:characterId/sync`
  - `GET /api/seasons/current`
- `POST /api/zone-runs/start`
- `GET /api/zone-runs/active`
- `POST /api/zone-runs/choose-branch`
- `POST /api/zone-runs/advance`
- `POST /api/zone-runs/use-skill`
- `POST /api/zone-runs/continue`
- `POST /api/zone-runs/abandon`
- run result/share:
  - `GET /api/runs/:runId`
  - `POST /api/runs/:runId/share`
- first sync and later settlement:
  - `POST /api/solana/character/first-sync/prepare`
  - `POST /api/solana/character/first-sync/ack`
  - `POST /api/solana/settlement/prepare`
  - `POST /api/solana/settlement/ack`

Compatibility note:

- the current direct encounter route may remain available for dev/test workflows,
- production gameplay and settlement generation should migrate to zone-run-backed execution.
- the old opaque prepared-transaction submit flow is no longer canonical once the reconciled one-approval client-submit flow lands.

## 10) Required implementation invariants

These invariants must hold before implementation is considered complete:

- every active run is resumable from durable server state,
- every mutating run action is idempotent,
- no run is ever split across two settlement batches,
- every settleable run has exactly one canonical closed-run summary,
- zero-value closed runs never enter settlement continuity,
- every successful zone clear can be derived from a successful run summary,
- every reward-bearing settlement batch can be replayed from sealed run summaries plus referenced registries,
- topology truth remains server-side while chain legality remains bounded and deterministic,
- first sync remains atomic from the player's perspective,
- player wallet approval for first sync and later settlement is one-prompt-target behavior,
- grace period is settlement/closure-only for seasonal progression semantics.

## 10.1) Current execution strategy

For the current implementation pass, the priority is **end-to-end playable core loop first, settlement later**.

That means we should first complete enough backend execution, DB persistence, front-end integration, and UX polish to manually test the full zone-run experience in the real app. The goal is to confirm:

- the gameplay flow feels right,
- the run-state transitions are understandable,
- the resume/reload behavior is reliable,
- the post-battle pause and branch-choice UX are workable,
- the progression/unlock loop feels correct,
- the local persistence model supports realistic play sessions.

Only after that manual gameplay/UX confirmation should we proceed into run-native sealing and on-chain settlement work.

Practical implication:

- checklist items that are strictly required to make the core loop playable and testable should be pulled forward,
- checklist items that exist mainly for settlement continuity, batch construction, or on-chain validation should wait until after the core loop is manually validated,
- selected tooling/read-model/docs work may be executed earlier than its checklist phase number if it directly supports manual gameplay testing.

## 11) Ordered implementation checklist

Follow this checklist in order. Do not start a later group until the earlier group is stable enough to serve as a contract for it.

### 11.0 Overview order for execution

Use the checklist in this practical order:

1. Freeze and publish the reconciled account, session, roster, sync, and first-sync transport contracts.

2. Finish the gameplay-core backend contract.
   This means completing the remaining server-side traversal, closure, progression, and closed-run semantics needed for a stable local gameplay loop.

3. Pull forward the front-end/manual-QA enablers.
   This includes any read-model, route-contract, debug-page, dashboard, or operator-doc work needed so a real player can start a run, advance it, branch, pause, continue, abandon, resume, and see the resulting state clearly.

4. Complete gameplay-focused hardening before settlement work.
   Add the remaining tests that validate branching runs, no-combat traversal, reroll/cap exhaustion behavior, carryover behavior, continue/pause flow, and successful-run-only progression.

5. Run real manual end-to-end play sessions.
   Confirm backend behavior, DB persistence, front-end UX, and gameplay pacing together before changing the settlement model further.

6. Only after manual confirmation, resume the settlement path.
   At that point complete settleable/zero-value closed-run classification, then the run-native sealing pipeline, then the on-chain account/payload redesign, then the validator rewrite.

7. Finish the migration/tooling tail last.
   After the run-native settlement architecture is stable, finish surrounding service migrations, bootstrap/admin tooling, validator tooling, and final performance/hardening checks.

Execution grouping for the existing phases:

- Execute Phases 0A through 5 first, including Phase 4A, as the main gameplay-core track.
- Pull forward the gameplay-relevant parts of Phase 9 and Phase 10 as needed to make manual testing possible.
- Defer Phases 6A through 8 until the core loop has been manually validated in the app.
- Finish the remaining Phase 9 and Phase 10 items after the settlement/on-chain model is stable.

### 11.0A Phase 0A: freeze reconciled product and transport contracts

- [x] Freeze the anonymous-server-user + cookie-session model as the canonical entry path.
- [x] Freeze roster limits and slot authority:
  - anon users: exactly 1 character,
  - wallet-linked users: up to 3 characters,
  - slot placement remains server-owned.
- [x] Freeze local-first character creation contract:
  - choose `name` and `classId` immediately,
  - validate unique name at create time,
  - persist playable backend character before chain sync.
- [x] Freeze first-sync character bootstrap contract:
  - first sync creates the on-chain character,
  - first sync mirrors `name` and `classId` on-chain.
- [x] Freeze settlement transport contract:
  - server attestation stays,
  - player auth becomes real transaction signer,
  - separate player settlement-permit message is removed,
  - first sync and later settlement target one wallet approval.
- [x] Freeze grace-period semantics as sync/closure-only for seasonal progression.
- [x] Freeze `/api/zone-runs/*` as the canonical gameplay write surface and `/api/runs/:runId` as the canonical result/share read surface.
- [x] Publish the reconciled companion docs in `keep-pushing`:
  - `/docs/architecture/user-flow-spec-gap-analysis.md`
  - `/docs/architecture/reconciliation-inconsistencies.md`
- [x] Mark the zone-run plan checklist as the single authoritative implementation checklist for this workstream.

### 11.1 Phase 0: freeze contracts and content model

- [x] Confirm this document as the implementation source of truth for the zone-run workstream.
- [x] Define canonical topology authoring types for:
  - zone topology version,
  - node ids,
  - subnode ids,
  - start node,
  - terminal nodes,
  - node-local enemy pools,
  - per-subnode combat trigger probability.
- [ ] Define canonical terminal status enum shared across server and settlement sealing.
- [ ] Define canonical tagged-skill metadata for out-of-combat support/recovery use.
- [x] Define canonical carryover snapshot shape:
  - HP,
  - cooldowns,
  - tagged statuses,
  - run modifiers.

### 11.2 Phase 1: persistence foundations

- [x] Add durable storage for `ActiveZoneRun`.
- [x] Add durable storage for `ClosedZoneRunSummary`.
- [x] Add durable storage for run action history.
- [x] Extend combat ledger persistence so combat rows can be attached to a run.
- [x] Persist frozen run identity on `ActiveZoneRun`:
  - `zone_id`,
  - `season_id`,
  - `topology_version`,
  - `topology_hash`,
  - run seed.
- [x] Persist live execution state on `ActiveZoneRun`:
  - current node,
  - current subnode,
  - branch point state,
  - post-battle pause state,
  - carryover combat snapshot.
- [ ] Persist backend character identity fields needed before first sync:
  - `name`,
  - `class_id`,
  - slot assignment,
  - chain bootstrap readiness state.
- [ ] Persist durable settlement batch records and settlement attempt records for first sync and later settlement retries.
- [ ] Persist unique-name reservation records with expiry/revalidation lifecycle.
- [x] Persist closure state on `ClosedZoneRunSummary`:
  - terminal status,
  - settleable flag,
  - rewarded battle count,
  - rewarded encounter histogram,
  - optional success-only zone progress delta.
- [x] Ensure no-combat traversal and pause-skill actions are stored in run action history only.
- [x] Ensure terminal losing combats remain in audit/combat history but are not copied into the closed-run rewarded summary.

### 11.3 Phase 2: topology loader and deterministic run executor

- [x] Implement topology lookup by `zone_id + topology_version`.
- [x] Implement explicit start-node initialization.
- [x] Implement node-boundary branch validation and commit logic.
- [x] Implement per-subnode traversal consumption.
- [x] Implement deterministic combat-trigger resolution from run seed + stable authored ids.
- [x] Implement deterministic enemy selection from node-local pools.
- [x] Implement run-global archetype cap filtering and reroll behavior.
- [x] Implement empty-filtered-pool fallback to traversal-only.
- [x] Implement terminal-node completion detection.
- [x] Implement failure, abandon, idle-expiry, and season-cutoff closure flows.

### 11.4 Phase 3: carryover and post-battle pause engine

- [x] Implement the curated carryover snapshot serializer/deserializer.
- [x] Implement encounter-to-encounter carryover application.
- [x] Reset initiative per encounter while preserving the approved carryover state.
- [x] Implement one traversal tick per consumed subnode.
- [x] Apply traversal ticks to tagged statuses.
- [x] Apply traversal ticks to tagged carryover cooldowns.
- [x] Implement explicit post-battle pause state after every combat.
- [x] Implement repeated tagged support/recovery skill use during pause.
- [x] Implement explicit continue action to exit pause.
- [x] Reject unsupported consumable item use in the zone-run path.

### 11.5 Phase 4: dedicated API surface and read models

- [ ] Add automatic anon bootstrap and wallet-link auth endpoints.
- [ ] Add session-backed character roster/read APIs.
- [ ] Add class catalog and season summary APIs.
- [x] Add `POST /api/zone-runs/start`.
- [x] Add `GET /api/zone-runs/active`.
- [x] Add `POST /api/zone-runs/choose-branch`.
- [x] Add `POST /api/zone-runs/advance`.
- [x] Add `POST /api/zone-runs/use-skill`.
- [x] Add `POST /api/zone-runs/continue`.
- [x] Add `POST /api/zone-runs/abandon`.
- [x] Make every mutating action idempotent.
- [x] Make every mutating action return the full updated active-run snapshot.
- [x] Add a lightweight active-run summary to the character read model.
- [ ] Add durable run-result read models keyed by `runId`.
- [ ] Add public-by-link share/result pages and per-character sync read models.
- [x] Keep the legacy direct encounter route available as non-canonical sandbox behavior.

### 11.5A Phase 4A: player-facing product surfaces

- [ ] Build the reconciled landing/onboarding experience:
  - silent anon bootstrap,
  - `Try the Game` primary CTA,
  - wallet connect secondary in header/settings,
  - disabled `coming soon` auth options only.
- [ ] Build the reconciled roster surface:
  - anon single-slot behavior,
  - wallet-linked three-slot behavior,
  - compact sync/grace risk indicators.
- [ ] Build the reconciled character creation page:
  - class-card selection,
  - name validation,
  - unique-name failure states,
  - redirect to character page on success.
- [ ] Build the reconciled character page:
  - identity and progression first,
  - season summary,
  - sync summary,
  - `Start Run` strategic CTA.
- [ ] Build the run setup page:
  - unlocked-zone selection,
  - locked-zone teaser cards,
  - season number/name display,
  - countdown to season end or grace end.
- [ ] Build the active run player surface around the canonical zone-run APIs:
  - local previous/current/immediate-next map window only,
  - reload/resume handling,
  - post-battle pause controls.
- [ ] Build the run result and share surfaces:
  - runId-based result page,
  - public-by-link share page,
  - clear `Pending` / `Synced` / `Expired` status copy.
- [ ] Build the dedicated per-character sync page:
  - progression first,
  - sync state second,
  - oldest unresolved batch as primary retry target.
- [ ] Build grace-period urgency states across roster, character page, result page, and sync page.

### 11.6 Phase 5: progression and closure semantics

- [x] Implement success-only zone progression updates on run completion.
- [x] Unlock the next zone immediately in server gameplay state on successful completion.
- [x] Ensure failed, abandoned, expired, and season-cutoff runs never emit zone progress delta.
- [x] Ensure partial topology traversal never carries into the next run.
- [ ] Mark closed runs settleable only when they have:
  - at least one reward-eligible win, or
  - a success-only zone progress delta.
- [ ] Ensure zero-value closed runs remain history/audit only and do not enter settlement continuity.

### 11.6A Phase 6A: first-sync and settlement transport rewrite

- [ ] Preserve the play-first, sync-later first-sync architecture while rewriting the wallet UX.
- [ ] Replace the separate player settlement-permit flow with player transaction-signer authorization.
- [ ] Change first-sync prepare to return structured client-build data instead of an opaque prepared transaction.
- [ ] Change later settlement prepare to return structured client-build data instead of an opaque prepared transaction.
- [ ] Replace first-sync submit with first-sync acknowledgement and reconciliation.
- [ ] Replace later settlement submit with settlement acknowledgement and reconciliation.
- [ ] Keep one sync tap equal to one oldest-contiguous eligible batch.
- [ ] Ensure failed unresolved batches retry as the same batch identity.

### 11.7 Phase 6: run-native sealing pipeline

- [ ] Replace battle-native settlement selection with closed-run-native selection.
- [ ] Allocate `closed_run_sequence` at run close for settleable runs only.
- [ ] Ensure zero-value closed runs receive no settlement sequence.
- [ ] Implement oldest-contiguous greedy-fit batch construction over settleable run sequences.
- [ ] Enforce single-season batches.
- [ ] Enforce no run splitting across batches.
- [ ] Generate sealed run summaries from `ClosedZoneRunSummary` records only.
- [ ] Omit terminal losing combats from sealed rewarded summaries.
- [ ] Remove dependence on top-level batch `zone_progress_delta`.
- [ ] Derive batch progression intent from success-only run summaries.

### 11.8 Phase 7: on-chain account and payload redesign

- [ ] Extend on-chain character creation to include `name` and `class_id` at first sync.
- [ ] Add on-chain class registry accounts keyed by class id with admin-controlled enablement.
- [ ] Add on-chain EXP-to-level derivation as program-constant logic.
- [ ] Version zone metadata accounts by `zone_id + topology_version`.
- [ ] Version zone enemy-rule accounts by `zone_id + topology_version`.
- [ ] Extend zone metadata accounts to include:
  - total subnode count,
  - topology version,
  - topology hash.
- [ ] Replace/extend zone enemy legality storage from raw archetype ids to rule entries:
  - `enemy_archetype_id`,
  - `max_per_run`.
- [ ] Redesign the settlement payload to add:
  - `start_run_sequence`,
  - `end_run_sequence`,
  - `run_summaries`.
- [ ] Remove the old top-level battle aggregate histogram from the canonical run-native payload.
- [ ] Remove the old top-level zone progress delta from the canonical run-native payload.
- [ ] Add `max_runs_per_batch` to program policy/config.
- [ ] Keep a batch-wide total histogram-row cap across all run summaries.

### 11.9 Phase 8: on-chain validator rewrite for run-native settlement

- [ ] Update cursor continuity to use run-sequence ranges.
- [ ] Validate batch-id, run-sequence, state-hash, season, and time continuity.
- [ ] Validate single-season batches.
- [ ] Validate batch run-count cap.
- [ ] Validate batch-wide total histogram-row cap.
- [ ] For every run summary, validate referenced zone/version accounts.
- [ ] For every rewarded histogram row, validate archetype legality for the zone/version.
- [ ] Enforce per-archetype `max_per_run`.
- [ ] Enforce `rewarded_battle_count == rewarded histogram sum`.
- [ ] Enforce `rewarded_battle_count <= zone.total_subnode_count`.
- [ ] Enforce that only successful runs may carry `zone_progress_delta`.
- [ ] Enforce that incomplete runs carry no zone progression delta.
- [ ] Derive EXP only from rewarded encounter rows.
- [ ] Keep throughput validation, counting rewarded combats only.

### 11.10 Phase 9: migration of surrounding services and tooling

- [ ] Update settlement preparation/submit services to use run-native payloads.
- [ ] Update first-sync services to use signer-based one-approval transport.
- [ ] Update local validators/dry-run validators to match the new payload and account model.
- [ ] Update admin/bootstrap tooling for versioned zone metadata and enemy-rule accounts.
- [x] Update read-model builders and dashboards to show active runs and closed-run settlement state.
- [ ] Update remaining operator docs and runbooks to point to the reconciled zone-run path as canonical gameplay.
- [x] Move runana planning docs into `keep-pushing` and keep only one authoritative documentation root.
- [x] Mark older conflicting frontend/backend plans as non-authoritative where they still document pre-reconciliation flows.

### 11.11 Phase 10: test matrix and hardening

- [ ] Add tests for anon bootstrap, wallet-link upgrade, and roster slot semantics.
- [ ] Add tests for local-first character creation with `name` + `classId`.
- [ ] Add tests for successful branching runs with merges.
- [ ] Add tests for no-combat subnode traversal.
- [ ] Add tests for cap exhaustion reroll and empty-filtered-pool traversal fallback.
- [x] Add tests for failure, abandon, idle expiry, and season-cutoff closure.
- [ ] Add tests for carryover HP/cooldowns/statuses/modifiers and per-subnode traversal ticks.
- [ ] Add tests for repeated pause-state support/recovery skills and explicit continue.
- [ ] Add tests for settleable vs zero-value closed-run classification.
- [ ] Add tests for run-sequence allocation and zero-value exclusion.
- [ ] Add tests for mixed terminal statuses inside one batch.
- [ ] Add tests for single-season greedy-fit batch packing.
- [ ] Add tests for illegal zone/version references and illegal archetype caps.
- [ ] Add tests for successful-run-only zone progression.
- [ ] Add tests for throughput counting rewarded combats only.
- [ ] Add tests for first-sync and later settlement one-wallet-approval transport expectations.
- [ ] Benchmark worst-case run-summary batch compute and account envelope size before rollout.
