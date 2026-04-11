# Frontend Battle And Sync UX Spec

Status:

- historical frontend plan for the pre-reconciliation battle/sync contract
- useful for implementation history and UI context
- not the authoritative MVP contract anymore

Canonical current references:

- [user-flow-spec-gap-analysis.md](/home/paps/projects/keep-pushing/docs/architecture/user-flow-spec-gap-analysis.md)
- [deferred-settlement-api-spec.md](/home/paps/projects/keep-pushing/docs/api/deferred-settlement-api-spec.md)
- [solana-zone-run-execution-and-settlement-plan.md](/home/paps/projects/keep-pushing/docs/architecture/solana/solana-zone-run-execution-and-settlement-plan.md)

## Purpose

This document defines the frontend product shape for the current local-first battle flow.
It is project-specific and aligned to the implemented backend contract in
`docs/api/deferred-settlement-api-spec.md`.

The frontend must let a player:

1. bootstrap a backend user
2. create a local-first character
3. run battles immediately without requiring on-chain creation first
4. understand whether battle results are only local, awaiting first sync, syncing, failed, or confirmed
5. connect a wallet and complete first sync when ready
6. continue normal post-sync settlement afterward

This is a systems UI, not a marketing site. The interface should optimize for:

- fast scanning
- clear state visibility
- compact density
- strong action hierarchy
- mobile-first use

## Product Model

The frontend is built around one main gameplay object: the current player character.

That character moves through these major product states:

| Stage | Meaning | Frontend Priority |
| --- | --- | --- |
| No user | No backend identity exists yet | create user silently or with one clear CTA |
| No character | Backend user exists but has no character | create character |
| Local-first ready | Character exists only in backend storage | battle immediately |
| Local backlog | One or more battles exist with `AWAITING_FIRST_SYNC` or `SEALED` status | keep battling or sync to chain |
| First sync pending | First-sync transaction is being authorized, signed, submitted, or retried | keep sync state highly visible |
| Chain confirmed | Character exists on chain | continue battling and settle normally |

The frontend must not hide these transitions. Chain state is part of the core product, not an advanced detail.

## Primary User Flow

### 1. Bootstrap User

API:

- `POST /api/auth/anon`

Outcome:

- frontend stores `userId`

### 2. Load Character Read Model

API:

- `GET /api/character?userId=<userId>`

Outcome:

- if `character = null`, show character creation
- if `character` exists, render the gameplay dashboard using the read model

### 3. Create Local Character

API:

- `POST /api/character/create`

Outcome:

- character enters local-first state
- provisional zone progress exists
- chain status starts at `NOT_STARTED`

### 4. Simulate Battle

API:

- `POST /api/combat/encounter`

Outcome:

- battle replay is returned immediately
- latest battle state updates
- settlement status becomes:
  - `AWAITING_FIRST_SYNC` before chain creation
  - `PENDING` after chain confirmation

### 5. First Sync To Chain

APIs:

- `POST /api/solana/character/first-sync/prepare`
- `POST /api/solana/character/first-sync/submit`

Outcome:

- user signs authorization message
- user signs atomic transaction
- backend submits transaction
- chain state becomes `CONFIRMED` on success

### 6. Ongoing Settlement After First Sync

APIs:

- `POST /api/solana/settlement/prepare`
- `POST /api/solana/settlement/submit`

Outcome:

- post-sync battles are settled through the normal pipeline

## Route And Screen Map

The frontend can stay small initially. It does not need many routes, but each screen must be state-rich.

### `app/page.tsx`

Role:

- entry point and primary game shell

Responsibilities:

- bootstrap anonymous user if needed
- fetch the current character read model
- route the player into one of the top-level screen states

Top-level render states:

- no user bootstrap yet
- user exists but no character
- character dashboard
- fatal load error

### Character Creation Screen

Purpose:

- create the first playable character with minimal friction

Primary CTA:

- `Create Character`

Required data:

- `userId`

Required states:

- idle
- submitting
- validation error
- request failure

### Character Dashboard Screen

Purpose:

- home screen for the player’s current character
- central place for progression, battle, and chain sync state

Primary CTA:

- changes by state:
  - `Battle` when the character is local-first ready
  - `Sync to Chain` when deferred backlog exists
  - `Settle Pending Batch` when chain-confirmed settlement is pending

Required regions:

1. character header
2. chain and sync status
3. provisional or canonical progression summary
4. latest battle summary
5. primary action area
6. secondary action area

### Battle Result Surface

Purpose:

- show the latest encounter outcome without leaving the main gameplay loop

It can be:

- an inline section on the dashboard
- a drawer
- or a dedicated mobile-first subview

It must show:

