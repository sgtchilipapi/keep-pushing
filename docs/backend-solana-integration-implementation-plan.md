# Backend Solana Integration Implementation Plan

Status: Locked implementation plan for backend integration against the current `runana-program` codebase.

Current-program-over-doc precedence:
- If future-facing docs disagree with the implemented Anchor program, backend integration follows the current program interface first and records the mismatch explicitly.
- This document is the concrete execution plan derived from repo inspection. It does not replace [backend-spec-plan.md](/home/paps/projects/keep-pushing/docs/backend-spec-plan.md), which remains the original implementation brief.

## Phase 1 — Context Ingestion

### Files inspected

Docs:
- [SSOT.md](/home/paps/projects/keep-pushing/docs/SSOT.md)
- [solana-battle-outcome-validation-mvp-unified-plan.md](/home/paps/projects/keep-pushing/docs/solana-battle-outcome-validation-mvp-unified-plan.md)
- [solana-playable-character-data-architecture-plan.md](/home/paps/projects/keep-pushing/docs/solana-playable-character-data-architecture-plan.md)
- [solana-enemy-data-architecture-plan.md](/home/paps/projects/keep-pushing/docs/solana-enemy-data-architecture-plan.md)
- [backend-spec-plan.md](/home/paps/projects/keep-pushing/docs/backend-spec-plan.md)

On-chain program and harness:
- [lib.rs](/home/paps/projects/runana-program/programs/runana-program/src/lib.rs)
- [qs.md](/home/paps/projects/runana-program/programs/runana-program/src/qs.md)
- [fixtures.rs](/home/paps/projects/runana-program/tests/src/fixtures.rs)
- [integration_helpers.rs](/home/paps/projects/runana-program/tests/src/integration_helpers.rs)
- [test_slice3_time_season_and_throughput.rs](/home/paps/projects/runana-program/tests/src/test_slice3_time_season_and_throughput.rs)
- [test_slice6_mixed_registry_batching.rs](/home/paps/projects/runana-program/tests/src/test_slice6_mixed_registry_batching.rs)

Backend/server:
- [types/settlement.ts](/home/paps/projects/keep-pushing/types/settlement.ts)
- [types/api/solana.ts](/home/paps/projects/keep-pushing/types/api/solana.ts)
- [playerOwnedTransactions.ts](/home/paps/projects/keep-pushing/lib/solana/playerOwnedTransactions.ts)
- [settlementBatchValidation.ts](/home/paps/projects/keep-pushing/lib/solana/settlementBatchValidation.ts)
- [schema.prisma](/home/paps/projects/keep-pushing/prisma/schema.prisma)
- [prisma.ts](/home/paps/projects/keep-pushing/lib/prisma.ts)
- [app/api/combat/route.ts](/home/paps/projects/keep-pushing/app/api/combat/route.ts)
- [app/api/character/create/route.ts](/home/paps/projects/keep-pushing/app/api/character/create/route.ts)
- [app/api/character/route.ts](/home/paps/projects/keep-pushing/app/api/character/route.ts)
- [app/api/character/equip/route.ts](/home/paps/projects/keep-pushing/app/api/character/equip/route.ts)

### On-chain summary from the server’s perspective

- The settlement instruction the backend must target is `ApplyBattleSettlementBatchV1` in [lib.rs](/home/paps/projects/runana-program/programs/runana-program/src/lib.rs).
- Player-owned account initialization already exists on chain:
  - `create_character`
  - `initialize_character_zone_progress_page`
- Admin/bootstrap instructions already exist on chain:
  - `initialize_program_config`
  - `initialize_season_policy`
  - `initialize_zone_registry`
  - `initialize_zone_enemy_set`
  - `update_zone_enemy_set`
  - `initialize_enemy_archetype_registry`
- Settlement currently validates:
  - canonical PDAs and character/account bindings
  - two ed25519 verification instructions in strict order
  - payload `batch_hash`
  - nonce continuity, state-hash continuity, and batch-id continuity
  - season/grace/timestamp/throughput rules
  - zone progression legality
  - zone-enemy legality
  - deterministic EXP derivation from registry accounts
- Settlement currently mutates:
  - `CharacterStatsAccount.total_exp`
  - `CharacterWorldProgressAccount`
  - referenced `CharacterZoneProgressPageAccount` pages
  - `CharacterSettlementBatchCursorAccount`
