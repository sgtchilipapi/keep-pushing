'use client';

import { useEffect, useMemo, useState } from 'react';

import type {
  FirstSyncPreparedPhase,
  FirstSyncPreparationBase,
  SettlementPreparedPhase,
  SettlementPreparationBase,
} from '../../types/api/solana';
import type {
  AnonymousUserResponse,
  ChainCreationStatus,
  CharacterQueryResponse,
  CharacterReadModel,
  CreateCharacterResponse,
  EncounterResponse,
  FirstSyncPrepareResponse,
  SettlementPrepareResponse,
} from '../../types/api/frontend';
import BattleReplay from '../BattleReplay';
import StatusBadge from './StatusBadge';
import styles from './game-shell.module.css';
import {
  connectPhantom,
  disconnectPhantom,
  getPhantomProvider,
  getWalletAvailability,
  normalizeWalletError,
  signAuthorizationMessageUtf8,
  signPreparedPlayerOwnedTransaction,
  type WalletActionStatus,
  type WalletAvailability,
  type WalletConnectionStatus,
} from '../../lib/solana/phantomBrowser';

const USER_STORAGE_KEY = 'keep-pushing:user-id';
const PHANTOM_INSTALL_URL = 'https://phantom.app/download';

type AppPhase = 'bootstrapping_user' | 'loading_character' | 'ready' | 'fatal_error';