- winner
- enemy name/id
- rounds played
- settlement status
- generated seed
- replay-oriented summary data

### First Sync Flow Surface

Purpose:

- guide the player through wallet-dependent first sync without ambiguity

This may be:

- a modal flow
- or a dedicated panel/route

It must separate these steps clearly:

1. connect wallet
2. authorize batch
3. sign transaction
4. submit
5. confirm or fail

### Post-Sync Settlement Surface

Purpose:

- handle later settlement batches after the character already exists on chain

It should reuse the same visual language as first sync, but must be clearly labeled as
`Settlement`, not `Character Creation`.

## Screen Contracts

### Character Creation Screen Contract

| Item | Requirement |
| --- | --- |
| Page purpose | Create the player’s first backend character |
| Primary action | `Create Character` |
| Secondary actions | rename input, retry on failure |
| Critical data | `userId` |
| Above-the-fold mobile content | title, short explanation, name input, primary CTA |
| Subordinate content | optional helper copy |

### Character Dashboard Screen Contract

| Item | Requirement |
| --- | --- |
| Page purpose | Operate the current character across local play and chain sync |
| Primary action | State-driven: `Battle`, `Sync to Chain`, or `Settle Pending Batch` |
| Secondary actions | change zone, reconnect wallet, retry failed sync, inspect latest battle |
| Critical data | character read model from `GET /api/character` |
| Above-the-fold mobile content | character summary, chain status, latest actionable CTA |
| Subordinate content | verbose lore copy, low-priority metadata |

### First Sync Flow Contract

| Item | Requirement |
| --- | --- |
| Page purpose | Convert local backlog into the first on-chain character + settlement batch |
| Primary action | progress to next signing/submission step |
| Secondary actions | cancel, retry, reconnect wallet |
| Critical data | read model plus first-sync prepare responses |
| Above-the-fold mobile content | current step, required action, clear wallet instruction |
| Subordinate content | raw hashes, expanded payload diagnostics |

## Data Dependencies

### Core Read Model

Source:

- `GET /api/character?userId=<userId>`

Frontend uses:

- `characterId`
- `name`, `level`, `exp`, `stats`
- `chain.chainCreationStatus`
- `chain.chainCharacterIdHex`
- `chain.characterRootPubkey`
- `chain.cursor`
- `provisionalProgress`
- `latestBattle`
- `nextSettlementBatch`

This route should be treated as the page-level source of truth after any mutation completes.

### Battle Mutation

Source:

- `POST /api/combat/encounter`

Frontend uses:

- `battleId`
- `enemyArchetypeId`
- `seed`
- `battleNonce`
- `battleTs`
- `settlementStatus`
- `battleResult`

### First Sync Prepare

Source:

- `POST /api/solana/character/first-sync/prepare`

Phase 1 fields used by the client:

- `phase`
- `payload`
- `expectedCursor`
- `permitDomain`
- `playerAuthorizationMessageBase64`

Phase 2 fields used by the client:

- `serverAttestationMessageBase64`
- `preparedTransaction`

### First Sync Submit

Source:

- `POST /api/solana/character/first-sync/submit`

Frontend uses:

- `chainCreationStatus`
- `transactionSignature`
- `chainCharacterIdHex`
- `characterRootPubkey`
- `firstSettlementBatchId`
- `remainingSettlementBatchIds`
- `cursor`

## Frontend State Model

### App-Level States

| State | Trigger | UI Meaning |
| --- | --- | --- |
| `bootstrapping_user` | no `userId` available yet | hold on a lightweight loading shell |
| `loading_character` | fetching `GET /api/character` | show skeleton dashboard or creation skeleton |
| `no_character` | `character = null` | show character creation |
| `ready` | character exists | show dashboard |
| `fatal_error` | bootstrap/read unrecoverable error | show retry-focused error state |

### Character Sync States

| `chain.chainCreationStatus` | Meaning | Primary CTA |
| --- | --- | --- |
| `NOT_STARTED` | local-only character | `Battle` or `Sync to Chain` if backlog exists |
| `PENDING` | first-sync identity reserved/prepared | `Continue Sync` |
| `SUBMITTED` | transaction broadcast, awaiting confirmation | disabled pending state |
| `CONFIRMED` | chain-enabled character | `Battle` or `Settle Pending Batch` |
| `FAILED` | first sync failed | `Retry Sync` |

### Battle/Settlement Visibility States