- Settlement does not currently:
  - derive `end_state_hash` on chain
  - write a receipt account
  - enforce `optional_loadout_revision`
  - manage broader future character domains such as inventory or learning state

### Current off-chain settlement flow

- There is no real backend settlement pipeline yet.
- The only live battle path is the simulation route in [app/api/combat/route.ts](/home/paps/projects/keep-pushing/app/api/combat/route.ts), which simulates from request snapshots and returns battle results.
- Character persistence is currently local Postgres state only in [schema.prisma](/home/paps/projects/keep-pushing/prisma/schema.prisma) and [prisma.ts](/home/paps/projects/keep-pushing/lib/prisma.ts).
- [playerOwnedTransactions.ts](/home/paps/projects/keep-pushing/lib/solana/playerOwnedTransactions.ts) only wraps opaque base64 messages and enforces a few continuity checks. It does not build real Solana instructions or transactions.
- [settlementBatchValidation.ts](/home/paps/projects/keep-pushing/lib/solana/settlementBatchValidation.ts) is a stale TypeScript approximation of older settlement semantics, not a mirror of the finished program.

### Explicit mismatches, unknowns, and integration gaps

#### Mismatches
- Signer policy mismatch:
  - docs often speak in terms of `trusted_server_signers`
  - current program stores a single `trusted_server_signer`
- Cluster mismatch:
  - docs define a broader signed-domain cluster enum
  - current program hardcodes `CLUSTER_ID_LOCALNET = 1`, so signed-domain support is effectively localnet-only right now
- Payload mismatch:
  - backend TS settlement payload still includes legacy `expDelta`, `attestationSlot`, and `attestationExpirySlot`
  - current program payload requires timestamps, season id, schema version, and derives EXP on chain
- Cursor mismatch:
  - backend TS cursor omits `lastCommittedBattleTs` and `lastCommittedSeasonId`
  - current program requires both
- Scope mismatch:
  - future-facing architecture docs describe richer character/loadout/receipt domains
  - current implemented settlement account set is narrower and must be treated as the actual contract

#### Unknowns
- No canonical production derivation for `end_state_hash` exists in current program code or locked docs. The program persists it and chains from it, but does not derive it independently.

#### Integration gaps
- No chain identity mapping from backend character records to on-chain `character_id:[u8;16]`, `authority`, and `character_root` PDA
- No persistent battle ledger for deterministic oldest-first batch sealing
- No settlement batch persistence
- No submission attempt persistence
- No real Solana client, PDA derivation layer, or account read layer in the backend
- No real transaction builder for character creation or settlement
- No broadcast, confirmation, retry, or reconciliation pipeline
- No startup recovery flow for interrupted settlement lifecycle

## Phase 2 — Integration Contract

### Program interaction model

#### Admin/bootstrap flow
- Backend will provide server-only bootstrap helpers for:
  - `initialize_program_config`
  - `initialize_season_policy`
  - `initialize_zone_registry`
  - `initialize_zone_enemy_set`
  - `update_zone_enemy_set`
  - `initialize_enemy_archetype_registry`
- These are not public player routes. They should live as scripts or admin-only operational helpers.

#### Character creation flow
- Backend prepares a player-owned `create_character` transaction.
- Preconditions:
  - player authority wallet is known
  - canonical on-chain `character_id:[u8;16]` has been generated and persisted
  - initial unlocked zone id is known
  - season id at creation is known
  - required bootstrap accounts already exist
- If later pages are needed, backend prepares a separate player-owned `initialize_character_zone_progress_page` transaction.

#### Settlement flow
- Backend invokes only `ApplyBattleSettlementBatchV1`.
- Execution order:
  - fetch live chain cursor and required accounts
  - seal or load the next oldest uncommitted batch
  - validate the batch against live chain state
  - build canonical payload
  - compute canonical `end_state_hash`
  - compute canonical `batch_hash`
  - build server attestation bytes
  - build player authorization bytes
  - assemble transaction with ed25519 server instruction first and ed25519 player instruction second
  - collect player signature over unchanged transaction bytes
  - broadcast
  - confirm
  - reconcile local settlement state against chain
- Preconditions:
  - character exists on chain
  - required season and registry accounts exist
  - referenced zone pages exist
  - batch is the next strict oldest uncommitted batch
  - local preflight validation passes

