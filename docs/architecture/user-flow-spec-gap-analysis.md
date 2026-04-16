# Runana MVP User Flow Spec And Gap Analysis

## Purpose

This document defines the reconciled MVP player journey across:

- anonymous entry and wallet linking
- local-first character creation
- run-native zone gameplay
- first sync and later settlement
- result sharing
- sync and grace-period behavior

It is the product-facing companion to:

- [SSOT.md](/home/paps/projects/keep-pushing/docs/architecture/SSOT.md)
- [solana-zone-run-execution-and-settlement-plan.md](/home/paps/projects/keep-pushing/docs/architecture/solana/solana-zone-run-execution-and-settlement-plan.md)
- [deferred-settlement-api-spec.md](/home/paps/projects/keep-pushing/docs/api/deferred-settlement-api-spec.md)
- [reconciliation-inconsistencies.md](/home/paps/projects/keep-pushing/docs/architecture/reconciliation-inconsistencies.md)

This doc is intentionally user-flow-first. The zone-run plan remains the unified implementation checklist.

## Reconciled MVP Baseline

- auto-create an anonymous server-backed account on first open
- keep instant play as the primary onboarding message
- create a playable backend character immediately with `name` and `classId`
- let anon users hold exactly 1 character and wallet-linked users hold up to 3
- make slot assignment server-owned
- use canonical `/api/zone-runs/*` routes for gameplay writes
- use canonical `/api/runs/:runId` routes for result/share reads
- preserve run-native closed-run settlement
- preserve play first, DB persisted first, sync later
- use first sync to create the on-chain character and settle the earliest eligible closed-run batch
- use one-wallet-approval target behavior for first sync and later settlement
- keep server attestation while making the player the real transaction signer
- treat grace as sync/closure-only, not normal continued season gameplay

## Current Workspace Reality

### Already Present Somewhere In The Workspace

- run-native backend gameplay in `keep-pushing`
- active-run and closed-run persistence in `keep-pushing`
- manual testing/dashboard surfaces in `keep-pushing`
- battle-native on-chain settlement program in `runana-program`

### Still Missing Or Not Yet Reconciled

- final roster/session/product surfaces
- final wallet-link UX
- on-chain `name` and `classId`
- on-chain class registry
- reconciled one-approval settlement transport
- run-native on-chain settlement payload redesign
- dedicated sync page and public share pages

## Status Legend

- `Implemented`: exists today in the workspace
- `Planned`: part of the reconciled MVP target
- `Revision Required`: existing direction must change
- `Gap`: absent today

---

## 1. First Open, Landing, And Session Establishment

### User Flow

1. User opens the app.
2. App auto-bootstraps an anonymous server-backed account if no valid session exists.
3. Server returns a normal cookie-backed session.
4. User lands on the landing page.
5. User sees `Try the Game` as the primary CTA and wallet connect as secondary.

### UI Behavior

- primary CTA: `Try the Game`
- wallet connect visible in header/settings
- username/password and SSO may appear only as disabled `coming soon`
- no wallet requirement on first visit

### Server Flow

- `POST /api/auth/anon`
- later wallet link/sign-in uses:
  - `POST /api/auth/wallet/challenge`
  - `POST /api/auth/wallet/verify`

### On-Chain Reads And Writes

- none

### Gap Summary

- `Gap`: final landing page
- `Gap`: automatic anon bootstrap in app shell
- `Gap`: wallet-link UX and session restore UX

---

## 2. Account Modes And Identity Switching

### User Flow

1. User remains anon or connects Phantom later.
2. In the normal case, the connected wallet upgrades the same user account.
3. If the wallet belongs to a different known account, user chooses:
   - `Continue with wallet account`
   - `Stay anon`
4. Device remembers that choice until changed.

### UI Behavior

- account mode labels are simple:
  - `anon`
  - `wallet-linked`
- settings/account surfaces should show the current mode without exposing backend jargon

### Server Flow

- server owns:
  - account mode
  - session continuity
  - wallet-to-user linkage
  - remembered-account resolution rules

### On-Chain Reads And Writes

- none directly

### Gap Summary

- `Gap`: account settings/switching UX
- `Gap`: wallet-link conflict handling flow

---

## 3. Character Roster

### User Flow

1. User opens the character roster.
2. If anon:
   - roster behaves as a single-slot view
3. If wallet-linked:
   - roster shows exactly 3 slots
4. Empty slots route to character creation.
5. Occupied slots route to character detail.

### UI Behavior

#### Anon

- if no character exists, show create CTA
- if a character exists, show the one character card

#### Wallet-Linked

- render exactly 3 slots
- empty state shows `Create Character`
- occupied cards show:
  - `name`
  - `class`
  - `level`
  - compact sync badge

### Server Flow

- `GET /api/characters`
- server is authoritative for:
  - slot count
  - slot placement
  - character-to-slot mapping

### On-Chain Reads And Writes

Read-only enrichment for synced characters:

- `CharacterRootAccount`
- `CharacterStatsAccount`
- `CharacterWorldProgressAccount`
- `CharacterSettlementBatchCursorAccount`

### Gap Summary

