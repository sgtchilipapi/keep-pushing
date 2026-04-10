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
  BattleSettlementStatus,
  CharacterQueryResponse,
  CharacterReadModel,
  CreateCharacterResponse,
  EncounterResponse,
  SettlementPrepareResponse,
} from "../../types/api/frontend";
import type {
  ActiveZoneRunSnapshot,
  ClosedZoneRunSummary,
  ZoneRunActionResponse,
  ZoneRunLastBattleSummary,
  ZoneRunTerminalStatus,
} from "../../types/zoneRun";
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
  BARRIER_SKILL_ID,
  REPAIR_SKILL_ID,
  getSkillDef,
} from "../../engine/battle/skillRegistry";
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

function zoneRunTerminalTone(
  status: ZoneRunTerminalStatus | null | undefined,
): "neutral" | "warning" | "success" | "danger" | "info" {
  switch (status) {
    case "COMPLETED":
      return "success";
    case "FAILED":
      return "danger";
    case "ABANDONED":
    case "EXPIRED":
    case "SEASON_CUTOFF":
      return "warning";
    default:
      return "neutral";
  }
}

function zoneRunStateTone(
  state: ActiveZoneRunSnapshot["state"] | null | undefined,
): "neutral" | "warning" | "success" | "danger" | "info" {
  switch (state) {
    case "TRAVERSING":
      return "info";
    case "AWAITING_BRANCH":
      return "warning";
    case "POST_BATTLE_PAUSE":
      return "success";
    default:
      return "neutral";
  }
}