### Account model

#### Required before first settlement
- `ProgramConfigAccount`
- `SeasonPolicyAccount(season_id)`
- `ZoneRegistryAccount(zone_id)` for referenced zones
- `ZoneEnemySetAccount(zone_id)` for referenced zones
- `EnemyArchetypeRegistryAccount(enemy_archetype_id)` for referenced enemies
- `CharacterRootAccount`
- `CharacterStatsAccount`
- `CharacterWorldProgressAccount`
- initial `CharacterZoneProgressPageAccount`
- `CharacterSettlementBatchCursorAccount`

#### Created at character creation
- `CharacterRootAccount`
- `CharacterStatsAccount`
- `CharacterWorldProgressAccount`
- initial `CharacterZoneProgressPageAccount`
- `CharacterSettlementBatchCursorAccount`

#### Created later on demand
- additional `CharacterZoneProgressPageAccount(page_index)`

#### PDAs the backend must derive
- `program_config`
- `character(authority, character_id)`
- `character_stats(character_root)`
- `character_world_progress(character_root)`
- `character_zone_progress(character_root, page_index)`
- `character_batch_cursor(character_root)`
- `season_policy(season_id)`
- `zone_registry(zone_id)`
- `zone_enemy_set(zone_id)`
- `enemy_archetype(enemy_archetype_id)`

#### Mutable accounts during settlement
- `character_stats`
- `character_world_progress`
- primary `character_zone_progress_page`
- additional referenced zone progress pages
- `character_settlement_batch_cursor`

#### Read-only accounts during settlement
- `player_authority`
- `instructions_sysvar`
- `program_config`
- `character_root`
- `season_policy`
- referenced `zone_registry` accounts
- referenced `zone_enemy_set` accounts
- referenced `enemy_archetype` accounts

### Data mapping

#### Server-computed fields
- `batch_id`
- `start_nonce`
- `end_nonce`
- `battle_count`
- `first_battle_ts`
- `last_battle_ts`
- `season_id`
- `zone_progress_delta`
- `encounter_histogram`
- `start_state_hash`
- `end_state_hash`
- `batch_hash`
- `schema_version = 2`
- `signature_scheme = 0`

#### Chain-read-only fields
- current cursor values
- character authority binding
- program config limits and trusted signer
- season policy timing
- zone registry multipliers
- zone-enemy legality sets
- enemy EXP registry values
- existing zone page states

#### Canonical backend `end_state_hash` rule
- This plan freezes a backend-side canonical chaining rule because current program code does not derive `end_state_hash` itself.
- Rule:
  - `end_state_hash = sha256(canonical_end_state_preimage)`
- Canonical preimage field order:
  - `character_id`
  - `batch_id`
  - `start_nonce`
  - `end_nonce`
  - `battle_count`
  - `first_battle_ts`
  - `last_battle_ts`
  - `season_id`
  - `start_state_hash`
  - `zone_progress_delta`
  - `encounter_histogram`
  - `optional_loadout_revision`
  - `schema_version`
  - `signature_scheme`
- Encoding policy:
  - strict field-order canonical bytes
  - same integer widths and byte ordering conventions as the current program payload serialization
- Explicit note:
  - this is a backend-side canonical rule required for deterministic batch sealing
  - the current on-chain program persists `end_state_hash` and chains from it, but does not independently derive it

### Trust boundary

#### Server is trusted to
- simulate battles
- assign deterministic battle nonces
- seal contiguous batches
- compute timestamps, histogram, zone deltas, and chained state hashes
- sign trusted server attestation messages

#### Chain validates
- account derivation and binding
- trusted server signer match
- player authorization match
- batch hash equality
- continuity rules
- season/grace/throughput rules
- zone and enemy legality
- deterministic EXP derivation

#### Server must locally validate before submission
- next-cursor continuity against live chain cursor
- season/grace eligibility
- throughput bound
- histogram normalization and battle-count match
- required registry and page account existence
- canonical remaining-account order
- player permit domain equality
- signed message bytes unchanged after signing

### Settlement lifecycle
- Provisional progress:
  - battles are persisted locally but not chain-committed
- Batch finalization:
  - backend seals the next oldest contiguous uncommitted range
- Transaction preparation:
  - backend loads chain state, validates the batch, and returns player-signable bytes plus relay metadata