- `Gap`: final roster UI
- `Gap`: anon 1-slot vs wallet 3-slot product behavior
- `Gap`: sync badges and season-risk indicators on roster

---

## 4. Character Creation

### User Flow

1. User clicks an empty slot.
2. User enters the character creation page.
3. User selects a class card.
4. User enters a unique name.
5. Client validates format and server checks uniqueness.
6. Server creates the backend-playable character immediately.
7. User is redirected to the character page.
8. Strategic CTA is `Start Run`.

### UI Behavior

- class-first selection with cards
- name field activates after class selection
- name validation states:
  - `empty`
  - `invalid format`
  - `taken`
  - `available`
- name rule: `3-16 ASCII alnum/space`
- submit stays disabled until class + valid name are present

### Server Flow

- `POST /api/characters`
- request includes:
  - `name`
  - `classId`
  - `slotIndex` when relevant
- backend must:
  - enforce slot limits
  - enforce enabled class ids
  - enforce global name uniqueness
  - create the immediately playable backend character

### On-Chain Reads And Writes

On create itself:

- none

At first sync later:

- `CharacterRootAccount`
  - owner
  - character id
  - creation timestamp
  - `name`
  - `classId`
- `CharacterStatsAccount`
- `CharacterWorldProgressAccount`
- first zone-progress page
- settlement cursor

### Gap Summary

- `Gap`: final creation page
- `Gap`: enabled class catalog API/read model
- `Revision Required`: chain character bootstrap must mirror backend `name` and `classId`

---

## 5. Class Model

### User Flow

1. User sees the enabled launch classes as cards during creation.
2. User never sees disabled classes.

### UI Behavior

- backend supplies display metadata:
  - name
  - description
  - art
- chain only governs whether a class id is enabled

### Server Flow

- `GET /api/classes`
- server combines:
  - on-chain enabled registry
  - off-chain display metadata

### On-Chain Reads And Writes

Reads:

- class registry PDAs

Writes:

- admin-controlled class initialization / enable / disable

Minimal chain fields per class:

- `classId`
- `enabled`

### Gap Summary

- `Gap`: on-chain class registry
- `Gap`: backend class catalog route

---

## 6. Character Page

### User Flow

1. User lands here after character creation or from the roster.
2. User sees identity and progression first.
3. User sees season summary and sync summary.
4. Primary CTA is `Start Run` in active season.
5. During grace, if at-risk work exists, sync urgency becomes more prominent.

### UI Behavior

Recommended top section:

- `name`
- `class`
- `level`
- progression summary
- current season summary

Recommended actions:

- `Start Run`
- `Sync`
- share/history links where relevant

### Server Flow

- `GET /api/characters/:characterId`
- response should include:
  - `character`
  - `progression`
  - `season`
  - `sync`

### On-Chain Reads And Writes

Reads:

- `CharacterRootAccount`
- `CharacterStatsAccount`
- `CharacterWorldProgressAccount`
- zone progress pages
- settlement cursor

Writes:

- none from page load

### Gap Summary

- `Gap`: final character page
- `Gap`: compact sync summary model
- `Gap`: season presentation metadata layer

---

## 7. Run Setup Page

### User Flow

1. User chooses `Start Run`.
2. User sees season number, season name, and the active timer.
3. User sees unlocked zones and teaser cards for locked zones.
4. User picks a zone and starts the run.

### UI Behavior

- active season:
  - show countdown to season end
- grace:
  - show countdown to grace end
  - emphasize syncing already-earned progress
- locked zones should still appear visually as teasers

### Server Flow

- `GET /api/seasons/current`
- `GET /api/characters/:characterId`
- `POST /api/zone-runs/start`

### On-Chain Reads And Writes

Reads:

- `SeasonPolicyAccount`
- `CharacterWorldProgressAccount`
- zone progress pages

Writes:

- none on read
- later run settlement determines on-chain progression

### Gap Summary

- `Gap`: final run setup page
- `Gap`: season name/number presentation layer

---

## 8. Active Run Experience

### User Flow

1. User starts a run.
2. User sees only the local map window:
   - previous
   - current
   - immediate next
3. User advances subnodes, resolves combats, chooses branches, and uses pause skills where allowed.
4. Run ends as complete, failed, abandoned, idle-expired, or season-cutoff.

### UI Behavior

- preserve canonical zone-run flow
- do not expose the full future graph
- map/stepper is presentation-only local context
- post-battle pause should support sharing later from the result phase, not interrupt core execution semantics

### Server Flow

Canonical mutating routes:

- `POST /api/zone-runs/start`
- `GET /api/zone-runs/active`
- `POST /api/zone-runs/choose-branch`
- `POST /api/zone-runs/advance`
- `POST /api/zone-runs/use-skill`
- `POST /api/zone-runs/continue`
- `POST /api/zone-runs/abandon`

### On-Chain Reads And Writes

- none during run execution
- gameplay remains server-authored and server-executed

### Gap Summary

- `Implemented`: canonical backend run loop exists
- `Gap`: final player-facing run UI
- `Gap`: final run reload/resume product surface

---

## 9. Run Result And Share Flow