type ApiErrorShape = {
  error?: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function apiRequest<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const data = (await response.json().catch(() => null)) as T | ApiErrorShape | null;

  if (!response.ok) {
    const message =
      isObject(data) && typeof data.error === 'string'
        ? data.error
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return data as T;
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return 'Not available';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatUnixTimestamp(value: number | null): string {
  if (value === null) {
    return 'Not available';
  }

  return new Date(value * 1000).toLocaleString();
}

function truncateMiddle(value: string | null | undefined, edge = 8): string {
  if (!value) {
    return 'Not available';
  }

  if (value.length <= edge * 2 + 3) {
    return value;
  }

  return `${value.slice(0, edge)}...${value.slice(-edge)}`;
}

function chainTone(status: ChainCreationStatus | 'NOT_STARTED'): 'neutral' | 'warning' | 'success' | 'danger' | 'info' {
  switch (status) {
    case 'CONFIRMED':
      return 'success';
    case 'FAILED':
      return 'danger';
    case 'SUBMITTED':
      return 'info';
    case 'PENDING':
      return 'warning';
    case 'NOT_STARTED':
    default:
      return 'neutral';
  }
}

function settlementTone(status: string | null | undefined): 'neutral' | 'warning' | 'success' | 'danger' | 'info' {
  switch (status) {
    case 'COMMITTED':
    case 'CONFIRMED':
      return 'success';
    case 'FAILED':
    case 'LOCAL_ONLY_ARCHIVED':
      return 'danger';
    case 'SUBMITTED':
      return 'info';
    case 'AWAITING_FIRST_SYNC':
    case 'SEALED':
    case 'PENDING':
    case 'PREPARED':
      return 'warning';
    default:
      return 'neutral';
  }
}

function walletAvailabilityTone(status: WalletAvailability): 'neutral' | 'warning' | 'success' {
  switch (status) {
    case 'installed':
      return 'success';
    case 'not_installed':
      return 'warning';
    case 'unknown':
    default:
      return 'neutral';
  }
}

function walletConnectionTone(status: WalletConnectionStatus): 'neutral' | 'warning' | 'success' | 'info' {
  switch (status) {
    case 'connected':
      return 'success';
    case 'connecting':
    case 'checking_trusted':
      return 'info';
    case 'disconnected':
    default:
      return 'neutral';
  }
}

function walletActionLabel(status: WalletActionStatus): string | null {
  switch (status) {
    case 'signing_message':
      return 'Signing message';
    case 'signing_transaction':
      return 'Signing transaction';
    case 'idle':
    default:
      return null;
  }
}

function primaryActionLabel(character: CharacterReadModel): string {
  const chainStatus = character.chain?.chainCreationStatus ?? 'NOT_STARTED';

  if (chainStatus !== 'CONFIRMED') {
    if (
      character.latestBattle?.settlementStatus === 'AWAITING_FIRST_SYNC' ||
      character.latestBattle?.settlementStatus === 'SEALED' ||
      chainStatus === 'PENDING' ||
      chainStatus === 'FAILED'
    ) {
      return 'Sync to Chain';
    }

    return 'Battle';
  }

  if (character.nextSettlementBatch !== null) {
    return 'Settle Pending Batch';
  }

  return 'Battle';
}

function maxUnlockedZone(character: CharacterReadModel | null): number {
  return Math.max(1, character?.provisionalProgress?.highestUnlockedZoneId ?? 1);
}

function authorityMismatchMessage(character: CharacterReadModel, walletPublicKey: string | null): string | null {
  const expectedAuthority = character.chain?.playerAuthorityPubkey;
  if (!expectedAuthority || !walletPublicKey) {
    return null;
  }

  if (expectedAuthority === walletPublicKey) {
    return null;
  }

  return `Connected Phantom wallet ${truncateMiddle(walletPublicKey)} does not match the character authority ${truncateMiddle(expectedAuthority)}. Reconnect the correct wallet before signing.`;
}

type CreateCharacterPanelProps = {
  name: string;
  pending: boolean;
  error: string | null;
  onNameChange: (value: string) => void;
  onSubmit: () => void;
};

function CreateCharacterPanel(props: CreateCharacterPanelProps) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelTitleRow}>
        <div className={styles.stack}>
          <h2 className={styles.panelTitle}>Create your first character</h2>
          <p className={styles.panelText}>
            This project starts local-first. You can create a character and battle immediately, then
            sync the backlog on chain later.
          </p>
        </div>
      </div>

      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span className={styles.label}>Character name</span>
          <input
            className={styles.input}
            value={props.name}
            onChange={(event) => props.onNameChange(event.target.value)}
            placeholder="Rookie"
            maxLength={40}
            disabled={props.pending}
          />
        </label>

        {props.error ? <div className={styles.errorBox}>{props.error}</div> : null}

        <div className={styles.buttonRow}>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary}`}
            onClick={props.onSubmit}
            disabled={props.pending}
          >
            {props.pending ? 'Creating Character...' : 'Create Character'}
          </button>
        </div>
      </div>
    </section>
  );
}

type WalletToolbarProps = {
  availability: WalletAvailability;
  connectionStatus: WalletConnectionStatus;
  actionStatus: WalletActionStatus;
  publicKey: string | null;
  error: string | null;
  pending: boolean;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
};

function WalletToolbar(props: WalletToolbarProps) {
  const actionLabel = walletActionLabel(props.actionStatus);

  return (
    <>
      <StatusBadge
        label={props.availability === 'installed' ? 'Phantom installed' : 'Phantom not installed'}
        tone={walletAvailabilityTone(props.availability)}
      />
      <StatusBadge label={props.connectionStatus} tone={walletConnectionTone(props.connectionStatus)} />
      {props.publicKey ? <span className={styles.metaText}>Wallet: {truncateMiddle(props.publicKey)}</span> : null}
      {actionLabel ? <StatusBadge label={actionLabel} tone="info" /> : null}

      {props.availability === 'not_installed' ? (
        <a className={styles.button} href={PHANTOM_INSTALL_URL} target="_blank" rel="noreferrer">
          Install Phantom
        </a>
      ) : props.connectionStatus === 'connected' ? (
        <button type="button" className={styles.button} onClick={() => void props.onDisconnect()} disabled={props.pending}>
          Disconnect
        </button>
      ) : (
        <button
          type="button"
          className={styles.button}
          onClick={() => void props.onConnect()}
          disabled={props.pending || props.availability !== 'installed'}
        >
          {props.connectionStatus === 'connecting' ? 'Connecting...' : 'Connect Phantom'}
        </button>
      )}

      {props.error ? <div className={styles.errorBox}>{props.error}</div> : null}
    </>
  );
}

type FirstSyncPanelProps = {
  character: CharacterReadModel;
  walletAvailability: WalletAvailability;
  walletConnectionStatus: WalletConnectionStatus;
  walletActionStatus: WalletActionStatus;
  walletPublicKey: string | null;
  onConnectWallet: () => Promise<void>;
  setWalletActionStatus: (status: WalletActionStatus) => void;
  onRefresh: () => Promise<void>;
};

function FirstSyncPanel(props: FirstSyncPanelProps) {
  const [authorizeData, setAuthorizeData] = useState<FirstSyncPreparationBase | null>(null);
  const [preparedData, setPreparedData] = useState<FirstSyncPreparedPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [preparePending, setPreparePending] = useState(false);
  const [submitPending, setSubmitPending] = useState(false);

  const chainStatus = props.character.chain?.chainCreationStatus ?? 'NOT_STARTED';
  const mismatchMessage = authorityMismatchMessage(props.character, props.walletPublicKey);
  const buttonPending = preparePending || submitPending || props.walletConnectionStatus === 'connecting';

  useEffect(() => {
    setAuthorizeData(null);
    setPreparedData(null);
    setError(null);
    setSuccess(null);
  }, [props.character.characterId, props.character.chain?.chainCreationStatus, props.walletPublicKey]);

  async function prepareAuthorize() {
    if (!props.walletPublicKey) {
      setError('Connect Phantom before preparing first sync.');
      return;
    }

    setPreparePending(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await apiRequest<FirstSyncPrepareResponse>('/api/solana/character/first-sync/prepare', {
        method: 'POST',
        body: JSON.stringify({
          characterId: props.character.characterId,
          authority: props.walletPublicKey,
          feePayer: props.walletPublicKey,
        }),
      });

      if (response.phase !== 'authorize') {
        throw new Error('Unexpected prepare response: expected authorize phase.');
      }

      setAuthorizeData(response);
      setPreparedData(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to prepare first sync.');
    } finally {
      setPreparePending(false);
    }
  }

  async function signAuthorization() {
    if (authorizeData === null) {
      setError('Prepare authorization before requesting a Phantom signature.');
      return;
    }

    const provider = getPhantomProvider();
    if (provider === null) {
      setError('Phantom wallet is not installed.');
      return;
    }

    setPreparePending(true);
    setError(null);
    setSuccess(null);
    props.setWalletActionStatus('signing_message');

    try {
      if (authorizeData.payload.signatureScheme !== 1) {
        throw new Error(
          'This pending first-sync batch uses the legacy manual signature scheme. Use the CLI fallback to complete it or prepare a fresh wallet-text batch.',
        );
      }
      const playerAuthorizationSignatureBase64 = await signAuthorizationMessageUtf8(
        provider,
        authorizeData.playerAuthorizationMessageUtf8,
      );
      const response = await apiRequest<FirstSyncPrepareResponse>('/api/solana/character/first-sync/prepare', {
        method: 'POST',
        body: JSON.stringify({
          characterId: props.character.characterId,
          authority: props.walletPublicKey,
          feePayer: props.walletPublicKey,
          playerAuthorizationSignatureBase64,
        }),
      });

      if (response.phase !== 'sign_transaction') {
        throw new Error('Unexpected prepare response: expected sign_transaction phase.');
      }

      setAuthorizeData(response);
      setPreparedData(response);
    } catch (nextError) {
      setError(normalizeWalletError(nextError));
    } finally {
      props.setWalletActionStatus('idle');
      setPreparePending(false);
    }
  }

  async function signAndSubmit() {
    if (preparedData === null) {
      setError('Prepare the transaction before requesting a Phantom signature.');
      return;
    }

    const provider = getPhantomProvider();
    if (provider === null) {
      setError('Phantom wallet is not installed.');
      return;
    }

    setSubmitPending(true);
    setError(null);
    setSuccess(null);
    props.setWalletActionStatus('signing_transaction');

    try {
      const signed = await signPreparedPlayerOwnedTransaction(provider, preparedData.preparedTransaction);
      const response = await apiRequest<{
        transactionSignature: string;
        chainCharacterIdHex: string;
        characterRootPubkey: string;
      }>('/api/solana/character/first-sync/submit', {
        method: 'POST',
        body: JSON.stringify({
          prepared: preparedData.preparedTransaction,
          signedMessageBase64: signed.signedMessageBase64,
          signedTransactionBase64: signed.signedTransactionBase64,
        }),
      });

      setSuccess(
        `First sync confirmed. Tx ${truncateMiddle(response.transactionSignature)} | Character ${truncateMiddle(response.characterRootPubkey)}`,
      );
      setAuthorizeData(null);
      setPreparedData(null);
      await props.onRefresh();
    } catch (nextError) {
      setError(normalizeWalletError(nextError));
    } finally {
      props.setWalletActionStatus('idle');
      setSubmitPending(false);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.panelTitleRow}>
        <div className={styles.stack}>
          <h2 className={styles.panelTitle}>First Sync</h2>
          <p className={styles.panelText}>
            Use Phantom to authorize and sign the atomic first-sync transaction that creates the
            character on chain and commits the first deferred settlement batch.
          </p>
        </div>
        <StatusBadge label={chainStatus} tone={chainTone(chainStatus)} />
      </div>

      <div className={styles.formGrid}>
        {props.walletAvailability === 'not_installed' ? (
          <div className={styles.infoBox}>
            Phantom is required for first sync. Install the browser extension, refresh the page, and
            connect the wallet you want to bind to this character.
          </div>
        ) : null}

        {mismatchMessage ? <div className={styles.errorBox}>{mismatchMessage}</div> : null}

        <div className={styles.keyValueGrid}>
          <div className={styles.keyValueItem}>
            <span className={styles.keyLabel}>Wallet authority</span>
            <span className={styles.keyValue}>{truncateMiddle(props.walletPublicKey)}</span>
          </div>
          <div className={styles.keyValueItem}>
            <span className={styles.keyLabel}>Latest battle status</span>
            <span className={styles.keyValue}>{props.character.latestBattle?.settlementStatus ?? 'No battle yet'}</span>
          </div>
        </div>

        {props.walletConnectionStatus !== 'connected' ? (
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonPrimary}`}
              onClick={() => void props.onConnectWallet()}
              disabled={buttonPending || props.walletAvailability !== 'installed'}
            >
              {props.walletConnectionStatus === 'connecting' ? 'Connecting...' : 'Connect Phantom'}
            </button>
          </div>
        ) : mismatchMessage ? null : preparedData ? (
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonPrimary}`}
              onClick={() => void signAndSubmit()}
              disabled={buttonPending}
            >
              {submitPending ? 'Submitting...' : 'Sign And Submit First Sync'}
            </button>
          </div>
        ) : authorizeData ? (
          <>
            <div className={styles.infoBox}>
              Phase 1 is ready. Phantom will now sign the authorization message and the app will ask
              the backend to build the final transaction payload.
            </div>
            <div className={styles.keyValueGrid}>
              <div className={styles.keyValueItem}>
                <span className={styles.keyLabel}>Batch ID</span>
                <span className={styles.keyValue}>{authorizeData.payload.batchId}</span>
              </div>
              <div className={styles.keyValueItem}>
                <span className={styles.keyLabel}>Battle count</span>
                <span className={styles.keyValue}>{authorizeData.payload.battleCount}</span>
              </div>
              <div className={styles.keyValueItem}>
                <span className={styles.keyLabel}>Season</span>
                <span className={styles.keyValue}>{authorizeData.payload.seasonId}</span>
              </div>
              <div className={styles.keyValueItem}>
                <span className={styles.keyLabel}>Batch hash</span>
                <span className={styles.keyValue}>{truncateMiddle(authorizeData.permitDomain.batchHash, 12)}</span>
              </div>
            </div>
            <div className={styles.buttonRow}>
              <button type="button" className={styles.button} onClick={() => void signAuthorization()} disabled={buttonPending}>
                {preparePending ? 'Requesting Signature...' : 'Sign Authorization'}
              </button>
            </div>
          </>
        ) : (
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonPrimary}`}
              onClick={() => void prepareAuthorize()}
              disabled={buttonPending || !props.walletPublicKey}
            >
              {preparePending ? 'Preparing...' : 'Prepare First Sync'}
            </button>
          </div>
        )}

        {preparedData ? (
          <div className={styles.successBox}>
            Transaction prepared. Phantom will sign the versioned transaction and the app will submit
            it to the backend broadcaster.
          </div>
        ) : null}

        {error ? <div className={styles.errorBox}>{error}</div> : null}
        {success ? <div className={styles.successBox}>{success}</div> : null}
      </div>
    </section>
  );
}