function formatZoneRunState(
  state: ActiveZoneRunSnapshot["state"] | null | undefined,
): string {
  switch (state) {
    case "TRAVERSING":
      return "TRAVERSING";
    case "AWAITING_BRANCH":
      return "CHOOSE BRANCH";
    case "POST_BATTLE_PAUSE":
      return "POST BATTLE";
    default:
      return "IDLE";
  }
}

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `zone-run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatEnemyHistogram(histogram: Record<string, number>): string {
  const entries = Object.entries(histogram).filter(([, count]) => count > 0);
  if (entries.length === 0) {
    return "No encounters yet";
  }

  return entries
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([enemyId, count]) => `Enemy ${enemyId} x${count}`)
    .join(", ");
}

function formatZoneProgressDelta(delta: unknown): string {
  if (!Array.isArray(delta) || delta.length === 0) {
    return "No zone progression";
  }

  return delta
    .map((entry) => {
      if (!isObject(entry)) {
        return "Unknown zone update";
      }
      const zoneId = typeof entry.zoneId === "number" ? entry.zoneId : "?";
      const newState = typeof entry.newState === "number" ? entry.newState : "?";
      const label =
        newState === 2 ? "cleared" : newState === 1 ? "unlocked" : `state ${newState}`;
      return `Zone ${zoneId} ${label}`;
    })
    .join(", ");
}

function battleSettlementInfo(
  battle: ZoneRunLastBattleSummary | null,
  latestBattle: CharacterReadModel["latestBattle"],
): { label: string; tone: "neutral" | "warning" | "success" | "danger" | "info" } | null {
  if (battle !== null) {
    return {
      label: battle.rewarded ? "Reward eligible" : "Loss recorded",
      tone: battle.rewarded ? "success" : "danger",
    };
  }

  if (latestBattle === null) {
    return null;
  }

  return {
    label: latestBattle.settlementStatus,
    tone: settlementTone(latestBattle.settlementStatus as BattleSettlementStatus),
  };
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
            Create the local character first. You can battle locally right
            away, then use Phantom later to save that character genesis on
            chain.
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

type ZoneRunPanelProps = {
  character: CharacterReadModel;
  selectedZoneId: number;
  activeRun: ActiveZoneRunSnapshot | null;
  latestBattle: ZoneRunLastBattleSummary | null;
  latestClosedRun: ClosedZoneRunSummary | null;
  pending: boolean;
  refreshPending: boolean;
  error: string | null;
  notice: string | null;
  onSelectZone: (zoneId: number) => void;
  onStartRun: () => Promise<void>;
  onRefreshRun: () => Promise<void>;
  onAdvance: () => Promise<void>;
  onChooseBranch: (nextNodeId: string) => Promise<void>;
  onUsePauseSkill: (skillId: string) => Promise<void>;
  onContinue: () => Promise<void>;
  onAbandon: () => Promise<void>;
  onRunSandboxBattle: () => Promise<void>;
  sandboxBattlePending: boolean;
  sandboxBattleError: string | null;
  latestEncounter: EncounterResponse | null;
};

function ZoneRunPanel(props: ZoneRunPanelProps) {
  const pauseSkillIds = props.character.activeSkills.filter(
    (skillId) => skillId === BARRIER_SKILL_ID || skillId === REPAIR_SKILL_ID,
  );
  const activeRun = props.activeRun;
  const canStartRun =
    activeRun === null &&
    props.character.battleEligible &&
    !props.pending;
  const settlementInfo = battleSettlementInfo(
    props.latestBattle,
    props.character.latestBattle,
  );

  return (
    <section className={styles.panel}>
      <div className={styles.panelTitleRow}>
        <div className={styles.stack}>
          <h2 className={styles.panelTitle}>Zone Run</h2>
          <p className={styles.panelText}>
            Play the real traversal loop here: start a run, consume subnodes,
            branch through nodes, handle post-battle pause, and resume or
            abandon from durable state.
          </p>
        </div>
        {activeRun ? (
          <StatusBadge
            label={formatZoneRunState(activeRun.state)}
            tone={zoneRunStateTone(activeRun.state)}
          />
        ) : props.latestClosedRun ? (
          <StatusBadge
            label={props.latestClosedRun.terminalStatus}
            tone={zoneRunTerminalTone(props.latestClosedRun.terminalStatus)}
          />
        ) : null}
      </div>

      <div className={styles.formGrid}>
        {activeRun === null ? (
          <>
            <label className={styles.field}>
              <span className={styles.label}>Zone</span>
              <select
                className={styles.select}
                value={props.selectedZoneId}
                onChange={(event) => props.onSelectZone(Number(event.target.value))}
                disabled={props.pending || !props.character.battleEligible}
              >
                {Array.from(
                  { length: maxUnlockedZone(props.character) },
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
                onClick={() => void props.onStartRun()}
                disabled={!canStartRun}
              >
                {props.pending ? "Starting run..." : "Start Zone Run"}
              </button>
              <button
                type="button"
                className={styles.button}
                onClick={() => void props.onRefreshRun()}
                disabled={props.refreshPending}
              >
                {props.refreshPending ? "Refreshing..." : "Refresh Run State"}
              </button>
            </div>

            {!props.character.battleEligible ? (
              <div className={styles.infoBox}>
                Sync backlog settlement before starting a new run for this
                character.
              </div>
            ) : (
              <div className={styles.infoBox}>
                No active run right now. Start a run from an unlocked zone to
                enter the traversal flow.
              </div>
            )}
          </>
        ) : (
          <>
            <div className={styles.keyValueGrid}>
              <div className={styles.keyValueItem}>
                <span className={styles.keyLabel}>Run</span>
                <span className={styles.keyValue}>
                  {truncateMiddle(activeRun.runId, 6)}
                </span>
              </div>
              <div className={styles.keyValueItem}>
                <span className={styles.keyLabel}>Zone / Season</span>
                <span className={styles.keyValue}>
                  Zone {activeRun.zoneId} / Season {activeRun.seasonId}
                </span>
              </div>
              <div className={styles.keyValueItem}>
                <span className={styles.keyLabel}>Node</span>
                <span className={styles.keyValue}>{activeRun.currentNodeId}</span>
              </div>
              <div className={styles.keyValueItem}>
                <span className={styles.keyLabel}>Subnode</span>
                <span className={styles.keyValue}>
                  {activeRun.currentSubnodeId ?? "Node boundary"}
                </span>
              </div>
              <div className={styles.keyValueItem}>
                <span className={styles.keyLabel}>Progress</span>
                <span className={styles.keyValue}>
                  {activeRun.totalSubnodesTraversed}/
                  {activeRun.totalSubnodesInRun} consumed
                </span>
              </div>
              <div className={styles.keyValueItem}>
                <span className={styles.keyLabel}>Carryover HP</span>
                <span className={styles.keyValue}>
                  {activeRun.playerCarryover.hp}/
                  {activeRun.playerCarryover.hpMax}
                </span>
              </div>
            </div>

            <div className={styles.infoBox}>
              Encounters so far:{" "}
              {formatEnemyHistogram(activeRun.enemyAppearanceCounts)}
            </div>

            {Object.keys(activeRun.playerCarryover.cooldowns).length > 0 ? (
              <div className={styles.infoBox}>
                Cooldowns:{" "}
                {Object.entries(activeRun.playerCarryover.cooldowns)
                  .map(([skillId, remaining]) => {
                    const skillName = getSkillDef(skillId).skillName;
                    return `${skillName} ${remaining}`;
                  })
                  .join(", ")}
              </div>
            ) : null}

            {Object.keys(activeRun.playerCarryover.statuses).length > 0 ? (
              <div className={styles.infoBox}>
                Carryover statuses:{" "}
                {Object.entries(activeRun.playerCarryover.statuses)
                  .map(
                    ([statusId, value]) =>
                      `${statusId} (${value.remainingTurns} ticks)`,
                  )
                  .join(", ")}
              </div>
            ) : null}

            {activeRun.state === "TRAVERSING" ? (
              <div className={styles.buttonRow}>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonPrimary}`}
                  onClick={() => void props.onAdvance()}
                  disabled={props.pending}
                >
                  {props.pending ? "Advancing..." : "Advance Subnode"}
                </button>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonDanger}`}
                  onClick={() => void props.onAbandon()}
                  disabled={props.pending}
                >
                  Abandon Run
                </button>
              </div>
            ) : null}

            {activeRun.state === "AWAITING_BRANCH" ? (
              <div className={styles.stack}>
                <div className={styles.infoBox}>
                  Branch choice required before the run can continue.
                </div>
                <div className={styles.buttonRow}>
                  {activeRun.branchOptions.map((branchNodeId) => (
                    <button
                      key={branchNodeId}
                      type="button"
                      className={`${styles.button} ${styles.buttonPrimary}`}
                      onClick={() => void props.onChooseBranch(branchNodeId)}
                      disabled={props.pending}
                    >
                      Enter {branchNodeId}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`${styles.button} ${styles.buttonDanger}`}
                    onClick={() => void props.onAbandon()}
                    disabled={props.pending}
                  >
                    Abandon Run
                  </button>
                </div>
              </div>
            ) : null}

            {activeRun.state === "POST_BATTLE_PAUSE" ? (
              <div className={styles.stack}>
                <div className={styles.infoBox}>
                  Post-battle pause is active. Use allowed support/recovery
                  skills, then continue traversal.
                </div>
                <div className={styles.buttonRow}>
                  {pauseSkillIds.map((skillId) => {
                    const skill = getSkillDef(skillId);
                    const remainingCooldown =
                      activeRun.playerCarryover.cooldowns[skillId] ?? 0;
                    return (
                      <button
                        key={skillId}
                        type="button"
                        className={styles.button}
                        onClick={() => void props.onUsePauseSkill(skillId)}
                        disabled={props.pending || remainingCooldown > 0}
                      >
                        {skill.skillName}
                        {remainingCooldown > 0 ? ` (${remainingCooldown})` : ""}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className={`${styles.button} ${styles.buttonPrimary}`}
                    onClick={() => void props.onContinue()}
                    disabled={props.pending}
                  >
                    {props.pending ? "Continuing..." : "Continue Run"}
                  </button>
                  <button
                    type="button"
                    className={`${styles.button} ${styles.buttonDanger}`}
                    onClick={() => void props.onAbandon()}
                    disabled={props.pending}
                  >
                    Abandon Run
                  </button>
                </div>
              </div>
            ) : null}

            <div className={styles.buttonRow}>
              <button
                type="button"
                className={styles.button}
                onClick={() => void props.onRefreshRun()}
                disabled={props.refreshPending || props.pending}
              >
                {props.refreshPending ? "Refreshing..." : "Refresh Run State"}
              </button>
            </div>
          </>
        )}

        {settlementInfo ? (
          <div className={styles.inlineStack}>
            <StatusBadge label={settlementInfo.label} tone={settlementInfo.tone} />
          </div>
        ) : null}

        {props.notice ? <div className={styles.successBox}>{props.notice}</div> : null}
        {props.error ? <div className={styles.errorBox}>{props.error}</div> : null}

        {props.latestBattle ? (
          <div className={styles.stack}>
            <div className={styles.successBox}>
              Latest zone-run battle: enemy {props.latestBattle.enemyArchetypeId} at{" "}
              {props.latestBattle.nodeId}/{props.latestBattle.subnodeId}.{" "}
              {props.latestBattle.rewarded ? "Reward eligible." : "Run-ending loss."}
            </div>
            <BattleReplay result={props.latestBattle.battleResult} />
          </div>
        ) : null}

        {props.latestClosedRun ? (
          <div className={styles.details}>
            <strong>Latest closed run</strong>
            <div className={styles.keyValueGrid}>
              <div className={styles.keyValueItem}>
                <span className={styles.keyLabel}>Terminal status</span>
                <span className={styles.keyValue}>
                  <StatusBadge
                    label={props.latestClosedRun.terminalStatus}
                    tone={zoneRunTerminalTone(props.latestClosedRun.terminalStatus)}
                  />
                </span>
              </div>
              <div className={styles.keyValueItem}>
                <span className={styles.keyLabel}>Rewarded battles</span>
                <span className={styles.keyValue}>
                  {props.latestClosedRun.rewardedBattleCount}
                </span>
              </div>
              <div className={styles.keyValueItem}>
                <span className={styles.keyLabel}>Rewards histogram</span>
                <span className={styles.keyValue}>
                  {formatEnemyHistogram(
                    props.latestClosedRun.rewardedEncounterHistogram,
                  )}
                </span>
              </div>
              <div className={styles.keyValueItem}>
                <span className={styles.keyLabel}>Zone progression</span>
                <span className={styles.keyValue}>
                  {formatZoneProgressDelta(props.latestClosedRun.zoneProgressDelta)}
                </span>
              </div>
            </div>
          </div>
        ) : null}

        <details className={styles.details}>
          <summary>Legacy sandbox battle</summary>
          <div className={styles.formGrid}>
            <div className={styles.infoBox}>
              This remains available for dev comparison, but the playable core
              loop is now the zone-run flow above.
            </div>

            <div className={styles.buttonRow}>
              <button
                type="button"
                className={`${styles.button} ${styles.buttonPrimary}`}
                onClick={() => void props.onRunSandboxBattle()}
                disabled={props.sandboxBattlePending || !props.character.battleEligible}
              >
                {props.sandboxBattlePending ? "Running battle..." : "Run sandbox battle"}
              </button>
            </div>

            {props.sandboxBattleError ? (
              <div className={styles.errorBox}>{props.sandboxBattleError}</div>
            ) : null}

            {props.latestEncounter ? (
              <div className={styles.stack}>
                <div className={styles.successBox}>
                  Latest encounter persisted with seed {props.latestEncounter.seed} and settlement status{" "}
                  {props.latestEncounter.settlementStatus}.
                </div>
                <BattleReplay result={props.latestEncounter.battleResult} />
              </div>
            ) : (
              <div className={styles.infoBox}>
                No sandbox encounter has been run in this session yet.
              </div>
            )}
          </div>
        </details>
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

      if (response.phase === "submitted") {
        setAuthorizeData(null);
        setPreparedData(null);
        setSubmitResult(response);
        await props.onRefresh();
        return;
      }

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

      if (response.phase === "submitted") {
        setAuthorizeData(null);
        setPreparedData(null);
        setSubmitResult(response);
        await props.onRefresh();
        return;
      }

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
      ? "Battles are still available locally. Sync will save the character genesis on chain first, then backlog settlement can follow."
      : props.character.syncPhase === "CREATING_ON_CHAIN"
        ? "Character genesis is reserved or already submitted. Sync again to resume signing or check the in-flight transaction."
        : props.character.syncPhase === "INITIAL_SETTLEMENT_REQUIRED"
          ? "The character is confirmed on chain. Settle the first backlog batch before adding more battles."
          : props.character.syncPhase === "SETTLEMENT_PENDING"
            ? "A later settlement batch is pending. Sync again to submit the next batch or check the in-flight one."
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
  ): Promise<"confirmed" | "submitted"> {
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

    if (authorizeResponse.phase === "submitted") {
      await props.onRefresh();
      return "submitted";
    }

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

    if (preparedResponse.phase === "submitted") {
      await props.onRefresh();
      return "submitted";
    }

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

    return "confirmed";
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

        setStepMessage("Saving character genesis on chain");
        const prepareResponse =
          await apiRequest<PrepareCharacterCreationRouteResponse>(
            "/api/solana/character/create/prepare",
            {
              method: "POST",
              body: JSON.stringify({
                characterId: props.character.characterId,
                authority: props.walletPublicKey,
                feePayer: props.walletPublicKey,
                initialUnlockedZoneId,
              }),
            },
          );

        if (prepareResponse.phase === "submitted") {
          const refreshedCharacter = await props.onRefresh();
          if (
            refreshedCharacter?.syncPhase === "INITIAL_SETTLEMENT_REQUIRED" ||
            refreshedCharacter?.syncPhase === "SETTLEMENT_PENDING"
          ) {
            setStepMessage("Settling first backlog batch");
            const settlementOutcome = await runSettlementSync(provider);
            await props.onRefresh();
            setSuccess(
              settlementOutcome === "submitted"
                ? "Character creation already landed. Settlement is now in flight."
                : "Character creation already landed. First settlement batch confirmed.",
            );
          } else {
            setSuccess(
              `Character creation is already in flight. Tx ${truncateMiddle(prepareResponse.transactionSignature)}`,
            );
          }
          return;
        }

        if (prepareResponse.phase !== "sign_transaction") {
          throw new Error(
            "Unexpected character creation response: expected sign_transaction phase.",
          );
        }

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
          setStepMessage("Settling first backlog batch");
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
        const settlementOutcome = await runSettlementSync(provider);
        await props.onRefresh();
        setSuccess(
          settlementOutcome === "submitted"
            ? "Settlement is already in flight."
            : "Sync confirmed.",
        );
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
  const [zoneRunPending, setZoneRunPending] = useState(false);
  const [zoneRunError, setZoneRunError] = useState<string | null>(null);
  const [zoneRunNotice, setZoneRunNotice] = useState<string | null>(null);
  const [zoneRunRefreshPending, setZoneRunRefreshPending] = useState(false);
  const [activeZoneRunDetail, setActiveZoneRunDetail] =
    useState<ActiveZoneRunSnapshot | null>(null);
  const [latestZoneRunBattle, setLatestZoneRunBattle] =
    useState<ZoneRunLastBattleSummary | null>(null);
  const [latestClosedZoneRun, setLatestClosedZoneRun] =
    useState<ClosedZoneRunSummary | null>(null);
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
      setLatestClosedZoneRun(response.character?.latestClosedZoneRun ?? null);
      if (response.character?.activeZoneRun === null) {
        setActiveZoneRunDetail(null);
      }
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

  async function refreshActiveZoneRun(nextCharacter?: CharacterReadModel | null) {
    const activeCharacter = nextCharacter ?? character;
    if (!activeCharacter?.activeZoneRun) {
      setActiveZoneRunDetail(null);
      return;
    }

    setZoneRunRefreshPending(true);

    try {
      const response = await apiRequest<ZoneRunActionResponse>(
        `/api/zone-runs/active?characterId=${encodeURIComponent(activeCharacter.characterId)}`,
        { method: "GET", headers: undefined },
      );
      setActiveZoneRunDetail(response.activeRun);
      if (response.activeRun?.lastBattle) {
        setLatestZoneRunBattle(response.activeRun.lastBattle);
      }
      if (response.closedRunSummary) {
        setLatestClosedZoneRun(response.closedRunSummary);
        await refreshCharacter(activeCharacter.userId);
      }
    } finally {
      setZoneRunRefreshPending(false);
    }
  }

  useEffect(() => {
    if (!character?.activeZoneRun) {
      setActiveZoneRunDetail(null);
      return;
    }

    void refreshActiveZoneRun(character);
  }, [
    character?.characterId,
    character?.activeZoneRun?.runId,
    character?.activeZoneRun?.state,
    character?.activeZoneRun?.currentNodeId,
    character?.activeZoneRun?.currentSubnodeId,
  ]);

  async function executeZoneRunAction(
    path: string,
    body: Record<string, unknown>,
    successMessage: string,
  ) {
    if (!character) {
      setZoneRunError("Create a character before starting a zone run.");
      return;
    }

    setZoneRunPending(true);
    setZoneRunError(null);
    setZoneRunNotice(null);

    try {
      const response = await apiRequest<ZoneRunActionResponse>(path, {
        method: "POST",
        headers: {
          "Idempotency-Key": createIdempotencyKey(),
        },
        body: JSON.stringify(body),
      });

      setActiveZoneRunDetail(response.activeRun);
      if (response.battle) {
        setLatestZoneRunBattle(response.battle);
      } else if (response.activeRun?.lastBattle) {
        setLatestZoneRunBattle(response.activeRun.lastBattle);
      }
      if (response.closedRunSummary) {
        setLatestClosedZoneRun(response.closedRunSummary);
      }

      await refreshCharacter(character.userId);
      setZoneRunNotice(successMessage);
    } catch (error) {
      setZoneRunError(
        error instanceof Error ? error.message : "Zone run action failed.",
      );
    } finally {
      setZoneRunPending(false);
    }
  }

  async function handleStartZoneRun() {
    if (!character) {
      setZoneRunError("Create a character before starting a zone run.");
      return;
    }

    await executeZoneRunAction(
      "/api/zone-runs/start",
      {
        characterId: character.characterId,
        zoneId: selectedZoneId,
      },
      `Zone ${selectedZoneId} run started.`,
    );
  }

  async function handleAdvanceZoneRun() {
    if (!character) {
      return;
    }

    await executeZoneRunAction(
      "/api/zone-runs/advance",
      { characterId: character.characterId },
      "Subnode consumed.",
    );
  }

  async function handleChooseZoneRunBranch(nextNodeId: string) {
    if (!character) {
      return;
    }

    await executeZoneRunAction(
      "/api/zone-runs/choose-branch",
      {
        characterId: character.characterId,
        nextNodeId,
      },
      `Branch committed: ${nextNodeId}.`,
    );
  }

  async function handleUsePauseSkill(skillId: string) {
    if (!character) {
      return;
    }

    await executeZoneRunAction(
      "/api/zone-runs/use-skill",
      {
        characterId: character.characterId,
        skillId,
      },
      `${getSkillDef(skillId).skillName} applied during pause.`,
    );
  }

  async function handleContinueZoneRun() {
    if (!character) {
      return;
    }

    await executeZoneRunAction(
      "/api/zone-runs/continue",
      { characterId: character.characterId },
      "Run continued.",
    );
  }

  async function handleAbandonZoneRun() {
    if (!character) {
      return;
    }

    await executeZoneRunAction(
      "/api/zone-runs/abandon",
      { characterId: character.characterId },
      "Run abandoned.",
    );
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

              <ZoneRunPanel
                character={character}
                selectedZoneId={selectedZoneId}
                activeRun={activeZoneRunDetail}
                latestBattle={latestZoneRunBattle}
                latestClosedRun={latestClosedZoneRun}
                pending={zoneRunPending}
                refreshPending={zoneRunRefreshPending}
                error={zoneRunError}
                notice={zoneRunNotice}
                onSelectZone={setSelectedZoneId}
                onStartRun={handleStartZoneRun}
                onRefreshRun={() => refreshActiveZoneRun(character)}
                onAdvance={handleAdvanceZoneRun}
                onChooseBranch={handleChooseZoneRunBranch}
                onUsePauseSkill={handleUsePauseSkill}
                onContinue={handleContinueZoneRun}
                onAbandon={handleAbandonZoneRun}
                onRunSandboxBattle={handleBattle}
                sandboxBattlePending={battlePending}
                sandboxBattleError={battleError}
                latestEncounter={latestEncounter}
              />
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
