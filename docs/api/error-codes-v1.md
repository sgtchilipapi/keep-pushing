# V1 Error Codes

This document tracks the stable machine-readable error codes used by the wallet-session migration routes under `/api/v1/**`.

## Auth

| Code | Route(s) | Meaning | Retryable |
| --- | --- | --- | --- |
| `AUTH_NONCE_INVALID_JSON` | `/api/v1/auth/nonce` | Request body could not be parsed as JSON. | No |
| `AUTH_NONCE_INVALID_CHAIN` | `/api/v1/auth/nonce` | Requested auth chain is not supported. | No |
| `AUTH_NONCE_WALLET_REQUIRED` | `/api/v1/auth/nonce` | Wallet address was missing. | No |
| `AUTH_NONCE_WALLET_INVALID` | `/api/v1/auth/nonce` | Wallet address was not a valid Solana public key. | No |
| `AUTH_NONCE_RATE_LIMIT_IP` | `/api/v1/auth/nonce` | IP-based nonce issuance rate limit exceeded. | Yes |
| `AUTH_NONCE_RATE_LIMIT_WALLET` | `/api/v1/auth/nonce` | Wallet-based nonce issuance rate limit exceeded. | Yes |
| `AUTH_VERIFY_INVALID_JSON` | `/api/v1/auth/verify` | Request body could not be parsed as JSON. | No |
| `AUTH_VERIFY_REQUIRED_FIELDS` | `/api/v1/auth/verify` | One or more required verification fields were missing. | No |
| `AUTH_VERIFY_WALLET_INVALID` | `/api/v1/auth/verify` | Wallet address was not a valid Solana public key. | No |
| `AUTH_VERIFY_RATE_LIMIT_IP` | `/api/v1/auth/verify` | IP-based auth verification rate limit exceeded. | Yes |
| `AUTH_VERIFY_RATE_LIMIT_WALLET` | `/api/v1/auth/verify` | Wallet-based auth verification rate limit exceeded. | Yes |
| `AUTH_VERIFY_NONCE_INVALID_OR_REPLAYED` | `/api/v1/auth/verify` | Nonce was invalid, expired, or already consumed. | No |
| `AUTH_VERIFY_SIGNATURE_INVALID` | `/api/v1/auth/verify` | Wallet signature did not verify against the expected message. | No |
| `AUTH_VERIFY_USER_UPSERT_FAILED` | `/api/v1/auth/verify` | User record could not be created or updated. | No |
| `ERR_AUTH_SESSION_REQUIRED` | authenticated v1 routes | No active session cookie was present. | No |
| `ERR_AUTH_SESSION_INVALID` | authenticated v1 routes | Session token was missing, expired, revoked, or orphaned. | No |
| `ERR_AUTH_FORBIDDEN` | authenticated v1 routes | Session is authenticated but not allowed to access the target resource. | No |
| `ERR_AUTH_CHARACTER_FORBIDDEN` | character-bound v1 routes | Character does not belong to the authenticated session. | No |
| `ERR_AUTH_WALLET_FORBIDDEN` | signed v1 routes | Prepared transaction wallet did not match the active session wallet. | No |

## Character Create

| Code | Route(s) | Meaning | Retryable |
| --- | --- | --- | --- |
| `CHARACTER_CREATE_PREPARE_INVALID_JSON` | `/api/v1/characters/create/prepare` | Request body could not be parsed as JSON. | No |
| `CHARACTER_CREATE_FINALIZE_INVALID_JSON` | `/api/v1/characters/create/finalize` | Request body could not be parsed as JSON. | No |
| `ERR_INVALID_PREPARED` | `/api/v1/characters/create/finalize` | Finalize request omitted prepared transaction metadata. | No |
| `ERR_CHARACTER_NOT_FOUND` | character create and first-sync routes | Local character or chain state could not be found. | No |
| `ERR_CHARACTER_ALREADY_CONFIRMED` | character create routes | Character is already confirmed on chain. | No |
| `ERR_CHARACTER_AUTHORITY_MISMATCH` | character create and first-sync routes | Active wallet does not match the persisted chain authority. | No |
| `ERR_CHARACTER_CHAIN_IDENTITY_CORRUPT` | `/api/v1/characters/create/prepare` | Stored chain identity does not match the canonical PDA derivation. | No |
| `ERR_CHARACTER_CHAIN_ID_MISMATCH` | finalize routes | Finalize relay metadata does not match persisted chain identity. | No |
| `ERR_CHARACTER_ROOT_MISMATCH` | finalize routes | Finalize relay metadata does not match persisted character root. | No |
| `ERR_CHARACTER_SUBMISSION_STATE` | finalize routes | Character create / first-sync finalize was attempted from an invalid chain state. | No |
| `ERR_CHARACTER_CREATE_TX_DOMAIN_MISMATCH` | `/api/v1/characters/create/finalize` | Signed transaction no longer matches the prepared character-create transaction domain. | No |