type SettlementPanelProps = {
  character: CharacterReadModel;
  walletAvailability: WalletAvailability;
  walletConnectionStatus: WalletConnectionStatus;
  walletActionStatus: WalletActionStatus;
  walletPublicKey: string | null;
  onConnectWallet: () => Promise<void>;
  setWalletActionStatus: (status: WalletActionStatus) => void;
  onRefresh: () => Promise<void>;
};

function SettlementPanel(props: SettlementPanelProps) {
  const [authorizeData, setAuthorizeData] = useState<SettlementPreparationBase | null>(null);
  const [preparedData, setPreparedData] = useState<SettlementPreparedPhase | null>(null);
  const [submitResult, setSubmitResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [preparePending, setPreparePending] = useState(false);
  const [submitPending, setSubmitPending] = useState(false);

  const nextBatch = props.character.nextSettlementBatch;
  const mismatchMessage = authorityMismatchMessage(props.character, props.walletPublicKey);
  const buttonPending = preparePending || submitPending || props.walletConnectionStatus === 'connecting';

  useEffect(() => {
    setAuthorizeData(null);
    setPreparedData(null);
    setSubmitResult(null);
    setError(null);
  }, [props.character.characterId, props.character.nextSettlementBatch?.settlementBatchId, props.walletPublicKey]);

  if (nextBatch === null) {
    return null;
  }

  async function prepareAuthorize() {
    if (!props.walletPublicKey) {
      setError('Connect Phantom before preparing settlement.');
      return;
    }

    setPreparePending(true);
    setError(null);

    try {
      const response = await apiRequest<SettlementPrepareResponse>('/api/solana/settlement/prepare', {
        method: 'POST',
        body: JSON.stringify({
          characterId: props.character.characterId,
          authority: props.walletPublicKey,
          feePayer: props.walletPublicKey,
        }),
      });

      if (response.phase !== 'authorize') {
        throw new Error('Unexpected settlement response: expected authorize phase.');
      }

      setAuthorizeData(response);
      setPreparedData(null);
      setSubmitResult(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to prepare settlement.');
    } finally {
      setPreparePending(false);
    }
  }

  async function signAuthorization() {
    if (authorizeData === null) {
      setError('Prepare authorization before requesting a Phantom signature.');
      return;
    }

    const provider = getPhantomProvider();
    if (provider === null) {
      setError('Phantom wallet is not installed.');
      return;
    }

    setPreparePending(true);
    setError(null);
    props.setWalletActionStatus('signing_message');

    try {
      if (authorizeData.payload.signatureScheme !== 1) {
        throw new Error(
          'This pending settlement batch uses the legacy manual signature scheme. Use the CLI fallback to complete it or reseal a fresh wallet-text batch.',
        );
      }
      const playerAuthorizationSignatureBase64 = await signAuthorizationMessageUtf8(
        provider,
        authorizeData.playerAuthorizationMessageUtf8,
      );
      const response = await apiRequest<SettlementPrepareResponse>('/api/solana/settlement/prepare', {
        method: 'POST',
        body: JSON.stringify({
          characterId: props.character.characterId,
          authority: props.walletPublicKey,
          feePayer: props.walletPublicKey,
          playerAuthorizationSignatureBase64,
        }),
      });

      if (response.phase !== 'sign_transaction') {
        throw new Error('Unexpected settlement response: expected sign_transaction phase.');
      }

      setAuthorizeData(response);
      setPreparedData(response);
      setSubmitResult(null);
    } catch (nextError) {
      setError(normalizeWalletError(nextError));
    } finally {
      props.setWalletActionStatus('idle');
      setPreparePending(false);
    }
  }

  async function signAndSubmit() {
    if (preparedData === null) {
      setError('Prepare the settlement transaction before requesting a Phantom signature.');
      return;
    }

    const provider = getPhantomProvider();
    if (provider === null) {
      setError('Phantom wallet is not installed.');
      return;
    }

    setSubmitPending(true);
    setError(null);
    props.setWalletActionStatus('signing_transaction');

    try {
      const signed = await signPreparedPlayerOwnedTransaction(provider, preparedData.preparedTransaction);
      const response = await apiRequest<unknown>('/api/solana/settlement/submit', {
        method: 'POST',
        body: JSON.stringify({
          settlementBatchId: preparedData.settlementBatchId,
          prepared: preparedData.preparedTransaction,
          signedMessageBase64: signed.signedMessageBase64,
          signedTransactionBase64: signed.signedTransactionBase64,
        }),
      });

      setSubmitResult(response);
      setAuthorizeData(null);
      setPreparedData(null);
      await props.onRefresh();
    } catch (nextError) {
      setError(normalizeWalletError(nextError));
    } finally {
      props.setWalletActionStatus('idle');
      setSubmitPending(false);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.panelTitleRow}>
        <div className={styles.stack}>
          <h2 className={styles.panelTitle}>Post-Sync Settlement</h2>
          <p className={styles.panelText}>
            Settle the next pending batch after the character is already confirmed on chain using the
            connected Phantom wallet.
          </p>
        </div>
        <StatusBadge label={nextBatch.status} tone={settlementTone(nextBatch.status)} />
      </div>

      <div className={styles.formGrid}>
        {props.walletAvailability === 'not_installed' ? (
          <div className={styles.infoBox}>
            Phantom is required for settlement. Install the extension, refresh the page, and connect
            the wallet bound to this character.
          </div>
        ) : null}

        {mismatchMessage ? <div className={styles.errorBox}>{mismatchMessage}</div> : null}

        <div className={styles.keyValueGrid}>
          <div className={styles.keyValueItem}>
            <span className={styles.keyLabel}>Batch ID</span>
            <span className={styles.keyValue}>{nextBatch.batchId}</span>
          </div>
          <div className={styles.keyValueItem}>
            <span className={styles.keyLabel}>Battle count</span>
            <span className={styles.keyValue}>{nextBatch.battleCount}</span>
          </div>
          <div className={styles.keyValueItem}>
            <span className={styles.keyLabel}>Nonce range</span>
            <span className={styles.keyValue}>
              {nextBatch.startNonce} - {nextBatch.endNonce}
            </span>
          </div>
          <div className={styles.keyValueItem}>
            <span className={styles.keyLabel}>Wallet authority</span>
            <span className={styles.keyValue}>{truncateMiddle(props.walletPublicKey)}</span>
          </div>
        </div>

        {props.walletConnectionStatus !== 'connected' ? (
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonPrimary}`}
              onClick={() => void props.onConnectWallet()}
              disabled={buttonPending || props.walletAvailability !== 'installed'}
            >
              {props.walletConnectionStatus === 'connecting' ? 'Connecting...' : 'Connect Phantom'}
            </button>
          </div>
        ) : mismatchMessage ? null : preparedData ? (
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonPrimary}`}
              onClick={() => void signAndSubmit()}
              disabled={buttonPending}
            >
              {submitPending ? 'Submitting...' : 'Sign And Submit Settlement'}
            </button>
          </div>
        ) : authorizeData ? (
          <>
            <div className={styles.infoBox}>
              Phase 1 is ready. Phantom will sign the settlement authorization message before the app
              requests the final transaction payload.
            </div>
            <div className={styles.buttonRow}>
              <button type="button" className={styles.button} onClick={() => void signAuthorization()} disabled={buttonPending}>
                {preparePending ? 'Requesting Signature...' : 'Sign Authorization'}
              </button>
            </div>
          </>
        ) : (
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonPrimary}`}
              onClick={() => void prepareAuthorize()}
              disabled={buttonPending || !props.walletPublicKey}
            >
              {preparePending ? 'Preparing...' : 'Prepare Settlement'}
            </button>
          </div>
        )}

        {preparedData ? (
          <div className={styles.successBox}>
            Settlement transaction prepared. Phantom will sign the transaction and the app will
            submit it to the backend broadcaster.
          </div>
        ) : null}

        {error ? <div className={styles.errorBox}>{error}</div> : null}
        {submitResult ? (
          <details className={styles.details}>
            <summary>Latest settlement result</summary>
            <pre className={styles.pre}>{JSON.stringify(submitResult, null, 2)}</pre>
          </details>
        ) : null}
      </div>
    </section>
  );
}

export default function GameClient() {
  const [appPhase, setAppPhase] = useState<AppPhase>('bootstrapping_user');
  const [userId, setUserId] = useState<string | null>(null);
  const [character, setCharacter] = useState<CharacterReadModel | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [createName, setCreateName] = useState('Rookie');
  const [selectedZoneId, setSelectedZoneId] = useState(1);
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [battlePending, setBattlePending] = useState(false);
  const [battleError, setBattleError] = useState<string | null>(null);
  const [refreshPending, setRefreshPending] = useState(false);
  const [latestEncounter, setLatestEncounter] = useState<EncounterResponse | null>(null);
  const [walletAvailability, setWalletAvailability] = useState<WalletAvailability>('unknown');
  const [walletConnectionStatus, setWalletConnectionStatus] = useState<WalletConnectionStatus>('checking_trusted');
  const [walletActionStatus, setWalletActionStatus] = useState<WalletActionStatus>('idle');
  const [walletPublicKey, setWalletPublicKey] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);

  const walletPending = walletConnectionStatus === 'connecting' || walletActionStatus !== 'idle';
  const expectedAuthority = character?.chain?.playerAuthorityPubkey ?? null;
  const walletAuthorityMismatch = useMemo(
    () => (character ? authorityMismatchMessage(character, walletPublicKey) : null),
    [character, walletPublicKey],
  );

  async function issueAnonymousUser(): Promise<string> {
    const created = await apiRequest<AnonymousUserResponse>('/api/auth/anon', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    window.localStorage.setItem(USER_STORAGE_KEY, created.userId);
    setUserId(created.userId);
    return created.userId;
  }

  async function refreshCharacter(nextUserId?: string) {
    const resolvedUserId = nextUserId ?? userId;

    if (!resolvedUserId) {
      throw new Error('No user id is available yet.');
    }

    setRefreshPending(true);

    try {
      const response = await apiRequest<CharacterQueryResponse>(
        `/api/character?userId=${encodeURIComponent(resolvedUserId)}`,
        { method: 'GET', headers: undefined },
      );
      setCharacter(response.character);
      setAppPhase('ready');
    } finally {
      setRefreshPending(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const storedUserId = window.localStorage.getItem(USER_STORAGE_KEY);
        let resolvedUserId = storedUserId;

        if (!resolvedUserId) {
          resolvedUserId = await issueAnonymousUser();
        }

        if (cancelled) {
          return;
        }

        setUserId(resolvedUserId);
        setAppPhase('loading_character');

        const response = await apiRequest<CharacterQueryResponse>(
          `/api/character?userId=${encodeURIComponent(resolvedUserId)}`,
          { method: 'GET', headers: undefined },
        );

        if (cancelled) {
          return;
        }

        setCharacter(response.character);
        setAppPhase('ready');
      } catch (error) {
        if (cancelled) {
          return;
        }
        setFatalError(error instanceof Error ? error.message : 'Failed to bootstrap the app.');
        setAppPhase('fatal_error');
      }
    }

    void initialize();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const availability = getWalletAvailability();
    setWalletAvailability(availability);

    if (availability !== 'installed') {
      setWalletConnectionStatus('disconnected');
      setWalletPublicKey(null);
      return;
    }

    let cancelled = false;
    setWalletConnectionStatus('checking_trusted');

    void connectPhantom({ onlyIfTrusted: true })
      .then(({ publicKey }) => {
        if (cancelled) {
          return;
        }
        setWalletPublicKey(publicKey);
        setWalletConnectionStatus('connected');
        setWalletError(null);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setWalletPublicKey(null);
        setWalletConnectionStatus('disconnected');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const provider = getPhantomProvider();
    if (provider === null || typeof provider.on !== 'function' || typeof provider.removeListener !== 'function') {
      return;
    }

    const handleConnect = () => {
      const publicKey = provider.publicKey?.toBase58() ?? null;
      setWalletPublicKey(publicKey);
      setWalletConnectionStatus(publicKey ? 'connected' : 'disconnected');
    };

    const handleDisconnect = () => {
      setWalletPublicKey(null);
      setWalletConnectionStatus('disconnected');
    };

    const handleAccountChanged = (...args: unknown[]) => {
      const [nextPublicKey] = args;
      if (
        nextPublicKey !== null &&
        typeof nextPublicKey === 'object' &&
        nextPublicKey !== undefined &&
        'toBase58' in nextPublicKey &&
        typeof (nextPublicKey as { toBase58?: unknown }).toBase58 === 'function'
      ) {
        setWalletPublicKey((nextPublicKey as { toBase58(): string }).toBase58());
        setWalletConnectionStatus('connected');
        return;
      }

      handleDisconnect();
    };

    provider.on('connect', handleConnect);
    provider.on('disconnect', handleDisconnect);
    provider.on('accountChanged', handleAccountChanged);

    return () => {
      provider.removeListener?.('connect', handleConnect);
      provider.removeListener?.('disconnect', handleDisconnect);
      provider.removeListener?.('accountChanged', handleAccountChanged);
    };
  }, []);

  useEffect(() => {
    const maxZone = maxUnlockedZone(character);
    if (selectedZoneId > maxZone) {
      setSelectedZoneId(maxZone);
    }
  }, [character, selectedZoneId]);

  async function handleConnectWallet() {
    setWalletConnectionStatus('connecting');
    setWalletError(null);

    try {
      const { publicKey } = await connectPhantom();
      setWalletPublicKey(publicKey);
      setWalletConnectionStatus('connected');
    } catch (error) {
      setWalletPublicKey(null);
      setWalletConnectionStatus('disconnected');
      setWalletError(normalizeWalletError(error));
    }
  }

  async function handleDisconnectWallet() {
    setWalletError(null);

    try {
      await disconnectPhantom();
    } catch (error) {
      setWalletError(normalizeWalletError(error));
    } finally {
      setWalletPublicKey(null);
      setWalletConnectionStatus('disconnected');
      setWalletActionStatus('idle');
    }
  }

  async function handleCreateCharacter() {
    if (!userId) {
      setCreateError('Cannot create a character before user bootstrap finishes.');
      return;
    }

    setCreatePending(true);
    setCreateError(null);

    try {
      let activeUserId = userId;

      try {
        await apiRequest<CreateCharacterResponse>('/api/character/create', {
          method: 'POST',
          body: JSON.stringify({
            userId: activeUserId,
            name: createName,
          }),
        });
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'User not found.') {
          throw error;
        }

        window.localStorage.removeItem(USER_STORAGE_KEY);
        activeUserId = await issueAnonymousUser();

        await apiRequest<CreateCharacterResponse>('/api/character/create', {
          method: 'POST',
          body: JSON.stringify({
            userId: activeUserId,
            name: createName,
          }),
        });
      }

      await refreshCharacter(activeUserId);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Failed to create character.');
    } finally {
      setCreatePending(false);
    }
  }

  async function handleBattle() {
    if (!character) {
      setBattleError('Create a character before starting a battle.');
      return;
    }

    setBattlePending(true);
    setBattleError(null);

    try {
      const response = await apiRequest<EncounterResponse>('/api/combat/encounter', {
        method: 'POST',
        body: JSON.stringify({
          characterId: character.characterId,
          zoneId: selectedZoneId,
        }),
      });

      setLatestEncounter(response);
      await refreshCharacter(character.userId);
    } catch (error) {
      setBattleError(error instanceof Error ? error.message : 'Failed to run battle.');
    } finally {
      setBattlePending(false);
    }
  }

  if (appPhase === 'bootstrapping_user' || appPhase === 'loading_character') {
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <header className={styles.header}>
            <span className={styles.eyebrow}>Keep Pushing</span>
            <h1 className={styles.title}>Bootstrapping local-first gameplay</h1>
            <p className={styles.subtitle}>
              Preparing the backend user, checking Phantom, and loading the current character read model.
            </p>
          </header>

          <div className={styles.panelGrid}>
            <section className={styles.panel}>
              <div className={styles.stack}>
                <div className={styles.skeletonLine} />
                <div className={styles.skeletonLine} />
                <div className={styles.skeletonPanel} />
              </div>
            </section>
          </div>
        </div>
      </main>
    );
  }

  if (appPhase === 'fatal_error') {
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <header className={styles.header}>
            <span className={styles.eyebrow}>Keep Pushing</span>
            <h1 className={styles.title}>Frontend bootstrap failed</h1>
            <p className={styles.subtitle}>
              The app could not complete anonymous user bootstrap or load the current character.
            </p>
          </header>

          <section className={styles.panel}>
            <div className={styles.errorBox}>{fatalError ?? 'Unknown error.'}</div>
            <div className={styles.buttonRow}>
              <button
                type="button"
                className={`${styles.button} ${styles.buttonPrimary}`}
                onClick={() => window.location.reload()}
              >
                Reload App
              </button>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <span className={styles.eyebrow}>Keep Pushing</span>
          <h1 className={styles.title}>Local-first battle and sync dashboard</h1>
          <p className={styles.subtitle}>
            Create a character, run real battles immediately, then move deferred results on chain
            through Phantom-driven first sync and later settlement batches.
          </p>

          <div className={styles.toolbar}>
            <span className={styles.metaText}>User ID: {truncateMiddle(userId)}</span>
            <WalletToolbar
              availability={walletAvailability}
              connectionStatus={walletConnectionStatus}
              actionStatus={walletActionStatus}
              publicKey={walletPublicKey}
              error={walletError}
              pending={walletPending}
              onConnect={handleConnectWallet}
              onDisconnect={handleDisconnectWallet}
            />
            {refreshPending ? <StatusBadge label="Refreshing state" tone="info" /> : null}
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                if (userId) {
                  void refreshCharacter(userId);
                }
              }}
              disabled={refreshPending || !userId}
            >
              Refresh Read Model
            </button>
          </div>
        </header>

        {character === null ? (
          <CreateCharacterPanel
            name={createName}
            pending={createPending}
            error={createError}
            onNameChange={setCreateName}
            onSubmit={handleCreateCharacter}
          />
        ) : (
          <div className={styles.dashboardGrid}>
            <div className={styles.panelGrid}>
              <section className={styles.panel}>
                <div className={styles.panelTitleRow}>
                  <div className={styles.stack}>
                    <h2 className={styles.panelTitle}>{character.name}</h2>
                    <p className={styles.panelText}>
                      Level {character.level} character. Primary dashboard action: {primaryActionLabel(character)}.
                    </p>
                  </div>
                  <StatusBadge
                    label={character.chain?.chainCreationStatus ?? 'NOT_STARTED'}
                    tone={chainTone(character.chain?.chainCreationStatus ?? 'NOT_STARTED')}
                  />
                </div>

                <div className={styles.keyValueGrid}>
                  <div className={styles.keyValueItem}>
                    <span className={styles.keyLabel}>Character ID</span>
                    <span className={styles.keyValue}>{character.characterId}</span>
                  </div>
                  <div className={styles.keyValueItem}>
                    <span className={styles.keyLabel}>Experience</span>
                    <span className={styles.keyValue}>{character.exp}</span>
                  </div>
                  <div className={styles.keyValueItem}>
                    <span className={styles.keyLabel}>HP</span>
                    <span className={styles.keyValue}>
                      {character.stats.hp}/{character.stats.hpMax}
                    </span>
                  </div>
                  <div className={styles.keyValueItem}>
                    <span className={styles.keyLabel}>Atk / Def / Spd</span>
                    <span className={styles.keyValue}>
                      {character.stats.atk} / {character.stats.def} / {character.stats.spd}
                    </span>
                  </div>
                  <div className={styles.keyValueItem}>
                    <span className={styles.keyLabel}>Active skills</span>
                    <span className={styles.keyValue}>{character.activeSkills.join(', ')}</span>
                  </div>
                  <div className={styles.keyValueItem}>
                    <span className={styles.keyLabel}>Passives</span>
                    <span className={styles.keyValue}>{character.passiveSkills.join(', ')}</span>
                  </div>
                </div>
              </section>

              <section className={styles.panel}>
                <div className={styles.panelTitleRow}>
                  <div className={styles.stack}>
                    <h2 className={styles.panelTitle}>Battle</h2>
                    <p className={styles.panelText}>
                      Run a persisted encounter. The backend generates the battle seed and stores the
                      result immediately.
                    </p>
                  </div>
                  {character.latestBattle ? (
                    <StatusBadge
                      label={character.latestBattle.settlementStatus}
                      tone={settlementTone(character.latestBattle.settlementStatus)}
                    />
                  ) : null}
                </div>

                <div className={styles.formGrid}>
                  <label className={styles.field}>
                    <span className={styles.label}>Zone</span>
                    <select
                      className={styles.select}
                      value={selectedZoneId}
                      onChange={(event) => setSelectedZoneId(Number(event.target.value))}
                      disabled={battlePending}
                    >
                      {Array.from({ length: maxUnlockedZone(character) }, (_, index) => index + 1).map((zoneId) => (
                        <option key={zoneId} value={zoneId}>
                          Zone {zoneId}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className={styles.buttonRow}>
                    <button
                      type="button"
                      className={`${styles.button} ${styles.buttonPrimary}`}
                      onClick={handleBattle}
                      disabled={battlePending}
                    >
                      {battlePending ? 'Running Battle...' : 'Battle'}
                    </button>
                  </div>

                  {battleError ? <div className={styles.errorBox}>{battleError}</div> : null}

                  {latestEncounter ? (
                    <div className={styles.stack}>
                      <div className={styles.successBox}>
                        Latest encounter persisted with seed {latestEncounter.seed} and settlement
                        status {latestEncounter.settlementStatus}.
                      </div>
                      <BattleReplay result={latestEncounter.battleResult} />
                    </div>
                  ) : (
                    <div className={styles.infoBox}>
                      No new encounter has been run in this session yet. The latest persisted ledger
                      status is still visible in the dashboard panels.
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div className={styles.panelGrid}>
              <section className={styles.panel}>
                <div className={styles.panelTitleRow}>
                  <div className={styles.stack}>
                    <h2 className={styles.panelTitle}>Chain and progression</h2>
                    <p className={styles.panelText}>
                      Read-model snapshot for chain identity, progression, and latest persisted
                      battle/settlement state.
                    </p>
                  </div>
                </div>

                <div className={styles.stack}>
                  <div className={styles.inlineStack}>
                    <StatusBadge
                      label={character.chain?.chainCreationStatus ?? 'NOT_STARTED'}
                      tone={chainTone(character.chain?.chainCreationStatus ?? 'NOT_STARTED')}
                    />
                    {character.nextSettlementBatch ? (
                      <StatusBadge
                        label={`Batch ${character.nextSettlementBatch.status}`}
                        tone={settlementTone(character.nextSettlementBatch.status)}
                      />
                    ) : null}
                    {walletPublicKey ? (
                      <StatusBadge label={`Wallet ${truncateMiddle(walletPublicKey)}`} tone="info" />
                    ) : null}
                  </div>

                  {walletAuthorityMismatch ? <div className={styles.errorBox}>{walletAuthorityMismatch}</div> : null}

                  <div className={styles.keyValueGrid}>
                    <div className={styles.keyValueItem}>
                      <span className={styles.keyLabel}>Expected authority</span>
                      <span className={styles.keyValue}>{truncateMiddle(expectedAuthority)}</span>
                    </div>
                    <div className={styles.keyValueItem}>
                      <span className={styles.keyLabel}>Character root</span>
                      <span className={styles.keyValue}>
                        {truncateMiddle(character.chain?.characterRootPubkey)}
                      </span>
                    </div>
                    <div className={styles.keyValueItem}>
                      <span className={styles.keyLabel}>Created on chain</span>
                      <span className={styles.keyValue}>{formatDateTime(character.chain?.chainCreatedAt ?? null)}</span>
                    </div>
                    <div className={styles.keyValueItem}>
                      <span className={styles.keyLabel}>Last reconciled battle</span>
                      <span className={styles.keyValue}>
                        {formatUnixTimestamp(character.chain?.cursor?.lastReconciledBattleTs ?? null)}
                      </span>
                    </div>
                    <div className={styles.keyValueItem}>
                      <span className={styles.keyLabel}>Highest unlocked zone</span>
                      <span className={styles.keyValue}>
                        {character.provisionalProgress?.highestUnlockedZoneId ?? 'Not available'}
                      </span>
                    </div>
                    <div className={styles.keyValueItem}>
                      <span className={styles.keyLabel}>Highest cleared zone</span>
                      <span className={styles.keyValue}>
                        {character.provisionalProgress?.highestClearedZoneId ?? 'Not available'}
                      </span>
                    </div>
                  </div>

                  {character.latestBattle ? (
                    <>
                      <div className={styles.divider} />
                      <div className={styles.stack}>
                        <h3 className={styles.panelTitle}>Latest battle summary</h3>
                        <div className={styles.keyValueGrid}>
                          <div className={styles.keyValueItem}>
                            <span className={styles.keyLabel}>Battle ID</span>
                            <span className={styles.keyValue}>{character.latestBattle.battleId}</span>
                          </div>
                          <div className={styles.keyValueItem}>
                            <span className={styles.keyLabel}>Zone / Enemy</span>
                            <span className={styles.keyValue}>
                              Zone {character.latestBattle.zoneId} / Enemy {character.latestBattle.enemyArchetypeId}
                            </span>
                          </div>
                          <div className={styles.keyValueItem}>
                            <span className={styles.keyLabel}>Battle time</span>
                            <span className={styles.keyValue}>{formatUnixTimestamp(character.latestBattle.battleTs)}</span>
                          </div>
                          <div className={styles.keyValueItem}>
                            <span className={styles.keyLabel}>Settlement status</span>
                            <span className={styles.keyValue}>{character.latestBattle.settlementStatus}</span>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className={styles.infoBox}>No battle has been persisted yet.</div>
                  )}
                </div>
              </section>

              {(character.chain?.chainCreationStatus ?? 'NOT_STARTED') !== 'CONFIRMED' ? (
                <FirstSyncPanel
                  character={character}
                  walletAvailability={walletAvailability}
                  walletConnectionStatus={walletConnectionStatus}
                  walletActionStatus={walletActionStatus}
                  walletPublicKey={walletPublicKey}
                  onConnectWallet={handleConnectWallet}
                  setWalletActionStatus={setWalletActionStatus}
                  onRefresh={() => refreshCharacter(character.userId)}
                />
              ) : null}

              {(character.chain?.chainCreationStatus ?? 'NOT_STARTED') === 'CONFIRMED' &&
              character.nextSettlementBatch !== null ? (
                <SettlementPanel
                  character={character}
                  walletAvailability={walletAvailability}
                  walletConnectionStatus={walletConnectionStatus}
                  walletActionStatus={walletActionStatus}
                  walletPublicKey={walletPublicKey}
                  onConnectWallet={handleConnectWallet}
                  setWalletActionStatus={setWalletActionStatus}
                  onRefresh={() => refreshCharacter(character.userId)}
                />
              ) : null}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
