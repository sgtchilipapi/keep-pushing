'use client';

import { useEffect, useState } from 'react';

import type { FirstSyncPreparedPhase, FirstSyncPreparationBase, PreparedPlayerOwnedTransaction, SettlementPreparedPhase, SettlementPreparationBase } from '../../types/api/solana';
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

const USER_STORAGE_KEY = 'keep-pushing:user-id';

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

function jsonPreview(value: unknown): string {
  return JSON.stringify(value, null, 2);
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

type FirstSyncPanelProps = {
  character: CharacterReadModel;
  onRefresh: () => Promise<void>;
};

function FirstSyncPanel({ character, onRefresh }: FirstSyncPanelProps) {
  const [authority, setAuthority] = useState(character.chain?.playerAuthorityPubkey ?? '');
  const [feePayer, setFeePayer] = useState(character.chain?.playerAuthorityPubkey ?? '');
  const [playerAuthorizationSignature, setPlayerAuthorizationSignature] = useState('');
  const [signedMessageBase64, setSignedMessageBase64] = useState('');
  const [signedTransactionBase64, setSignedTransactionBase64] = useState('');
  const [authorizeData, setAuthorizeData] = useState<FirstSyncPreparationBase | null>(null);
  const [preparedData, setPreparedData] = useState<FirstSyncPreparedPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [preparePending, setPreparePending] = useState(false);
  const [submitPending, setSubmitPending] = useState(false);

  useEffect(() => {
    const nextAuthority = character.chain?.playerAuthorityPubkey ?? '';
    setAuthority(nextAuthority);
    setFeePayer(nextAuthority);
    setPlayerAuthorizationSignature('');
    setSignedMessageBase64('');
    setSignedTransactionBase64('');
    setAuthorizeData(null);
    setPreparedData(null);
    setError(null);
    setSuccess(null);
  }, [character.characterId, character.chain?.playerAuthorityPubkey, character.chain?.chainCreationStatus]);

  async function prepareAuthorize() {
    setPreparePending(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await apiRequest<FirstSyncPrepareResponse>('/api/solana/character/first-sync/prepare', {
        method: 'POST',
        body: JSON.stringify({
          characterId: character.characterId,
          authority,
          feePayer: feePayer || authority,
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

  async function prepareTransaction() {
    setPreparePending(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await apiRequest<FirstSyncPrepareResponse>('/api/solana/character/first-sync/prepare', {
        method: 'POST',
        body: JSON.stringify({
          characterId: character.characterId,
          authority,
          feePayer: feePayer || authority,
          playerAuthorizationSignatureBase64: playerAuthorizationSignature,
        }),
      });

      if (response.phase !== 'sign_transaction') {
        throw new Error('Unexpected prepare response: expected sign_transaction phase.');
      }

      setAuthorizeData(response);
      setPreparedData(response);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to prepare first-sync transaction.');
    } finally {
      setPreparePending(false);
    }
  }

  async function submit() {
    if (preparedData === null) {
      setError('Prepare the transaction before submitting first sync.');
      return;
    }

    setSubmitPending(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await apiRequest<{
        transactionSignature: string;
        chainCharacterIdHex: string;
        characterRootPubkey: string;
      }>('/api/solana/character/first-sync/submit', {
        method: 'POST',
        body: JSON.stringify({
          prepared: preparedData.preparedTransaction,
          signedMessageBase64,
          signedTransactionBase64,
        }),
      });

      setSuccess(
        `First sync confirmed. Tx ${truncateMiddle(response.transactionSignature)} | Character ${truncateMiddle(response.characterRootPubkey)}`,
      );
      setPreparedData(null);
      setAuthorizeData(null);
      setPlayerAuthorizationSignature('');
      setSignedMessageBase64('');
      setSignedTransactionBase64('');
      await onRefresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to submit first sync.');
    } finally {
      setSubmitPending(false);
    }
  }

  const chainStatus = character.chain?.chainCreationStatus ?? 'NOT_STARTED';

  return (
    <section className={styles.panel}>
      <div className={styles.panelTitleRow}>
        <div className={styles.stack}>
          <h2 className={styles.panelTitle}>First Sync</h2>
          <p className={styles.panelText}>
            Use this panel when your character has local battle backlog that still needs to be
            committed on chain. This implementation uses manual wallet fields because the repo does
            not yet include a wallet adapter integration.
          </p>
        </div>
        <StatusBadge label={chainStatus} tone={chainTone(chainStatus)} />
      </div>

      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span className={styles.label}>Authority public key</span>
          <input
            className={styles.input}
            value={authority}
            onChange={(event) => {
              setAuthority(event.target.value);
              if (feePayer.length === 0 || feePayer === authority) {
                setFeePayer(event.target.value);
              }
            }}
            placeholder="Player wallet base58 public key"
            disabled={preparePending || submitPending}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Fee payer public key</span>
          <input
            className={styles.input}
            value={feePayer}
            onChange={(event) => setFeePayer(event.target.value)}
            placeholder="Defaults to authority"
            disabled={preparePending || submitPending}
          />
        </label>

        <div className={styles.buttonRow}>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary}`}
            onClick={prepareAuthorize}
            disabled={preparePending || submitPending || authority.trim().length === 0}
          >
            {preparePending ? 'Preparing...' : 'Prepare Authorization'}
          </button>
        </div>

        {authorizeData ? (
          <>
            <div className={styles.infoBox}>
              Sign the authorization message with the same wallet that owns the provided authority.
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
            <label className={styles.field}>
              <span className={styles.label}>Authorization message (base64)</span>
              <textarea className={styles.textarea} value={authorizeData.playerAuthorizationMessageBase64} readOnly />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Player authorization signature (base64)</span>
              <textarea
                className={styles.textarea}
                value={playerAuthorizationSignature}
                onChange={(event) => setPlayerAuthorizationSignature(event.target.value)}
                placeholder="Paste the wallet signature here"
                disabled={preparePending || submitPending}
              />
            </label>

            <div className={styles.buttonRow}>
              <button
                type="button"
                className={styles.button}
                onClick={prepareTransaction}
                disabled={preparePending || submitPending || playerAuthorizationSignature.trim().length === 0}
              >
                {preparePending ? 'Preparing Transaction...' : 'Prepare Transaction'}
              </button>
            </div>
          </>
        ) : null}

        {preparedData ? (
          <>
            <div className={styles.successBox}>
              Prepared atomic first-sync transaction. Sign the serialized transaction bytes and then
              submit the signed payload below.
            </div>

            <label className={styles.field}>
              <span className={styles.label}>Signed message (base64)</span>
              <textarea
                className={styles.textarea}
                value={signedMessageBase64}
                onChange={(event) => setSignedMessageBase64(event.target.value)}
                placeholder="Paste the signed message bytes here"
                disabled={submitPending}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Signed transaction (base64)</span>
              <textarea
                className={styles.textarea}
                value={signedTransactionBase64}
                onChange={(event) => setSignedTransactionBase64(event.target.value)}
                placeholder="Paste the signed transaction bytes here"
                disabled={submitPending}
              />
            </label>

            <div className={styles.buttonRow}>
              <button
                type="button"
                className={`${styles.button} ${styles.buttonPrimary}`}
                onClick={submit}
                disabled={
                  submitPending ||
                  signedMessageBase64.trim().length === 0 ||
                  signedTransactionBase64.trim().length === 0
                }
              >
                {submitPending ? 'Submitting...' : 'Submit First Sync'}
              </button>
            </div>

            <details className={styles.details}>
              <summary>Prepared transaction details</summary>
              <pre className={styles.pre}>{jsonPreview(preparedData.preparedTransaction)}</pre>
            </details>
          </>
        ) : null}

        {error ? <div className={styles.errorBox}>{error}</div> : null}
        {success ? <div className={styles.successBox}>{success}</div> : null}
      </div>
    </section>
  );
}

type SettlementPanelProps = {
  character: CharacterReadModel;
  onRefresh: () => Promise<void>;
};

function SettlementPanel({ character, onRefresh }: SettlementPanelProps) {
  const [authority, setAuthority] = useState(character.chain?.playerAuthorityPubkey ?? '');
  const [feePayer, setFeePayer] = useState(character.chain?.playerAuthorityPubkey ?? '');
  const [playerAuthorizationSignature, setPlayerAuthorizationSignature] = useState('');
  const [signedMessageBase64, setSignedMessageBase64] = useState('');
  const [signedTransactionBase64, setSignedTransactionBase64] = useState('');
  const [authorizeData, setAuthorizeData] = useState<SettlementPreparationBase | null>(null);
  const [preparedData, setPreparedData] = useState<SettlementPreparedPhase | null>(null);
  const [submitResult, setSubmitResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [preparePending, setPreparePending] = useState(false);
  const [submitPending, setSubmitPending] = useState(false);

  useEffect(() => {
    const nextAuthority = character.chain?.playerAuthorityPubkey ?? '';
    setAuthority(nextAuthority);
    setFeePayer(nextAuthority);
    setPlayerAuthorizationSignature('');
    setSignedMessageBase64('');
    setSignedTransactionBase64('');
    setAuthorizeData(null);
    setPreparedData(null);
    setSubmitResult(null);
    setError(null);
  }, [character.characterId, character.chain?.playerAuthorityPubkey, character.nextSettlementBatch?.settlementBatchId]);

  async function prepareAuthorize() {
    setPreparePending(true);
    setError(null);

    try {
      const response = await apiRequest<SettlementPrepareResponse>('/api/solana/settlement/prepare', {
        method: 'POST',
        body: JSON.stringify({
          characterId: character.characterId,
          authority,
          feePayer: feePayer || authority,
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

  async function prepareTransaction() {
    setPreparePending(true);
    setError(null);

    try {
      const response = await apiRequest<SettlementPrepareResponse>('/api/solana/settlement/prepare', {
        method: 'POST',
        body: JSON.stringify({
          characterId: character.characterId,
          authority,
          feePayer: feePayer || authority,
          playerAuthorizationSignatureBase64: playerAuthorizationSignature,
        }),
      });

      if (response.phase !== 'sign_transaction') {
        throw new Error('Unexpected settlement response: expected sign_transaction phase.');
      }

      setAuthorizeData(response);
      setPreparedData(response);
      setSubmitResult(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to prepare settlement transaction.');
    } finally {
      setPreparePending(false);
    }
  }

  async function submit() {
    if (preparedData === null) {
      setError('Prepare the settlement transaction before submitting it.');
      return;
    }

    setSubmitPending(true);
    setError(null);

    try {
      const response = await apiRequest<unknown>('/api/solana/settlement/submit', {
        method: 'POST',
        body: JSON.stringify({
          settlementBatchId: preparedData.settlementBatchId,
          prepared: preparedData.preparedTransaction,
          signedMessageBase64,
          signedTransactionBase64,
        }),
      });

      setSubmitResult(response);
      setPreparedData(null);
      setAuthorizeData(null);
      setPlayerAuthorizationSignature('');
      setSignedMessageBase64('');
      setSignedTransactionBase64('');
      await onRefresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to submit settlement.');
    } finally {
      setSubmitPending(false);
    }
  }

  const nextBatch = character.nextSettlementBatch;

  if (nextBatch === null) {
    return null;
  }

  return (
    <section className={styles.panel}>
      <div className={styles.panelTitleRow}>
        <div className={styles.stack}>
          <h2 className={styles.panelTitle}>Post-Sync Settlement</h2>
          <p className={styles.panelText}>
            Settle the next pending batch after the character is already confirmed on chain.
          </p>
        </div>
        <StatusBadge label={nextBatch.status} tone={settlementTone(nextBatch.status)} />
      </div>

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
          <span className={styles.keyLabel}>Season</span>
          <span className={styles.keyValue}>{nextBatch.seasonId}</span>
        </div>
      </div>

      <div className={styles.divider} />

      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span className={styles.label}>Authority public key</span>
          <input
            className={styles.input}
            value={authority}
            onChange={(event) => {
              setAuthority(event.target.value);
              if (feePayer.length === 0 || feePayer === authority) {
                setFeePayer(event.target.value);
              }
            }}
            placeholder="Player wallet base58 public key"
            disabled={preparePending || submitPending}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Fee payer public key</span>
          <input
            className={styles.input}
            value={feePayer}
            onChange={(event) => setFeePayer(event.target.value)}
            placeholder="Defaults to authority"
            disabled={preparePending || submitPending}
          />
        </label>

        <div className={styles.buttonRow}>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary}`}
            onClick={prepareAuthorize}
            disabled={preparePending || submitPending || authority.trim().length === 0}
          >
            {preparePending ? 'Preparing...' : 'Prepare Settlement Authorization'}
          </button>
        </div>

        {authorizeData ? (
          <>
            <label className={styles.field}>
              <span className={styles.label}>Authorization message (base64)</span>
              <textarea className={styles.textarea} value={authorizeData.playerAuthorizationMessageBase64} readOnly />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Player authorization signature (base64)</span>
              <textarea
                className={styles.textarea}
                value={playerAuthorizationSignature}
                onChange={(event) => setPlayerAuthorizationSignature(event.target.value)}
                placeholder="Paste the wallet signature here"
                disabled={preparePending || submitPending}
              />
            </label>
            <div className={styles.buttonRow}>
              <button
                type="button"
                className={styles.button}
                onClick={prepareTransaction}
                disabled={preparePending || submitPending || playerAuthorizationSignature.trim().length === 0}
              >
                {preparePending ? 'Preparing Transaction...' : 'Prepare Settlement Transaction'}
              </button>
            </div>
          </>
        ) : null}

        {preparedData ? (
          <>
            <label className={styles.field}>
              <span className={styles.label}>Signed message (base64)</span>
              <textarea
                className={styles.textarea}
                value={signedMessageBase64}
                onChange={(event) => setSignedMessageBase64(event.target.value)}
                placeholder="Paste the signed message bytes here"
                disabled={submitPending}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Signed transaction (base64)</span>
              <textarea
                className={styles.textarea}
                value={signedTransactionBase64}
                onChange={(event) => setSignedTransactionBase64(event.target.value)}
                placeholder="Paste the signed transaction bytes here"
                disabled={submitPending}
              />
            </label>

            <div className={styles.buttonRow}>
              <button
                type="button"
                className={`${styles.button} ${styles.buttonPrimary}`}
                onClick={submit}
                disabled={
                  submitPending ||
                  signedMessageBase64.trim().length === 0 ||
                  signedTransactionBase64.trim().length === 0
                }
              >
                {submitPending ? 'Submitting...' : 'Submit Settlement'}
              </button>
            </div>

            <details className={styles.details}>
              <summary>Prepared settlement transaction</summary>
              <pre className={styles.pre}>{jsonPreview(preparedData.preparedTransaction)}</pre>
            </details>
          </>
        ) : null}

        {error ? <div className={styles.errorBox}>{error}</div> : null}
        {submitResult ? (
          <details className={styles.details}>
            <summary>Latest settlement result</summary>
            <pre className={styles.pre}>{jsonPreview(submitResult)}</pre>
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
          const created = await apiRequest<AnonymousUserResponse>('/api/auth/anon', {
            method: 'POST',
            body: JSON.stringify({}),
          });
          resolvedUserId = created.userId;
          window.localStorage.setItem(USER_STORAGE_KEY, resolvedUserId);
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
    const maxZone = maxUnlockedZone(character);
    if (selectedZoneId > maxZone) {
      setSelectedZoneId(maxZone);
    }
  }, [character, selectedZoneId]);

  async function handleCreateCharacter() {
    if (!userId) {
      setCreateError('Cannot create a character before user bootstrap finishes.');
      return;
    }

    setCreatePending(true);
    setCreateError(null);

    try {
      await apiRequest<CreateCharacterResponse>('/api/character/create', {
        method: 'POST',
        body: JSON.stringify({
          userId,
          name: createName,
        }),
      });

      await refreshCharacter(userId);
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
              Preparing the backend user and loading the current character read model.
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
            through first sync and later settlement batches.
          </p>

          <div className={styles.toolbar}>
            <span className={styles.metaText}>User ID: {truncateMiddle(userId)}</span>
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
                  </div>

                  <div className={styles.keyValueGrid}>
                    <div className={styles.keyValueItem}>
                      <span className={styles.keyLabel}>Authority</span>
                      <span className={styles.keyValue}>
                        {truncateMiddle(character.chain?.playerAuthorityPubkey)}
                      </span>
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
                <FirstSyncPanel character={character} onRefresh={() => refreshCharacter(character.userId)} />
              ) : null}

              {(character.chain?.chainCreationStatus ?? 'NOT_STARTED') === 'CONFIRMED' &&
              character.nextSettlementBatch !== null ? (
                <SettlementPanel character={character} onRefresh={() => refreshCharacter(character.userId)} />
              ) : null}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
