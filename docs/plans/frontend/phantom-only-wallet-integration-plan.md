# Phantom-Only Wallet Integration Plan

## Summary

Add a minimal Phantom browser-wallet integration to the current dashboard so the app can replace the manual signing flow for:
- first sync
- post-sync settlement

This integration should use direct Phantom provider access (`window.phantom?.solana` / `window.solana`) rather than Solana Wallet Adapter. It should target desktop browser extension use on localnet/dev first, attempt trusted reconnect on refresh, and remove the current manual signature UI from the normal product flow.

Defaults chosen:
- scope covers first sync and post-sync settlement
- Phantom is the only supported wallet in v1
- trusted reconnect is attempted on page load
- no mobile deep-link support in v1
- no backend API changes are required unless a concrete provider-compat bug is discovered

## Key Changes

### Wallet capability layer
- Add a small client-only Phantom integration module that:
  - detects whether Phantom is installed
  - exposes `connect`, `disconnect`, `tryTrustedReconnect`, `signMessage`, and `signTransaction`
  - returns the connected public key in base58
  - normalizes Phantom/provider errors into frontend-friendly error strings
- Add local TypeScript types for the Phantom provider instead of introducing a wallet-adapter dependency.
- Treat Phantom as unavailable when:
  - `window` is missing
  - provider is missing
  - provider is present but `isPhantom !== true`

### App-level wallet state
- Add a wallet state layer in the dashboard page/client shell with:
  - `installed` / `not_installed`
  - `disconnected`
  - `connecting`
  - `connected`
  - `signing_message`
  - `signing_transaction`
  - `wallet_error`
- On client bootstrap, attempt `connect({ onlyIfTrusted: true })`.
- Persist no custom wallet secret or token locally; the source of truth is the live Phantom provider connection.
- Surface wallet identity in the dashboard header and chain-status area.

### First-sync UX replacement
- Replace the current manual first-sync inputs for:
  - authority
  - fee payer
  - pasted authorization signature
  - pasted signed message
  - pasted signed transaction
- New first-sync flow:
  1. user clicks `Connect Phantom` if disconnected
  2. app calls first-sync prepare phase 1 using connected wallet pubkey for both `authority` and `feePayer`
  3. app decodes `playerAuthorizationMessageBase64`
  4. app requests Phantom `signMessage`
  5. app base64-encodes the 64-byte signature and calls first-sync prepare phase 2
  6. app decodes `preparedTransaction.serializedTransactionBase64` into a `VersionedTransaction`
  7. app requests Phantom `signTransaction`
  8. app serializes the signed transaction back to base64
  9. app derives `signedMessageBase64` from the signed transaction message bytes
  10. app submits to `/api/solana/character/first-sync/submit`
  11. app refreshes `GET /api/character`
- UI states must clearly distinguish:
  - preparing authorization
  - waiting for message signature
  - preparing transaction
  - waiting for transaction signature
  - submitting
  - confirmed
  - retryable failure

### Settlement UX replacement
- Apply the same Phantom flow to post-sync settlement:
  1. use connected wallet pubkey as `authority` and `feePayer`
  2. prepare authorize phase
  3. Phantom signs the authorization message
  4. prepare transaction phase
  5. Phantom signs the prepared versioned transaction
  6. submit to settlement submit route
  7. refresh the read model
- Reuse the same wallet/signing helpers and shared pending/error UI patterns as first sync.

### Authority and mismatch handling
- If the character already has `chain.playerAuthorityPubkey`:
  - compare it against the connected Phantom public key
  - block signing flows when they differ
  - show an explicit mismatch error and require the user to reconnect the correct wallet
- For local-first characters with no persisted authority yet:
  - allow Phantom to become the effective authority used in first sync
- Since backend currently requires `feePayer === authority`, the frontend must always submit the same Phantom pubkey for both.

### Dashboard UX changes
- Add a wallet status region near the top of the dashboard:
  - Phantom installed or not
  - connected public key
  - `Connect Phantom` / `Disconnect`
- Update the primary CTA logic:
  - if a sync or settlement action requires a wallet and Phantom is disconnected, CTA becomes `Connect Phantom`
  - once connected, CTA advances into the real signing flow
- Remove manual base64 textarea fields from the normal UI.
- Since the user requested manual removal, do not keep the old manual entry flow in the main interface. If a developer-only fallback is still needed later, it should be behind an explicit non-default dev flag, not visible in standard UX.

### Interfaces and type additions
- Add a small frontend-only Phantom provider type with:
  - `isPhantom`
  - `publicKey`
  - `connect`
  - `disconnect`
  - `signMessage`
  - `signTransaction`
  - optional event hooks like `on('connect'|'disconnect'|'accountChanged')`
- Add frontend wallet-state types for:
  - provider availability
  - connection status
  - current public key
  - last wallet/signing error
- Keep existing backend API shapes unchanged:
  - `PrepareFirstSyncRouteRequest/Response`
  - `SubmitFirstSyncRouteRequest/Response`
  - `PrepareSettlementRouteRequest/Response`
  - `SubmitSettlementRouteRequest`

### Docs and runbooks
- Update the frontend spec doc to reflect:
  - Phantom-only wallet integration
  - removal of manual signing from the standard UI
  - trusted reconnect behavior
- Update the local dashboard runbook with:
  - Phantom prerequisite
  - browser expectations
  - how to use localnet with Phantom
- Update the API/deferred-settlement doc only if any frontend contract expectations need clarification around wallet-driven signing behavior.

## Test Plan

### Frontend unit/integration tests
- Provider detection:
  - Phantom present
  - Phantom absent
  - non-Phantom provider ignored
- Trusted reconnect:
  - successful silent reconnect
  - reconnect denied / unavailable
- First sync:
  - connected wallet prepares phase 1
  - signs message
  - prepares transaction
  - signs transaction
  - submits successfully
  - refreshes read model
- Settlement:
  - same happy-path flow for pending settlement batch
- Error cases:
  - user rejects message signature
  - user rejects transaction signature
  - provider disconnects mid-flow
  - connected wallet mismatches persisted chain authority
  - backend prepare returns conflict/error
  - backend submit returns mismatch/error

### Browser behavior checks
- No wallet installed:
  - show install/connect guidance
  - block sync/settlement actions cleanly
- Wallet installed but disconnected:
  - `Connect Phantom` is primary when required
- Wallet connected:
  - authority fields are not user-editable
  - connected pubkey is visible and truncated safely

### Validation/build
- `npm run build`
- `npx tsc -p tsconfig.json --noEmit`
- any existing frontend tests covering the dashboard should be updated to reflect wallet-driven actions and removed manual fields

## Assumptions

- Phantom desktop browser extension is the only supported wallet in v1.
- Localnet/dev usage is the target; no mobile wallet deep-link flow is included.
- Phantom supports signing the message and versioned transaction shapes already produced by the backend.
- Backend remains the broadcaster; the browser wallet only signs.
- No backend API redesign is needed; the work is a frontend integration and UX replacement over the existing prepare/sign/submit contract.