- Submission:
  - player signs unchanged bytes
  - backend accepts signed bytes and broadcasts
- Confirmation:
  - backend waits for confirmation and fetches post-state
- Success reconciliation:
  - mark batch confirmed
  - mark covered battle range committed
  - persist updated cursor snapshot
- Failure reconciliation:
  - classify transport, preflight, or on-chain validation failure
  - keep newer batches blocked when the oldest unresolved batch is not settled
- Retry policy:
  - safe same-payload retry only for transport or broadcast uncertainty
  - rebuild-and-retry for payload/account/signature construction defects
  - no unchanged retry for grace expiry or deterministic invalidity

### Idempotency model
- Unique local settlement identity:
  - one batch per character per `batch_id`
  - one batch per character per `start_nonce`
  - one reconciliation key per `character_id + batch_id + batch_hash`
- Replay protection:
  - chain continuity rules reject replayed and out-of-order batches
  - backend must prevent duplicate local submission for already-confirmed batches
- Crash/restart behavior:
  - on startup, scan batches in unresolved states
  - check stored transaction signatures against chain
  - compare live cursor against expected batch commit point
  - mark confirmed if already committed
  - otherwise return batch to retryable or invalid state based on evidence

## Phase 3 — Gap Analysis

### Required data model changes
- Critical: add chain identity fields to local character records
  - Why: current character rows only represent local RPG state
  - Exact change: persist player authority pubkey, on-chain `character_id:[u8;16]`, character root PDA, creation timestamp, creation season id, and chain creation status
  - Where: Prisma schema and character repository/service layer
- Critical: add `SettlementBatch` persistence
  - Why: no sealed payload, lifecycle, or replay metadata exists
  - Exact change: persist canonical payload fields, hashes, state-hash chain, status, support-code bucket, tx signature, and timestamps
  - Where: Prisma schema and settlement repository
- High: add `SettlementSubmissionAttempt` persistence
  - Why: retries and restart recovery need attempt-level evidence
  - Exact change: store attempt number, signed tx hash, tx signature, status, rpc error, and timestamps
  - Where: Prisma schema and settlement repository

### Required persistence changes
- Critical: add persistent battle outcome ledger
  - Why: current backend has no durable source for deterministic oldest-first settlement batching
  - Exact change: persist per-character battle records with nonce, battle timestamp, zone id, enemy archetype id, and progression effects needed for histogram/delta construction
  - Where: Prisma schema and combat persistence layer
- High: add live cursor snapshot persistence
  - Why: startup recovery and preflight should not rely on stale in-memory expectations
  - Exact change: persist last reconciled cursor fields from chain
  - Where: Prisma schema and chain-state repository

### Required service and module changes
- Critical: replace stale settlement contract and validator logic
  - Why: current TS settlement types reflect removed legacy behavior
  - Exact change: rewrite `types/settlement.ts` and convert `settlementBatchValidation.ts` into a current-program dry-run validator
  - Where: `types/settlement.ts`, `lib/solana/settlementBatchValidation.ts`
- Critical: add real Solana backend modules
  - Why: backend currently lacks actual program integration layers
  - Exact change: add isolated modules for PDAs, account reads, canonical serialization, state-hash derivation, instruction building, transaction assembly, submission, and reconciliation
  - Where: `lib/solana/*`
- Critical: add settlement orchestration service
  - Why: nothing currently seals, validates, prepares, broadcasts, and reconciles batches
  - Exact change: implement a coordinator over battle ledger, chain reads, tx builder, and persistence
  - Where: `lib/solana/settlement/*`

### Required transaction-building changes
- Critical: build real player-owned transactions
  - Why: current helper only wraps opaque base64 message blobs
  - Exact change: create actual create-character and settlement instructions, add dual ed25519 preinstructions, assemble v0 transactions, and include canonical remaining accounts
  - Where: `lib/solana/playerOwnedTransactions.ts` plus new builder modules
- High: add canonical payload and signature-domain utilities
  - Why: hashes and messages must exactly match the program
  - Exact change: centralize `batch_hash`, `end_state_hash`, server attestation bytes, and player permit bytes
  - Where: `lib/solana/canonicalSettlement.ts`

### Required signing and auth changes
- Critical: add trusted server signing integration
  - Why: backend does not currently produce real server attestations
  - Exact change: load server signer from config and sign settlement attestation messages
  - Where: solana config module and signing helper