## First Sync

| Code | Route(s) | Meaning | Retryable |
| --- | --- | --- | --- |
| `FIRST_SYNC_PREPARE_INVALID_JSON` | `/api/v1/characters/first-sync/prepare` | Request body could not be parsed as JSON. | No |
| `FIRST_SYNC_FINALIZE_INVALID_JSON` | `/api/v1/characters/first-sync/finalize` | Request body could not be parsed as JSON. | No |
| `ERR_NO_FIRST_SYNC_BATCH` | `/api/v1/characters/first-sync/prepare` | Character has no eligible first-sync settlement batch. | No |
| `ERR_FIRST_SYNC_BATCH_RELAY_MISMATCH` | `/api/v1/characters/first-sync/finalize` | Finalize relay metadata no longer matches the prepared first-sync batch. | No |

## Settlement

| Code | Route(s) | Meaning | Retryable |
| --- | --- | --- | --- |
| `SETTLEMENT_PREPARE_INVALID_JSON` | `/api/v1/settlement/prepare` | Request body could not be parsed as JSON. | No |
| `SETTLEMENT_PRESIGN_INVALID_JSON` | `/api/v1/settlement/presign` | Request body could not be parsed as JSON. | No |
| `SETTLEMENT_FINALIZE_INVALID_JSON` | `/api/v1/settlement/finalize` | Request body could not be parsed as JSON. | No |
| `SETTLEMENT_PREPARE_RATE_LIMIT_SESSION` | `/api/v1/settlement/prepare` | Session-based settlement prepare rate limit exceeded. | Yes |
| `SETTLEMENT_PREPARE_RATE_LIMIT_CHARACTER` | `/api/v1/settlement/prepare` | Character-based settlement prepare rate limit exceeded. | Yes |
| `SETTLEMENT_PRESIGN_RATE_LIMIT_SESSION` | `/api/v1/settlement/presign` | Session-based settlement presign rate limit exceeded. | Yes |
| `SETTLEMENT_PRESIGN_RATE_LIMIT_REQUEST` | `/api/v1/settlement/presign` | Request-based settlement presign burst limit exceeded. | Yes |
| `SETTLEMENT_FINALIZE_RATE_LIMIT_SESSION` | `/api/v1/settlement/finalize` | Session-based settlement finalize rate limit exceeded. | Yes |
| `ERR_SETTLEMENT_REQUEST_NOT_FOUND` | presign and finalize | Referenced settlement request does not exist. | No |
| `ERR_SETTLEMENT_REQUEST_EXPIRED` | presign and finalize | Settlement request expired before completion. | No |
| `ERR_SETTLEMENT_REQUEST_STATE_INVALID` | presign and finalize | Settlement request is not in a state that allows the attempted transition. | No |
| `ERR_SETTLEMENT_PRESIGN_TOKEN_INVALID` | `/api/v1/settlement/presign` | Presign token did not match the prepared settlement request. | No |
| `ERR_SETTLEMENT_ALREADY_SUBMITTED` | `/api/v1/settlement/prepare` | Settlement batch is already in flight. | No |
| `ERR_SETTLEMENT_BATCH_NOT_FOUND` | prepare and finalize | Settlement batch could not be found or no longer matched the request. | No |
| `ERR_SETTLEMENT_TX_MISMATCH_MESSAGE_HASH` | `/api/v1/settlement/presign` | Presign callback transaction message differed from the prepared canonical hash. | No |
| `ERR_SETTLEMENT_TX_MISMATCH_FEE_PAYER` | `/api/v1/settlement/presign` | Presign callback transaction fee payer did not match the sponsor signer. | No |
| `ERR_SETTLEMENT_TX_MISMATCH_INSTRUCTION_SET` | `/api/v1/settlement/presign` | Presign callback transaction instruction set was not canonical. | No |
| `ERR_SETTLEMENT_TX_MISMATCH_PROGRAM_ID` | `/api/v1/settlement/presign` | Presign callback transaction targeted the wrong program id. | No |
| `ERR_SETTLEMENT_TX_MISMATCH_REPLAY_HASH` | `/api/v1/settlement/presign` | Presign retry attempted a different transaction message than the original presigned request. | No |

## Legacy Breaking-Change Shims

| Code | Route(s) | Meaning | Retryable |
| --- | --- | --- | --- |
| `ERR_LEGACY_SETTLEMENT_ROUTE_REMOVED` | legacy settlement routes | Legacy settlement HTTP route has been removed and replaced by the v1 contract. | No |
| `ERR_LEGACY_CHARACTER_CREATE_ROUTE_REMOVED` | legacy Solana character-create routes | Legacy Solana character-create route has been removed and replaced by the v1 contract. | No |
| `ERR_LEGACY_FIRST_SYNC_ROUTE_REMOVED` | legacy Solana first-sync routes | Legacy Solana first-sync route has been removed and replaced by the v1 contract. | No |
