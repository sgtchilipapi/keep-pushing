"use client";

import { useEffect, useMemo, useState } from "react";

import type {
  PrepareCharacterCreationRouteResponse,
  SettlementPreparedPhase,
  SettlementPreparationBase,
  SubmitCharacterCreationRouteResponse,
} from "../../types/api/solana";
import type {
  AnonymousUserResponse,
  CharacterQueryResponse,
  CharacterReadModel,
  CreateCharacterResponse,
  EncounterResponse,
  SettlementPrepareResponse,
} from "../../types/api/frontend";
import BattleReplay from "../BattleReplay";
import StatusBadge from "./StatusBadge";
import styles from "./game-shell.module.css";
import {
  resolveEffectiveSeason,
  resolvePassiveNames,
  resolveSkillNames,
  resolveSyncPanelState,
} from "./uiModel";
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
} from "../../lib/solana/phantomBrowser";

const USER_STORAGE_KEY = "keep-pushing:user-id";
const PHANTOM_INSTALL_URL = "https://phantom.app/download";

type AppPhase =
  | "bootstrapping_user"
  | "loading_character"
  | "ready"
  | "fatal_error";

type ApiErrorShape = {
  error?: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function apiRequest<T>(
  input: RequestInfo,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const data = (await response.json().catch(() => null)) as
    | T
    | ApiErrorShape
    | null;

  if (!response.ok) {
    const message =
      isObject(data) && typeof data.error === "string"
        ? data.error
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return data as T;
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "Not available";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatUnixTimestamp(value: number | null): string {
  if (value === null) {
    return "Not available";
  }

  return new Date(value * 1000).toLocaleString();
}

function truncateMiddle(value: string | null | undefined, edge = 8): string {
  if (!value) {
    return "Not available";
  }

  if (value.length <= edge * 2 + 3) {
    return value;
  }

  return `${value.slice(0, edge)}...${value.slice(-edge)}`;
}

function settlementTone(
  status: string | null | undefined,
): "neutral" | "warning" | "success" | "danger" | "info" {
  switch (status) {
    case "COMMITTED":
    case "CONFIRMED":
      return "success";
    case "FAILED":
    case "LOCAL_ONLY_ARCHIVED":
      return "danger";
    case "SUBMITTED":
      return "info";
    case "AWAITING_FIRST_SYNC":
    case "SEALED":
    case "PENDING":
    case "PREPARED":
      return "warning";
    default:
      return "neutral";
  }
}

function walletAvailabilityTone(
  status: WalletAvailability,
): "neutral" | "warning" | "success" {
  switch (status) {
    case "installed":
      return "success";
    case "not_installed":
      return "warning";
    case "unknown":
    default:
      return "neutral";
  }
}

function walletConnectionTone(
  status: WalletConnectionStatus,
): "neutral" | "warning" | "success" | "info" {
  switch (status) {
    case "connected":
      return "success";
    case "connecting":
    case "checking_trusted":
      return "info";
    case "disconnected":
    default:
      return "neutral";
  }
}

function walletActionLabel(status: WalletActionStatus): string | null {
  switch (status) {
    case "signing_message":
      return "Signing message";
    case "signing_transaction":
      return "Signing transaction";
    case "idle":
    default:
      return null;
  }
}

function maxUnlockedZone(character: CharacterReadModel | null): number {
  return Math.max(
    1,
    character?.provisionalProgress?.highestUnlockedZoneId ?? 1,
  );
}

function authorityMismatchMessage(
  character: CharacterReadModel,
  walletPublicKey: string | null,
): string | null {
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
            Create the local character first, then use Phantom to create the
            matching on-chain character before battles begin.
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

        {props.error ? (
          <div className={styles.errorBox}>{props.error}</div>
        ) : null}

        <div className={styles.buttonRow}>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary}`}
            onClick={props.onSubmit}
            disabled={props.pending}
          >
            {props.pending ? "Creating Character..." : "Create Character"}
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
  userId: string | null;
  publicKey: string | null;
  error: string | null;
  pending: boolean;
  refreshPending: boolean;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  onRefresh: () => void;
};

function WalletToolbar(props: WalletToolbarProps) {
  const actionLabel = walletActionLabel(props.actionStatus);
  const walletStatusLabel =
    props.connectionStatus === "connected"
      ? `Wallet ${truncateMiddle(props.publicKey)}`
      : props.availability === "installed"
        ? "Wallet disconnected"
        : "Phantom not installed";

  return (
    <div className={styles.menuWrap}>
      <details className={styles.menu}>
        <summary className={styles.menuSummary}>
          <span>Session</span>
          <StatusBadge
            label={walletStatusLabel}
            tone={
              props.connectionStatus === "connected"
                ? "success"
                : walletAvailabilityTone(props.availability)
            }
          />
          {actionLabel ? <StatusBadge label={actionLabel} tone="info" /> : null}
        </summary>

        <div className={styles.menuContent}>
          <div className={styles.keyValueGrid}>
            <div className={styles.keyValueItem}>
              <span className={styles.keyLabel}>User</span>
              <span className={styles.keyValue}>
                {truncateMiddle(props.userId)}
              </span>
            </div>
            <div className={styles.keyValueItem}>
              <span className={styles.keyLabel}>Wallet</span>
              <span className={styles.keyValue}>
                {truncateMiddle(props.publicKey)}
              </span>
            </div>
          </div>

          <div className={styles.buttonRow}>
            {props.availability === "not_installed" ? (
              <a
                className={styles.button}
                href={PHANTOM_INSTALL_URL}
                target="_blank"
                rel="noreferrer"
              >
                Install Phantom
              </a>
            ) : props.connectionStatus === "connected" ? (
              <button
                type="button"
                className={styles.button}
                onClick={() => void props.onDisconnect()}
                disabled={props.pending}
              >
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                className={styles.button}
                onClick={() => void props.onConnect()}
                disabled={props.pending || props.availability !== "installed"}
              >
                {props.connectionStatus === "connecting"
                  ? "Connecting..."
                  : "Connect Phantom"}
              </button>
            )}

            <button
              type="button"
              className={styles.button}
              onClick={props.onRefresh}
              disabled={props.refreshPending || !props.userId}
            >
              Refresh
            </button>
          </div>
        </div>
      </details>

      {props.error ? (
        <div className={styles.errorBox}>{props.error}</div>
      ) : null}
    </div>
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
  onRefresh: () => Promise<CharacterReadModel | null>;
};

function SettlementPanel(props: SettlementPanelProps) {
  const [authorizeData, setAuthorizeData] =
    useState<SettlementPreparationBase | null>(null);
  const [preparedData, setPreparedData] =
    useState<SettlementPreparedPhase | null>(null);
  const [submitResult, setSubmitResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [preparePending, setPreparePending] = useState(false);
  const [submitPending, setSubmitPending] = useState(false);

  const nextBatch = props.character.nextSettlementBatch;
  const mismatchMessage = authorityMismatchMessage(
    props.character,
    props.walletPublicKey,
  );
  const buttonPending =
    preparePending ||
    submitPending ||
    props.walletConnectionStatus === "connecting";

  useEffect(() => {
    setAuthorizeData(null);
    setPreparedData(null);
    setSubmitResult(null);
    setError(null);
  }, [
    props.character.characterId,
    props.character.nextSettlementBatch?.settlementBatchId,
    props.walletPublicKey,
  ]);

  if (nextBatch === null) {
    return null;
  }

  async function prepareAuthorize() {
    if (!props.walletPublicKey) {
      setError("Connect Phantom before preparing settlement.");
      return;
    }

    setPreparePending(true);
    setError(null);

    try {
      const response = await apiRequest<SettlementPrepareResponse>(
        "/api/solana/settlement/prepare",
        {
          method: "POST",
          body: JSON.stringify({
            characterId: props.character.characterId,
            authority: props.walletPublicKey,
            feePayer: props.walletPublicKey,
          }),
        },
      );

      if (response.phase !== "authorize") {
        throw new Error(
          "Unexpected settlement response: expected authorize phase.",
        );
      }

      setAuthorizeData(response);
      setPreparedData(null);
      setSubmitResult(null);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Failed to prepare settlement.",
      );
    } finally {
      setPreparePending(false);
    }
  }

  async function signAuthorization() {
    if (authorizeData === null) {
      setError("Prepare authorization before requesting a Phantom signature.");
      return;
    }

    const provider = getPhantomProvider();
    if (provider === null) {
      setError("Phantom wallet is not installed.");
      return;
    }

    setPreparePending(true);
    setError(null);
    props.setWalletActionStatus("signing_message");

    try {
      if (authorizeData.payload.signatureScheme !== 1) {
        throw new Error(
          "This pending settlement batch uses the legacy manual signature scheme. Use the CLI fallback to complete it or reseal a fresh wallet-text batch.",
        );
      }
      const playerAuthorizationSignatureBase64 =
        await signAuthorizationMessageUtf8(
          provider,
          authorizeData.playerAuthorizationMessageUtf8,
        );
      const response = await apiRequest<SettlementPrepareResponse>(
        "/api/solana/settlement/prepare",
        {
          method: "POST",
          body: JSON.stringify({
            characterId: props.character.characterId,
            authority: props.walletPublicKey,
            feePayer: props.walletPublicKey,
            playerAuthorizationSignatureBase64,
          }),
        },
      );

      if (response.phase !== "sign_transaction") {
        throw new Error(
          "Unexpected settlement response: expected sign_transaction phase.",
        );
      }

      setAuthorizeData(response);
      setPreparedData(response);
      setSubmitResult(null);
    } catch (nextError) {
      setError(normalizeWalletError(nextError));
    } finally {
      props.setWalletActionStatus("idle");
      setPreparePending(false);
    }
  }

  async function signAndSubmit() {
    if (preparedData === null) {
      setError(
        "Prepare the settlement transaction before requesting a Phantom signature.",
      );
      return;
    }

    const provider = getPhantomProvider();
    if (provider === null) {
      setError("Phantom wallet is not installed.");
      return;
    }

    setSubmitPending(true);
    setError(null);
    props.setWalletActionStatus("signing_transaction");

    try {
      const signed = await signPreparedPlayerOwnedTransaction(
        provider,
        preparedData.preparedTransaction,
      );
      const response = await apiRequest<unknown>(
        "/api/solana/settlement/submit",
        {
          method: "POST",
          body: JSON.stringify({
            settlementBatchId: preparedData.settlementBatchId,
            prepared: preparedData.preparedTransaction,
            signedMessageBase64: signed.signedMessageBase64,
            signedTransactionBase64: signed.signedTransactionBase64,
          }),
        },
      );

      setSubmitResult(response);
      setAuthorizeData(null);
      setPreparedData(null);
      await props.onRefresh();
    } catch (nextError) {
      setError(normalizeWalletError(nextError));
    } finally {
      props.setWalletActionStatus("idle");
      setSubmitPending(false);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.panelTitleRow}>
        <div className={styles.stack}>
          <h2 className={styles.panelTitle}>Post-Sync Settlement</h2>
          <p className={styles.panelText}>
            Settle the next pending batch after the character is already
            confirmed on chain using the connected Phantom wallet.
          </p>
        </div>
        <StatusBadge
          label={nextBatch.status}
          tone={settlementTone(nextBatch.status)}
        />
      </div>

      <div className={styles.formGrid}>
        {props.walletAvailability === "not_installed" ? (
          <div className={styles.infoBox}>
            Phantom is required for settlement. Install the extension, refresh
            the page, and connect the wallet bound to this character.
          </div>
        ) : null}

        {mismatchMessage ? (
          <div className={styles.errorBox}>{mismatchMessage}</div>
        ) : null}

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
            <span className={styles.keyValue}>
              {truncateMiddle(props.walletPublicKey)}
            </span>
          </div>
        </div>

        {props.walletConnectionStatus !== "connected" ? (
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonPrimary}`}
              onClick={() => void props.onConnectWallet()}
              disabled={
                buttonPending || props.walletAvailability !== "installed"
              }
            >
              {props.walletConnectionStatus === "connecting"
                ? "Connecting..."
                : "Connect Phantom"}
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
              {submitPending ? "Submitting..." : "Sign And Submit Settlement"}
            </button>
          </div>
        ) : authorizeData ? (
          <>
            <div className={styles.infoBox}>
              Phase 1 is ready. Phantom will sign the settlement authorization
              message before the app requests the final transaction payload.
            </div>
            <div className={styles.buttonRow}>
              <button
                type="button"
                className={styles.button}
                onClick={() => void signAuthorization()}
                disabled={buttonPending}
              >
                {preparePending
                  ? "Requesting Signature..."
                  : "Sign Authorization"}
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
              {preparePending ? "Preparing..." : "Prepare Settlement"}
            </button>
          </div>
        )}

        {preparedData ? (
          <div className={styles.successBox}>
            Settlement transaction prepared. Phantom will sign the transaction
            and the app will submit it to the backend broadcaster.
          </div>
        ) : null}

        {error ? <div className={styles.errorBox}>{error}</div> : null}
        {submitResult ? (
          <details className={styles.details}>
            <summary>Latest settlement result</summary>
            <pre className={styles.pre}>
              {JSON.stringify(submitResult, null, 2)}
            </pre>
          </details>
        ) : null}
      </div>
    </section>
  );
}