| Condition | What the UI should show |
| --- | --- |
| no latest battle | neutral empty battle panel |
| `latestBattle.settlementStatus = AWAITING_FIRST_SYNC` | local battle stored, ready for first sync |
| `latestBattle.settlementStatus = SEALED` | battle already assigned to a first-sync or settlement batch |
| `latestBattle.settlementStatus = PENDING` | battle exists and awaits normal settlement |
| `latestBattle.settlementStatus = COMMITTED` | battle is finalized on chain |
| `nextSettlementBatch.status = FAILED` | retry-focused settlement warning |

## Interaction Rules

### General

- never present more than one primary CTA at a time
- if wallet input is required, the CTA label must say so
- disable actions during in-flight mutation unless a safe parallel action exists
- after any successful mutation, revalidate the character read model

### Battle Action

- requires a valid `characterId`
- zone selection must not hide the action button on mobile
- do not let the player edit or provide the battle seed
- during battle submission, disable repeated clicks and show pending text

### First Sync Action

- show first sync only when local backlog exists or sync status is retryable
- if wallet is disconnected, the primary CTA becomes `Connect Wallet`
- after phase-1 prepare, the primary CTA becomes `Sign Authorization`
- after phase-2 prepare, the primary CTA becomes `Sign And Submit`
- after submit, the UI must switch to pending confirmation state instead of leaving stale buttons enabled

### Error Handling

- endpoint-specific failures should render near the affected action
- do not collapse all failures into one generic banner
- preserve the last known read model while showing mutation failure
- failed sync must keep enough context visible for safe retry

## Layout Rules

### Mobile

Fixed top-to-bottom order:

1. app/header bar
2. character identity summary
3. chain and sync status strip
4. progression summary
5. latest battle summary
6. primary action panel
7. secondary details and diagnostics

Critical above-the-fold rule:

- the player must see current character identity, current chain status, and the primary CTA without awkward scrolling on a standard mobile viewport

### Desktop

Desktop can split into two columns:

- main column:
  - character summary
  - primary action panel
  - latest battle result
- side column:
  - chain status
  - progression
  - settlement metadata

Desktop should improve scan efficiency, not introduce a different workflow.

## Visual Rules

- neutral, systems-first presentation
- compact panels with restrained borders
- avoid heavy shadows and decorative effects
- use typography to create hierarchy before using color
- reserve strong color for action state, error state, and confirmed state
- secondary metadata should be visibly subordinate

## Styling Scope

For the current frontend implementation pass, styling is intentionally functional-first.

In scope now:

- readable layout structure
- clear visual hierarchy
- state distinction for loading, pending, error, and confirmed states
- responsive spacing and density discipline
- minimal component styling needed for usability

Out of scope for now:

- brand polish
- custom visual identity system
- motion design
- decorative illustration
- advanced theming
- visual refinement beyond what is needed for a clear and testable product flow

A later design pass can build on the functional shell once the battle, first-sync, and settlement UX is proven end to end.

## Required UI States

Each major surface must support:

- loading
- loaded
- empty
- error
- stale/syncing
- action pending
- disabled

Examples:

- dashboard loading skeleton
- empty latest-battle panel
- failed first-sync panel with retry CTA
- submitted settlement panel with disabled action and pending indicator

## Acceptance Criteria

- no horizontal overflow at `320px` and above
- primary CTA remains visible near the top of the mobile dashboard unless the current flow is a full-screen signing state
- chain state is always visible without needing to drill into a secondary panel
- local-first versus chain-confirmed behavior is obvious from the interface
- long character names and long wallet addresses do not break layout
- battle actions never ask the user for a random seed
- wallet-required steps never look identical to backend-only steps
- loading skeletons roughly match final geometry
- no contradictory states are shown at once
- if `chain.chainCreationStatus = FAILED`, the retry path is obvious
- if `latestBattle.settlementStatus = AWAITING_FIRST_SYNC`, the UI makes clear that the battle is stored locally but not yet committed on chain

## Implementation Plan

### Phase 1

Build a page-level shell on `app/page.tsx` that:

- bootstraps the anonymous user
- loads the character read model
- switches between `no_character` and `dashboard`

### Phase 2

Implement the dashboard with mocked internal state first:

- character summary
- chain status panel
- progression panel
- latest battle panel
- primary action area

### Phase 3

Connect live data from:

- `POST /api/auth/anon`
- `GET /api/character`
- `POST /api/character/create`
- `POST /api/combat/encounter`

### Phase 4

Implement first-sync interaction:

- wallet connect state
- prepare phase 1
- sign authorization
- prepare phase 2
- sign and submit
- pending confirmation
- failure and retry

### Phase 5

Implement post-sync settlement flow using the same interaction model as first sync.

## Out Of Scope For This Spec

- final SSO-based account ownership
- social/profile systems
- cosmetic customization
- marketing landing pages
- advanced battle replay visualization beyond the current result payload
- multi-character account management