- High: bind player wallet authority to chain-enabled characters
  - Why: on-chain authority is not the same thing as local `userId`
  - Exact change: persist and validate player authority pubkey per chain-enabled character
  - Where: character service/API layer and Prisma schema

### Required queue and job changes
- Critical: add settlement recovery and retry worker
  - Why: no submission queue or reconciliation job exists
  - Exact change: startup recovery scan plus unresolved-settlement reconciliation loop
  - Where: server startup integration or explicit background job module
- Medium: add deterministic batch sealing entrypoint
  - Why: batch construction should not live inside request handlers
  - Exact change: add a callable service to seal the next oldest batch
  - Where: settlement orchestration service

### Required API changes
- Critical: add player-owned character creation prepare and submit routes
  - Why: current character creation route only writes Postgres state
  - Exact change: expose prepare and submit endpoints for on-chain character creation
  - Where: new Solana route handlers
- Critical: add settlement prepare and submit routes
  - Why: no player-facing settlement route exists
  - Exact change: expose prepare and submit endpoints for the next settlement batch
  - Where: new Solana route handlers
- Medium: add admin/bootstrap helpers as scripts, not public routes
  - Why: repo has no admin auth surface yet
  - Exact change: add operational scripts for seeding config, season, zones, and enemies
  - Where: `scripts/solana/*`

### Required observability and logging changes
- High: add structured settlement logs
  - Why: docs freeze support-code and operator-triage expectations
  - Exact change: log character id, root pubkey, batch id, batch hash, tx signature, support code, and retry disposition at each lifecycle stage
  - Where: settlement orchestration and submission modules
- Medium: persist failure diagnostics
  - Why: support and retry logic need concrete evidence
  - Exact change: store rpc errors, decoded failure bucket, and timestamps on batches and attempts
  - Where: settlement repository

### Required tests
- Critical: replace stale settlement unit tests
  - Why: current tests cover removed payload fields and behaviors
  - Exact change: update tests to current timestamp/season/throughput/state-hash semantics
  - Where: `tests/*` in `keep-pushing`
- High: add localnet integration coverage
  - Why: backend must prove real byte-for-byte transaction assembly against the current program
  - Exact change: add env-gated localnet tests for bootstrap, character creation, and settlement
  - Where: dedicated backend integration test suite

## Phase 4 — Implementation Plan

### Step 1 — Freeze canonical backend settlement contracts
- Status:
  - complete
- Objective:
  - replace legacy TS settlement contracts with current-program-aligned contracts
- Files/modules affected:
  - `types/settlement.ts`
  - `types/api/solana.ts`
  - new canonical settlement utility module
- Exact deliverable:
  - V2 payload types
  - cursor types with time and season anchors
  - canonical hash and message builders
  - documented backend `end_state_hash` rule
- Dependencies:
  - none beyond this plan
- Acceptance criteria:
  - no active settlement types depend on `expDelta` or expiry-slot freshness
  - backend contracts match the current Anchor payload shape

### Step 2 — Add persistence foundations
- Status:
  - complete
- Objective:
  - add schema support for chain identity, battle ledger, settlement batches, and attempts
- Files/modules affected:
  - Prisma schema
  - migration
  - persistence helpers
- Exact deliverable:
  - chain-enabled character fields
  - battle outcome ledger
  - `SettlementBatch`
  - `SettlementSubmissionAttempt`
- Dependencies:
  - Step 1
- Acceptance criteria:
  - backend can persist a chain-enabled character and a sealed batch lifecycle without in-memory state

### Step 3 — Add chain read and PDA derivation layer
- Status:
  - complete
- Objective:
  - make the backend able to derive required addresses and load live program state
- Files/modules affected:
  - `lib/solana/*`
- Exact deliverable:
  - PDA derivation utilities
  - account fetch and parse helpers
  - cursor, season, registry, and zone-page loaders
- Dependencies:
  - Step 1
- Acceptance criteria:
  - backend can reconstruct the exact settlement account envelope before tx build

### Step 4 — Add admin/bootstrap seeding helpers
- Status:
  - complete
- Objective:
  - operationalize required non-player setup
- Files/modules affected:
  - `scripts/solana/*`
  - solana config/client modules