### User Flow

1. Run closes into a durable result.
2. User lands on the run result page.
3. In active season, primary emotional action is `Share`.
4. Sync is available, but usually as a lower-emphasis path to the sync page.
5. Public share page is unlisted and public-by-link.

### UI Behavior

Run result should show:

- character name
- class
- zone
- outcome
- status label:
  - `Pending`
  - `Synced`
  - `Expired`

### Server Flow

- `GET /api/runs/:runId`
- `POST /api/runs/:runId/share`

### On-Chain Reads And Writes

- none required for share generation itself
- run status may be enriched from sync state and settlement reconciliation

### Gap Summary

- `Gap`: final result page
- `Gap`: public share page
- `Gap`: public share persistence/model

---

## 10. First Sync

### User Flow

1. User has already played one or more local-first runs.
2. User taps `Sync`.
3. Backend prepares the first-sync contract:
   - create on-chain character
   - settle the earliest eligible closed-run batch
4. Client builds or finalizes the Solana transaction locally.
5. Phantom shows one approval.
6. Client submits the transaction directly.
7. Client immediately acknowledges the `txid`.
8. Backend reconciles chain character creation and the first settled batch.

### UI Behavior

- one sync CTA
- clear loading states
- no separate player message-signing step
- errors should resolve into:
  - retry
  - wait for confirmation
  - expired backlog explanation when applicable

### Server Flow

- `POST /api/solana/character/first-sync/prepare`
- `POST /api/solana/character/first-sync/ack`

### On-Chain Reads And Writes

Writes:

- create character accounts
- apply first closed-run settlement batch
- persist authoritative EXP / level / progression / cursor

Validation requirements:

- server attestation remains mandatory
- player authority is validated as the real transaction signer
- no separate player permit message remains in MVP

### Gap Summary

- `Revision Required`: old opaque prepared-transaction path is no longer canonical
- `Revision Required`: current battle-native chain program does not yet match run-native first sync

---

## 11. Later Sync And Dedicated Sync Page

### User Flow

1. More closed runs accumulate after first sync.
2. User opens the sync page or taps sync from the character page.
3. Backend prepares the next oldest eligible unresolved batch.
4. Client signs once and submits.
5. Client acknowledges `txid`.
6. Backend reconciles the batch.
7. If backlog remains, it stays pending for later sync taps.

### UI Behavior

Dedicated sync page priority:

- progression first
- sync state second

Recommended top-of-page summary:

- current level/progression
- unresolved sync work count/summary
- latest unresolved batch state

Primary action:

- retry or continue sync on the oldest unresolved eligible batch

### Server Flow

- `GET /api/characters/:characterId/sync`
- `POST /api/solana/settlement/prepare`
- `POST /api/solana/settlement/ack`

### On-Chain Reads And Writes

Reads:

- character root
- stats
- world progress
- settlement cursor

Writes:

- apply one oldest-contiguous eligible closed-run batch

### Gap Summary

- `Gap`: dedicated sync page
- `Gap`: durable batch + attempt read models in product UI
- `Revision Required`: current transport must become prepare + client submit + ack

---

## 12. Grace Period And Expiry

### User Flow

1. Season playable window ends.
2. Grace begins.
3. User can still sync or close already-earned progress.
4. User cannot continue normal seasonal gameplay for that season.
5. After grace ends, unresolved runs become read-only expired history.

### UI Behavior

During grace:

- show countdown to grace end
- increase sync urgency across roster, character page, and sync page

After grace:

- label unresolved runs `Expired, not synced`
- keep expired runs visible as history
- keep expired share pages viewable

### Server Flow

- season presentation comes from `GET /api/seasons/current`
- expiry jobs or equivalent scheduled reconciliation mark unresolved work expired at or after grace end

### On-Chain Reads And Writes

Reads:

- `SeasonPolicyAccount`

Writes:

- none after grace for expired unresolved prior-season progress

### Gap Summary

- `Revision Required`: product copy must consistently treat grace as sync/closure-only
- `Gap`: grace-risk surfacing across roster/character/sync pages
- `Gap`: expiry background job and expired-history read model

---

## 13. On-Chain Contract Summary

### Reconciled Target

- `name` and `classId` are mirrored on-chain at first sync character creation
- class enablement is on-chain
- level derives on-chain from EXP
- settlement unit is a closed settleable run
- zero-value closed runs do not enter settlement continuity
- no run may ever be split across two batches
- player signer replaces separate player settlement-permit auth
- server attestation remains

### Current Gap Summary

- `Revision Required`: battle-native settlement payload must become run-native
- `Revision Required`: character-root schema must include `name` and `classId`
- `Gap`: class registry PDAs

---

## 14. Unified Planning Rule

For implementation planning, this document is descriptive and product-facing.

The single authoritative work checklist is:

- [solana-zone-run-execution-and-settlement-plan.md](/home/paps/projects/keep-pushing/docs/architecture/solana/solana-zone-run-execution-and-settlement-plan.md)

That checklist must carry:

- frontend/player-surface work
- backend/API work
- sync transport work
- on-chain redesign work
- migration and test work