type SyncPanelProps = {
  character: CharacterReadModel;
  walletAvailability: WalletAvailability;
  walletConnectionStatus: WalletConnectionStatus;
  walletPublicKey: string | null;
  setWalletActionStatus: (status: WalletActionStatus) => void;
  onRefresh: () => Promise<CharacterReadModel | null>;
};

function SyncPanel(props: SyncPanelProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [stepMessage, setStepMessage] = useState<string | null>(null);

  const syncState = useMemo(
    () => resolveSyncPanelState(props.character),
    [props.character],
  );
  const mismatchMessage = authorityMismatchMessage(
    props.character,
    props.walletPublicKey,
  );
  const season = resolveEffectiveSeason(props.character);
  const canSync = syncState.syncMode !== null;
  const statusDetail =
    stepMessage ??
    (props.character.syncPhase === "LOCAL_ONLY"
      ? "Sync will create the on-chain character first. Battles stay disabled until that creation confirms."
      : props.character.syncPhase === "CREATING_ON_CHAIN"
        ? "Character creation is already in flight. Wait for confirmation before starting new battles."
        : props.character.syncPhase === "INITIAL_SETTLEMENT_REQUIRED"
          ? "Settle the first battle batch before new battles are allowed."
          : props.character.syncPhase === "SETTLEMENT_PENDING"
            ? "A later settlement batch is pending."
            : props.character.syncPhase === "FAILED"
              ? "The last sync attempt failed before confirmation. Retry the sync flow to continue."
              : "Character and settlement cursor are in sync.");

  useEffect(() => {
    setError(null);
    setSuccess(null);
    setStepMessage(null);
  }, [
    props.character.characterId,
    props.character.syncPhase,
    props.character.chain?.chainCreationStatus,
    props.character.nextSettlementBatch?.settlementBatchId,
    props.character.latestBattle?.battleId,
    props.walletPublicKey,
  ]);

  async function runSettlementSync(
    provider: NonNullable<ReturnType<typeof getPhantomProvider>>,
  ): Promise<void> {
    const authorizeResponse = await apiRequest<SettlementPrepareResponse>(
      "/api/solana/settlement/prepare",
      {
        method: "POST",
        body: JSON.stringify({
          characterId: props.character.characterId,
          authority: props.walletPublicKey,
          feePayer: props.walletPublicKey,
        }),
      },
    );

    if (authorizeResponse.phase !== "authorize") {
      throw new Error(
        "Unexpected settlement response: expected authorize phase.",
      );
    }

    if (authorizeResponse.payload.signatureScheme !== 1) {
      throw new Error(
        "This pending settlement batch uses the legacy manual signature scheme. Use the CLI fallback to complete it or reseal a fresh wallet-text batch.",
      );
    }

    props.setWalletActionStatus("signing_message");
    const playerAuthorizationSignatureBase64 =
      await signAuthorizationMessageUtf8(
        provider,
        authorizeResponse.playerAuthorizationMessageUtf8,
      );

    const preparedResponse = await apiRequest<SettlementPrepareResponse>(
      "/api/solana/settlement/prepare",
      {
        method: "POST",
        body: JSON.stringify({
          characterId: props.character.characterId,
          authority: props.walletPublicKey,
          feePayer: props.walletPublicKey,
          playerAuthorizationSignatureBase64,
        }),
      },
    );

    if (preparedResponse.phase !== "sign_transaction") {
      throw new Error(
        "Unexpected settlement response: expected sign_transaction phase.",
      );
    }

    props.setWalletActionStatus("signing_transaction");
    const signed = await signPreparedPlayerOwnedTransaction(
      provider,
      preparedResponse.preparedTransaction,
    );

    await apiRequest<unknown>("/api/solana/settlement/submit", {
      method: "POST",
      body: JSON.stringify({
        settlementBatchId: preparedResponse.settlementBatchId,
        prepared: preparedResponse.preparedTransaction,
        signedMessageBase64: signed.signedMessageBase64,
        signedTransactionBase64: signed.signedTransactionBase64,
      }),
    });
  }

  async function handleSync() {
    if (!canSync) {
      setError("Nothing to sync right now.");
      return;
    }

    if (!props.walletPublicKey) {
      setError("Connect Phantom in the toolbar before syncing.");
      return;
    }

    if (mismatchMessage) {
      setError(mismatchMessage);
      return;
    }

    const provider = getPhantomProvider();
    if (provider === null) {
      setError("Phantom wallet is not installed.");
      return;
    }

    setPending(true);
    setError(null);
    setSuccess(null);
    setStepMessage(null);

    try {
      if (syncState.syncMode === "create_then_settle") {
        const initialUnlockedZoneId =
          props.character.provisionalProgress?.highestUnlockedZoneId ?? 1;

        setStepMessage("Creating character on chain");
        const prepareResponse =
          await apiRequest<PrepareCharacterCreationRouteResponse>(
            "/api/solana/character/create/prepare",
            {
              method: "POST",
              body: JSON.stringify({
                userId: props.character.userId,
                authority: props.walletPublicKey,
                feePayer: props.walletPublicKey,
                name: props.character.name,
                initialUnlockedZoneId,
              }),
            },
          );

        props.setWalletActionStatus("signing_transaction");
        const signed = await signPreparedPlayerOwnedTransaction(
          provider,
          prepareResponse.preparedTransaction,
        );

        setStepMessage("Waiting for confirmation");
        const createResponse =
          await apiRequest<SubmitCharacterCreationRouteResponse>(
            "/api/solana/character/create/submit",
            {
              method: "POST",
              body: JSON.stringify({
                prepared: prepareResponse.preparedTransaction,
                signedMessageBase64: signed.signedMessageBase64,
                signedTransactionBase64: signed.signedTransactionBase64,
              }),
            },
          );

        const refreshedCharacter = await props.onRefresh();
        if (
          refreshedCharacter?.syncPhase === "INITIAL_SETTLEMENT_REQUIRED" ||
          refreshedCharacter?.syncPhase === "SETTLEMENT_PENDING"
        ) {
          setStepMessage("Settling first battle batch");
          await runSettlementSync(provider);
          await props.onRefresh();
        }

        setSuccess(
          `Sync confirmed. Tx ${truncateMiddle(createResponse.transactionSignature)} | Character ${truncateMiddle(createResponse.characterRootPubkey)}`,
        );
      } else {
        setStepMessage(
          props.character.syncPhase === "INITIAL_SETTLEMENT_REQUIRED"
            ? "Settling first battle batch"
            : "Settling battle batch",
        );
        await runSettlementSync(provider);
        await props.onRefresh();
        setSuccess("Sync confirmed.");
      }
    } catch (nextError) {
      setError(normalizeWalletError(nextError));
    } finally {
      props.setWalletActionStatus("idle");
      setStepMessage(null);
      setPending(false);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.stack}>
        <div className={styles.keyValueGrid}>
          <div className={styles.keyValueItem}>
            <span className={styles.keyLabel}>Season</span>
            <span className={styles.keyValue}>{season ?? "Not available"}</span>
          </div>
          <div className={styles.keyValueItem}>
            <span className={styles.keyLabel}>On-chain sync</span>
            <span className={styles.keyValue}>
              <StatusBadge
                label={syncState.statusLabel}
                tone={syncState.statusTone}
              />
            </span>
          </div>
        </div>

        <p className={styles.noteText}>
          <em>
            Note: Unsynced progress after the new season starts will be deleted.
          </em>
        </p>

        <div className={styles.infoBox}>{statusDetail}</div>

        {props.walletAvailability === "not_installed" ? (
          <div className={styles.infoBox}>
            Phantom is required for sync. Install it, refresh the page, and
            connect your wallet.
          </div>
        ) : null}

        {props.walletConnectionStatus !== "connected" ? (
          <div className={styles.infoBox}>
            Connect Phantom in the toolbar before syncing.
          </div>
        ) : null}

        {mismatchMessage ? (
          <div className={styles.errorBox}>{mismatchMessage}</div>
        ) : null}
        {error ? <div className={styles.errorBox}>{error}</div> : null}
        {success ? <div className={styles.successBox}>{success}</div> : null}

        <div className={styles.buttonRow}>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary}`}
            onClick={() => void handleSync()}
            disabled={
              pending ||
              props.walletConnectionStatus !== "connected" ||
              !canSync ||
              Boolean(mismatchMessage)
            }
          >
            {pending ? "Syncing..." : "Sync"}
          </button>
        </div>
      </div>
    </section>
  );
}

export default function GameClient() {
  const [appPhase, setAppPhase] = useState<AppPhase>("bootstrapping_user");
  const [userId, setUserId] = useState<string | null>(null);
  const [character, setCharacter] = useState<CharacterReadModel | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [createName, setCreateName] = useState("Rookie");
  const [selectedZoneId, setSelectedZoneId] = useState(1);
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [battlePending, setBattlePending] = useState(false);
  const [battleError, setBattleError] = useState<string | null>(null);
  const [refreshPending, setRefreshPending] = useState(false);
  const [latestEncounter, setLatestEncounter] =
    useState<EncounterResponse | null>(null);
  const [walletAvailability, setWalletAvailability] =
    useState<WalletAvailability>("unknown");
  const [walletConnectionStatus, setWalletConnectionStatus] =
    useState<WalletConnectionStatus>("checking_trusted");
  const [walletActionStatus, setWalletActionStatus] =
    useState<WalletActionStatus>("idle");
  const [walletPublicKey, setWalletPublicKey] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);

  const walletPending =
    walletConnectionStatus === "connecting" || walletActionStatus !== "idle";
  const activeSkillNames = useMemo(
    () =>
      character ? resolveSkillNames(character.activeSkills).join(", ") : "",
    [character],
  );
  const passiveSkillNames = useMemo(
    () =>
      character ? resolvePassiveNames(character.passiveSkills).join(", ") : "",
    [character],
  );

  async function issueAnonymousUser(): Promise<string> {
    const created = await apiRequest<AnonymousUserResponse>("/api/auth/anon", {
      method: "POST",
      body: JSON.stringify({}),
    });

    window.localStorage.setItem(USER_STORAGE_KEY, created.userId);
    setUserId(created.userId);
    return created.userId;
  }

  async function refreshCharacter(
    nextUserId?: string,
  ): Promise<CharacterReadModel | null> {
    const resolvedUserId = nextUserId ?? userId;

    if (!resolvedUserId) {
      throw new Error("No user id is available yet.");
    }

    setRefreshPending(true);

    try {
      const response = await apiRequest<CharacterQueryResponse>(
        `/api/character?userId=${encodeURIComponent(resolvedUserId)}`,
        { method: "GET", headers: undefined },
      );
      setCharacter(response.character);
      setAppPhase("ready");
      return response.character;
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
        setAppPhase("loading_character");

        const response = await apiRequest<CharacterQueryResponse>(
          `/api/character?userId=${encodeURIComponent(resolvedUserId)}`,
          { method: "GET", headers: undefined },
        );

        if (cancelled) {
          return;
        }

        setCharacter(response.character);
        setAppPhase("ready");
      } catch (error) {
        if (cancelled) {
          return;
        }
        setFatalError(
          error instanceof Error
            ? error.message
            : "Failed to bootstrap the app.",
        );
        setAppPhase("fatal_error");
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

    if (availability !== "installed") {
      setWalletConnectionStatus("disconnected");
      setWalletPublicKey(null);
      return;
    }

    let cancelled = false;
    setWalletConnectionStatus("checking_trusted");

    void connectPhantom({ onlyIfTrusted: true })
      .then(({ publicKey }) => {
        if (cancelled) {
          return;
        }
        setWalletPublicKey(publicKey);
        setWalletConnectionStatus("connected");
        setWalletError(null);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setWalletPublicKey(null);
        setWalletConnectionStatus("disconnected");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const provider = getPhantomProvider();
    if (
      provider === null ||
      typeof provider.on !== "function" ||
      typeof provider.removeListener !== "function"
    ) {
      return;
    }

    const handleConnect = () => {
      const publicKey = provider.publicKey?.toBase58() ?? null;
      setWalletPublicKey(publicKey);
      setWalletConnectionStatus(publicKey ? "connected" : "disconnected");
    };

    const handleDisconnect = () => {
      setWalletPublicKey(null);
      setWalletConnectionStatus("disconnected");
    };

    const handleAccountChanged = (...args: unknown[]) => {
      const [nextPublicKey] = args;
      if (
        nextPublicKey !== null &&
        typeof nextPublicKey === "object" &&
        nextPublicKey !== undefined &&
        "toBase58" in nextPublicKey &&
        typeof (nextPublicKey as { toBase58?: unknown }).toBase58 === "function"
      ) {
        setWalletPublicKey(
          (nextPublicKey as { toBase58(): string }).toBase58(),
        );
        setWalletConnectionStatus("connected");
        return;
      }

      handleDisconnect();
    };

    provider.on("connect", handleConnect);
    provider.on("disconnect", handleDisconnect);
    provider.on("accountChanged", handleAccountChanged);

    return () => {
      provider.removeListener?.("connect", handleConnect);
      provider.removeListener?.("disconnect", handleDisconnect);
      provider.removeListener?.("accountChanged", handleAccountChanged);
    };
  }, []);

  useEffect(() => {
    const maxZone = maxUnlockedZone(character);
    if (selectedZoneId > maxZone) {
      setSelectedZoneId(maxZone);
    }
  }, [character, selectedZoneId]);

  async function handleConnectWallet() {
    setWalletConnectionStatus("connecting");
    setWalletError(null);

    try {
      const { publicKey } = await connectPhantom();
      setWalletPublicKey(publicKey);
      setWalletConnectionStatus("connected");
    } catch (error) {
      setWalletPublicKey(null);
      setWalletConnectionStatus("disconnected");
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
      setWalletConnectionStatus("disconnected");
      setWalletActionStatus("idle");
    }
  }

  async function handleCreateCharacter() {
    if (!userId) {
      setCreateError(
        "Cannot create a character before user bootstrap finishes.",
      );
      return;
    }

    setCreatePending(true);
    setCreateError(null);

    try {
      let activeUserId = userId;

      try {
        await apiRequest<CreateCharacterResponse>("/api/character/create", {
          method: "POST",
          body: JSON.stringify({
            userId: activeUserId,
            name: createName,
          }),
        });
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "User not found.") {
          throw error;
        }

        window.localStorage.removeItem(USER_STORAGE_KEY);
        activeUserId = await issueAnonymousUser();

        await apiRequest<CreateCharacterResponse>("/api/character/create", {
          method: "POST",
          body: JSON.stringify({
            userId: activeUserId,
            name: createName,
          }),
        });
      }

      await refreshCharacter(activeUserId);
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Failed to create character.",
      );
    } finally {
      setCreatePending(false);
    }
  }

  async function handleBattle() {
    if (!character) {
      setBattleError("Create a character before starting a battle.");
      return;
    }
    if (!character.battleEligible) {
      setBattleError(
        "Initial settlement is required before new battles can start.",
      );
      return;
    }

    setBattlePending(true);
    setBattleError(null);

    try {
      const response = await apiRequest<EncounterResponse>(
        "/api/combat/encounter",
        {
          method: "POST",
          body: JSON.stringify({
            characterId: character.characterId,
            zoneId: selectedZoneId,
          }),
        },
      );

      setLatestEncounter(response);
      await refreshCharacter(character.userId);
    } catch (error) {
      setBattleError(
        error instanceof Error ? error.message : "Failed to run battle.",
      );
    } finally {
      setBattlePending(false);
    }
  }

  if (appPhase === "bootstrapping_user" || appPhase === "loading_character") {
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <header className={styles.header}>
            <h1 className={styles.title}>RUNANA</h1>
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

  if (appPhase === "fatal_error") {
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <header className={styles.header}>
            <h1 className={styles.title}>RUNANA</h1>
          </header>

          <section className={styles.panel}>
            <div className={styles.errorBox}>
              {fatalError ?? "Unknown error."}
            </div>
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
          <h1 className={styles.title}>RUNANA</h1>

          <div className={styles.toolbar}>
            <WalletToolbar
              availability={walletAvailability}
              connectionStatus={walletConnectionStatus}
              actionStatus={walletActionStatus}
              userId={userId}
              publicKey={walletPublicKey}
              error={walletError}
              pending={walletPending}
              refreshPending={refreshPending}
              onConnect={handleConnectWallet}
              onDisconnect={handleDisconnectWallet}
              onRefresh={() => {
                if (userId) {
                  void refreshCharacter(userId);
                }
              }}
            />
            {refreshPending ? (
              <StatusBadge label="Refreshing state" tone="info" />
            ) : null}
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
                <div className={styles.stack}>
                  <div className={styles.stack}>
                    <h2 className={styles.panelTitle}>{character.name}</h2>
                  </div>
                </div>

                <div className={styles.keyValueGrid}>
                  <div className={styles.keyValueItem}>
                    <span className={styles.keyLabel}>Level</span>
                    <span className={styles.levelValue}>{character.level}</span>
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
                      {character.stats.atk} / {character.stats.def} /{" "}
                      {character.stats.spd}
                    </span>
                  </div>
                  <div className={styles.keyValueItem}>
                    <span className={styles.keyLabel}>Active skills</span>
                    <span className={styles.keyValue}>{activeSkillNames}</span>
                  </div>
                  <div className={styles.keyValueItem}>
                    <span className={styles.keyLabel}>Passive skills</span>
                    <span className={styles.keyValue}>{passiveSkillNames}</span>
                  </div>
                </div>
              </section>

              <section className={styles.panel}>
                <div className={styles.panelTitleRow}>
                  <div className={styles.stack}>
                    <h2 className={styles.panelTitle}>Battle</h2>
                  </div>
                  {character.latestBattle ? (
                    <StatusBadge
                      label={character.latestBattle.settlementStatus}
                      tone={settlementTone(
                        character.latestBattle.settlementStatus,
                      )}
                    />
                  ) : null}
                </div>

                <div className={styles.formGrid}>
                  <label className={styles.field}>
                    <span className={styles.label}>Zone</span>
                    <select
                      className={styles.select}
                      value={selectedZoneId}
                      onChange={(event) =>
                        setSelectedZoneId(Number(event.target.value))
                      }
                      disabled={battlePending || !character.battleEligible}
                    >
                      {Array.from(
                        { length: maxUnlockedZone(character) },
                        (_, index) => index + 1,
                      ).map((zoneId) => (
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
                      disabled={battlePending || !character.battleEligible}
                    >
                      {battlePending ? "Running battle..." : "Run battle"}
                    </button>
                  </div>

                  {!character.battleEligible ? (
                    <div className={styles.infoBox}>
                      Finish the initial on-chain settlement before starting
                      another battle.
                    </div>
                  ) : null}

                  {battleError ? (
                    <div className={styles.errorBox}>{battleError}</div>
                  ) : null}

                  {latestEncounter ? (
                    <div className={styles.stack}>
                      <div className={styles.successBox}>
                        Latest encounter persisted with seed{" "}
                        {latestEncounter.seed} and settlement status{" "}
                        {latestEncounter.settlementStatus}.
                      </div>
                      <BattleReplay result={latestEncounter.battleResult} />
                    </div>
                  ) : (
                    <div className={styles.infoBox}>
                      No new encounter has been run in this session yet. The
                      latest persisted ledger status is still visible in the
                      dashboard panels.
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div className={styles.panelGrid}>
              <SyncPanel
                character={character}
                walletAvailability={walletAvailability}
                walletConnectionStatus={walletConnectionStatus}
                walletPublicKey={walletPublicKey}
                setWalletActionStatus={setWalletActionStatus}
                onRefresh={() => refreshCharacter(character.userId)}
              />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