- Exact deliverable:
  - scripts for program config, season policy, zone registry, zone-enemy set, and enemy archetype setup
- Dependencies:
  - Step 3
- Acceptance criteria:
  - localnet bootstrap can be performed from repository helpers without manual instruction crafting

### Step 5 — Add real player-owned character creation flow
- Status:
  - complete
- Objective:
  - connect local character creation to on-chain character creation
- Files/modules affected:
  - transaction builder modules
  - character service and API routes
- Exact deliverable:
  - prepare/create-character flow
  - accept signed transaction flow
  - broadcast and confirmation flow
  - local-to-chain identity persistence
- Dependencies:
  - Steps 2 and 3
- Acceptance criteria:
  - backend can create a local character record plus prepare and relay the matching on-chain create-character transaction

### Step 6 — Add deterministic batch sealing and dry-run validation
- Status:
  - complete
- Objective:
  - seal valid canonical batches before player signing
- Files/modules affected:
  - battle persistence
  - settlement sealing service
  - dry-run validator
- Exact deliverable:
  - oldest-first batch sealing
  - canonical histogram and zone delta generation
  - canonical `end_state_hash`
  - preflight validation against live chain state
- Dependencies:
  - Steps 1, 2, and 3
- Acceptance criteria:
  - backend can reject invalid batches before building transactions

### Step 7 — Add real settlement transaction assembly
- Status:
  - complete
- Objective:
  - build actual settlement transactions compatible with the current program
- Files/modules affected:
  - canonical settlement utilities
  - instruction builder
  - player-owned transaction builder
- Exact deliverable:
  - `ApplyBattleSettlementBatchV1` transaction builder
  - dual ed25519 preinstruction insertion
  - canonical remaining-account ordering
  - localnet v0 message assembly
- Dependencies:
  - Steps 3 and 6
- Acceptance criteria:
  - backend prepares settlement transaction bytes that match the current program contract and harness behavior

### Step 8 — Add submission lifecycle, reconciliation, and recovery
- Status:
  - complete
- Objective:
  - make settlement robust to retries and restarts
- Files/modules affected:
  - settlement orchestration service
  - submission module
  - recovery worker
- Exact deliverable:
  - submitted, confirmed, failed, and retryable states
  - cursor-based reconciliation
  - startup recovery for unresolved batches
- Dependencies:
  - Steps 2, 6, and 7
- Acceptance criteria:
  - backend can recover interrupted settlement attempts without double-committing or skipping older backlog

### Step 9 — Add minimal API surface
- Objective:
  - expose only the player flows needed for create and settlement relay
- Files/modules affected:
  - new Solana API route handlers
- Exact deliverable:
  - prepare/create-character
  - submit/create-character
  - prepare/settlement
  - submit/settlement
- Dependencies:
  - Steps 5, 7, and 8
- Acceptance criteria:
  - player flows work through API endpoints while admin/bootstrap remains script-based

### Step 10 — Add verification coverage
- Objective:
  - verify deterministic backend behavior and real-program compatibility
- Files/modules affected:
  - backend unit tests
  - optional integration tests
- Exact deliverable:
  - unit tests for hashes, PDAs, ordering, batch sealing, duplicate protection, failure handling, and recovery
  - env-gated localnet tests for bootstrap, character creation, and settlement
- Dependencies:
  - all prior steps
- Acceptance criteria:
  - unit coverage passes by default
  - localnet integration coverage passes when the integration environment is available

## Assumptions And Locked Defaults

- This doc is the concrete backend implementation plan. The original brief in [backend-spec-plan.md](/home/paps/projects/keep-pushing/docs/backend-spec-plan.md) remains unchanged.
- Scope is locked to:
  - settlement integration
  - player-owned character creation integration
  - admin/bootstrap seeding helpers
- Backend integration follows the current implemented Anchor program over older or broader docs when they diverge.
- `trusted_server_signer` is treated as a single active trusted signer because that is what the current program stores.
- Signed-domain cluster handling is initially localnet-only because the current program hardcodes `CLUSTER_ID_LOCALNET = 1`.
- `optional_loadout_revision` remains metadata-only.
- `BattleSettlementBatchReceiptAccount` remains out of scope until the on-chain program implements it.
- `end_state_hash` is frozen here as a backend-side canonical chaining rule because current program code does not define a production derivation for it.
