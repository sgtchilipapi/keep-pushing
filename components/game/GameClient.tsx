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
  SettlementPrepareResponse,
} from "../../types/api/frontend";
import type {
  ActiveZoneRunSnapshot,
  ZoneRunActionResponse,
  ZoneRunTopologyPreview,
  ZoneRunTopologyResponse,
} from "../../types/zoneRun";
import StatusBadge from "./StatusBadge";
import styles from "./game-shell.module.css";
import { resolveSyncPanelState } from "./uiModel";
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

function nextLevelExpTarget(level: number): number {
  return Math.max(100, level * 100);
}

function WalletIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={props.className}>
      <path
        d="M4 7.5A2.5 2.5 0 0 1 6.5 5h10A2.5 2.5 0 0 1 19 7.5V8h1a1 1 0 0 1 1 1v6a4 4 0 0 1-4 4H6.5A2.5 2.5 0 0 1 4 16.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16 12h4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="16" cy="12" r="1.2" fill="currentColor" />
    </svg>
  );
}

function SyncIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={props.className}>
      <path
        d="M18 8A6.5 6.5 0 0 0 6.5 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M6.5 6.5V10H10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6 16A6.5 6.5 0 0 0 17.5 17.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M17.5 17.5V14H14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function InfoIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={props.className}>
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="8" r="1.2" fill="currentColor" />
      <path
        d="M12 11v5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function HeartIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={props.className}>
      <path
        d="M12 20s-7-4.6-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.4-7 10-7 10z"
        fill="currentColor"
      />
    </svg>
  );
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

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `zone-run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatNodeLabel(nodeId: string): string {
  return nodeId
    .replace(/^z\d+-/, "")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildZoneStepperStages(topology: ZoneRunTopologyPreview) {
  const nodesById = new Map(topology.nodes.map((node) => [node.nodeId, node] as const));
  const depthByNodeId = new Map<string, number>();

  function visit(nodeId: string, depth: number) {
    const knownDepth = depthByNodeId.get(nodeId);
    if (knownDepth !== undefined && knownDepth >= depth) {
      return;
    }

    depthByNodeId.set(nodeId, depth);
    const node = nodesById.get(nodeId);
    if (!node) {
      return;
    }

    for (const nextNodeId of node.nextNodeIds) {
      visit(nextNodeId, depth + 1);
    }
  }

  visit(topology.startNodeId, 0);

  const grouped = new Map<number, ZoneRunTopologyPreview["nodes"]>();
  for (const node of topology.nodes) {
    const depth = depthByNodeId.get(node.nodeId) ?? 0;
    const existing = grouped.get(depth) ?? [];
    existing.push(node);
    grouped.set(depth, existing);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([depth, nodes]) => ({
      depth,
      nodes: [...nodes].sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
    }));
}

function resolveActiveStepperDepth(
  topology: ZoneRunTopologyPreview,
  activeRun: ActiveZoneRunSnapshot | null,
): number {
  if (activeRun === null) {
    return 0;
  }

  const stages = buildZoneStepperStages(topology);
  const depthByNodeId = new Map<string, number>();
  for (const stage of stages) {
    for (const node of stage.nodes) {
      depthByNodeId.set(node.nodeId, stage.depth);
    }
  }

  return depthByNodeId.get(activeRun.currentNodeId) ?? 0;
}

type ZonePathDiagramPoint = {
  key: string;
  kind: "entry" | "exit" | "node" | "subnode";
  x: number;
  y: number;
  label: string;
  title: string;
  done: boolean;
  current: boolean;
  branchOption: boolean;
};

type ZonePathDiagramEdge = {
  key: string;
  d: string;
  branchOption: boolean;
};

type ZonePathDiagram = {
  width: number;
  height: number;
  points: ZonePathDiagramPoint[];
  edges: ZonePathDiagramEdge[];
};

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildZonePathDiagram(
  topology: ZoneRunTopologyPreview,
  activeRun: ActiveZoneRunSnapshot | null,
): ZonePathDiagram {
  const stages = buildZoneStepperStages(topology);
  const depthByNodeId = new Map<string, number>();
  const nodeById = new Map(topology.nodes.map((node) => [node.nodeId, node] as const));
  const predecessorsByNodeId = new Map<string, string[]>();
  for (const stage of stages) {
    for (const node of stage.nodes) {
      depthByNodeId.set(node.nodeId, stage.depth);
      predecessorsByNodeId.set(node.nodeId, []);
    }
  }
  for (const node of topology.nodes) {
    for (const nextNodeId of node.nextNodeIds) {
      predecessorsByNodeId.set(nextNodeId, [
        ...(predecessorsByNodeId.get(nextNodeId) ?? []),
        node.nodeId,
      ]);
    }
  }

  const rowByNodeId = new Map<string, number>();
  for (const stage of stages) {
    if (stage.nodes.length === 1) {
      const onlyNode = stage.nodes[0]!;
      const predecessorRows = (predecessorsByNodeId.get(onlyNode.nodeId) ?? [])
        .map((nodeId) => rowByNodeId.get(nodeId))
        .filter((value): value is number => value !== undefined);
      rowByNodeId.set(onlyNode.nodeId, average(predecessorRows));
      continue;
    }

    const anchors = stage.nodes.map((node) => ({
      node,
      anchor: average(
        (predecessorsByNodeId.get(node.nodeId) ?? [])
          .map((nodeId) => rowByNodeId.get(nodeId))
          .filter((value): value is number => value !== undefined),
      ),
    }));
    const stageAnchor = average(anchors.map((entry) => entry.anchor));
    const startRow = stageAnchor - (stage.nodes.length - 1) / 2;
    [...anchors]
      .sort((left, right) => left.node.nodeId.localeCompare(right.node.nodeId))
      .forEach((entry, index) => {
        rowByNodeId.set(entry.node.nodeId, startRow + index);
      });
  }

  const rows = [...rowByNodeId.values()];
  const minRow = rows.length === 0 ? 0 : Math.min(...rows);
  const maxRow = rows.length === 0 ? 0 : Math.max(...rows);
  const laneGap = 76;
  const marginY = 40;
  const entryX = 28;
  const nodeGap = 42;
  const subnodeGap = 28;
  const maxSubnodes = Math.max(...topology.nodes.map((node) => node.subnodes.length), 1);
  const stageWidth = nodeGap + maxSubnodes * subnodeGap + 46;
  const stageStartX = 96;
  const exitX = stageStartX + stages.length * stageWidth;

  function stageX(depth: number): number {
    return stageStartX + depth * stageWidth;
  }

  function rowY(nodeId: string): number {
    return marginY + ((rowByNodeId.get(nodeId) ?? 0) - minRow) * laneGap;
  }

  function tokenStateForNode(nodeId: string) {
    const exitCurrent =
      activeRun !== null &&
      activeRun.currentSubnodeId === null &&
      activeRun.totalSubnodesTraversed >= activeRun.totalSubnodesInRun;
    const nodeCurrent =
      activeRun !== null &&
      activeRun.currentNodeId === nodeId &&
      activeRun.currentSubnodeId === null &&
      activeRun.lastConsumedSubnodeId === null &&
      !exitCurrent;
    const branchOption =
      activeRun?.state === "AWAITING_BRANCH" &&
      activeRun.branchOptions.includes(nodeId);
    const entered = activeRun?.enteredNodeIds.includes(nodeId) ?? false;
    const done = entered && !nodeCurrent;
    return { nodeCurrent, branchOption, done, exitCurrent };
  }

  const exitCurrent =
    activeRun !== null &&
    activeRun.currentSubnodeId === null &&
    activeRun.totalSubnodesTraversed >= activeRun.totalSubnodesInRun;
  const points: ZonePathDiagramPoint[] = [
    {
      key: "entry",
      kind: "entry",
      x: entryX,
      y: marginY + ((maxRow - minRow) * laneGap) / 2,
      label: ">>",
      title: "Entry",
      done: false,
      current: activeRun === null,
      branchOption: false,
    },
  ];
  const edges: ZonePathDiagramEdge[] = [];

  const nodePointById = new Map<string, { x: number; y: number }>();
  const tailPointByNodeId = new Map<string, { x: number; y: number }>();

  for (const stage of stages) {
    for (const node of stage.nodes) {
      const x = stageX(stage.depth);
      const y = rowY(node.nodeId);
      const state = tokenStateForNode(node.nodeId);
      points.push({
        key: `node:${node.nodeId}`,
        kind: "node",
        x,
        y,
        label: state.nodeCurrent ? "X" : "",
        title: `Node: ${formatNodeLabel(node.nodeId)}`,
        done: state.done,
        current: state.nodeCurrent,
        branchOption: state.branchOption,
      });
      nodePointById.set(node.nodeId, { x, y });

      let tailX = x;
      node.subnodes.forEach((subnode, index) => {
        const ordinal = index + 1;
        const subnodeCurrent =
          activeRun !== null &&
          activeRun.lastConsumedNodeId === node.nodeId &&
          activeRun.lastConsumedSubnodeOrdinal === ordinal;
        const subnodeDone =
          activeRun !== null &&
          ((activeRun.enteredNodeIds.includes(node.nodeId) &&
            activeRun.currentNodeId !== node.nodeId) ||
            (activeRun.lastConsumedNodeId === node.nodeId &&
              ordinal <= activeRun.lastConsumedSubnodeOrdinal));
        const subnodeX = x + nodeGap + index * subnodeGap;
        points.push({
          key: `subnode:${subnode.subnodeId}`,
          kind: "subnode",
          x: subnodeX,
          y,
          label: subnodeCurrent ? "x" : "",
          title: `Subnode ${ordinal} of ${formatNodeLabel(node.nodeId)}`,
          done: subnodeDone,
          current: subnodeCurrent,
          branchOption:
            Boolean(state.branchOption) &&
            activeRun?.state === "AWAITING_BRANCH" &&
            activeRun.branchOptions.includes(node.nodeId),
        });
        edges.push({
          key: `intra:${node.nodeId}:${subnode.subnodeId}`,
          d: `M ${tailX} ${y} L ${subnodeX} ${y}`,
          branchOption: false,
        });
        tailX = subnodeX;
      });
      tailPointByNodeId.set(node.nodeId, { x: tailX, y });
    }
  }

  const startNode = nodeById.get(topology.startNodeId);
  if (startNode) {
    const startPoint = nodePointById.get(startNode.nodeId);
    if (startPoint) {
      edges.push({
        key: "entry:start",
        d: `M ${entryX + 18} ${points[0]!.y} L ${startPoint.x - 22} ${startPoint.y}`,
        branchOption: false,
      });
    }
  }

  for (const node of topology.nodes) {
    const from = tailPointByNodeId.get(node.nodeId);
    if (!from) {
      continue;
    }
    for (const nextNodeId of node.nextNodeIds) {
      const to = nodePointById.get(nextNodeId);
      if (!to) {
        continue;
      }
      const branchOption =
        activeRun?.state === "AWAITING_BRANCH" &&
        activeRun.branchOptions.includes(nextNodeId);
      const midX = from.x + 18;
      edges.push({
        key: `edge:${node.nodeId}:${nextNodeId}`,
        d: `M ${from.x + 12} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${to.x - 22} ${to.y}`,
        branchOption: Boolean(branchOption),
      });
    }
  }

  const exitY = points[0]!.y;
  points.push({
    key: "exit",
    kind: "exit",
    x: exitX,
    y: exitY,
    label: ">>",
    title: "Exit",
    done: false,
    current: exitCurrent,
    branchOption: false,
  });
  for (const terminalNodeId of topology.terminalNodeIds) {
    const from = tailPointByNodeId.get(terminalNodeId);
    if (!from) {
      continue;
    }
    const midX = from.x + 18;
    edges.push({
      key: `exit:${terminalNodeId}`,
      d: `M ${from.x + 12} ${from.y} L ${midX} ${from.y} L ${midX} ${exitY} L ${exitX - 18} ${exitY}`,
      branchOption: false,
    });
  }

  return {
    width: exitX + 28,
    height: marginY * 2 + (maxRow - minRow) * laneGap,
    points,
    edges,
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
        <summary
          className={styles.menuSummary}
          aria-label={actionLabel ? `${walletStatusLabel}. ${actionLabel}` : walletStatusLabel}
          title={walletStatusLabel}
        >
          <span
            className={[
              styles.iconButton,
              props.connectionStatus === "connected" ? styles.iconButtonActive : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <WalletIcon className={styles.iconSvg} />
          </span>
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
  topology: ZoneRunTopologyPreview | null;
  topologyPending: boolean;
  topologyError: string | null;
  pending: boolean;
  refreshPending: boolean;
  error: string | null;
  onSelectZone: (zoneId: number) => void;
  onStartRun: () => Promise<void>;
  onRefreshRun: () => Promise<void>;
  onAdvance: () => Promise<void>;
  onChooseBranch: (nextNodeId: string) => Promise<void>;
  onContinue: () => Promise<void>;
  onAbandon: () => Promise<void>;
};

function ZoneRunStepper(props: {
  topology: ZoneRunTopologyPreview | null;
  topologyPending: boolean;
  topologyError: string | null;
  activeRun: ActiveZoneRunSnapshot | null;
}) {
  if (props.topologyPending && props.topology === null) {
    return <div className={styles.infoBox}>Loading zone stepper...</div>;
  }

  if (props.topologyError) {
    return <div className={styles.errorBox}>{props.topologyError}</div>;
  }

  if (props.topology === null) {
    return null;
  }

  const diagram = buildZonePathDiagram(props.topology, props.activeRun);

  return (
    <div className={styles.stack}>
      <div className={styles.stepperScroll}>
        <svg
          className={styles.pathDiagram}
          viewBox={`0 0 ${diagram.width} ${diagram.height}`}
          role="img"
          aria-label="Zone path diagram"
        >
          {diagram.edges.map((edge) => (
            <path
              key={edge.key}
              d={edge.d}
              className={[
                styles.pathEdge,
                edge.branchOption ? styles.pathEdgeBranch : "",
              ]
                .filter(Boolean)
                .join(" ")}
            />
          ))}

          {diagram.points.map((point) => {
            const className = [
              styles.pathShape,
              point.kind === "node" ? styles.pathShapeNode : "",
              point.kind === "subnode" ? styles.pathShapeSubnode : "",
              point.kind === "entry" || point.kind === "exit"
                ? styles.pathShapeGate
                : "",
              point.done ? styles.pathShapeDone : "",
              point.current ? styles.pathShapeCurrent : "",
              point.branchOption ? styles.pathShapeBranch : "",
            ]
              .filter(Boolean)
              .join(" ");

            if (point.kind === "entry" || point.kind === "exit") {
              return (
                <g key={point.key}>
                  <title>{point.title}</title>
                  <rect
                    x={point.x - 18}
                    y={point.y - 12}
                    width={36}
                    height={24}
                    rx={12}
                    className={className}
                  />
                  <text x={point.x} y={point.y + 4} className={styles.pathLabel}>
                    {point.label}
                  </text>
                </g>
              );
            }

            const radius = point.kind === "node" ? 15 : 9;
            return (
              <g key={point.key}>
                <title>{point.title}</title>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={radius}
                  className={className}
                />
                {point.label ? (
                  <text x={point.x} y={point.y + 4} className={styles.pathLabel}>
                    {point.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      {props.activeRun?.state === "AWAITING_BRANCH" ? (
        <div className={styles.noteText}>
          Branch options:{" "}
          {props.activeRun.branchOptions.map((nodeId) => formatNodeLabel(nodeId)).join(", ")}
        </div>
      ) : null}
    </div>
  );
}

function ZoneRunPanel(props: ZoneRunPanelProps) {
  const activeRun = props.activeRun;
  const canStartRun =
    activeRun === null &&
    props.character.battleEligible &&
    !props.pending;

  return (
    <section className={styles.panel}>
      <div className={styles.panelTitleRow}>
        <h2 className={styles.panelTitle}>Zone Run</h2>
      </div>

      <div className={styles.formGrid}>
        <ZoneRunStepper
          topology={props.topology}
          topologyPending={props.topologyPending}
          topologyError={props.topologyError}
          activeRun={activeRun}
        />

        {activeRun === null ? (
          <>
            <label className={styles.field}>
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
                {props.pending ? "Starting run..." : "Start"}
              </button>
              <button
                type="button"
                className={styles.button}
                onClick={() => void props.onRefreshRun()}
                disabled={props.refreshPending}
              >
                {props.refreshPending ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </>
        ) : (
          <>
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
            ) : null}

            {activeRun.state === "POST_BATTLE_PAUSE" ? (
              <div className={styles.buttonRow}>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonPrimary}`}
                  onClick={() => void props.onContinue()}
                  disabled={props.pending}
                >
                  {props.pending ? "Exiting..." : "Exit Zone"}
                </button>
              </div>
            ) : null}

            <div className={styles.buttonRow}>
              <button
                type="button"
                className={styles.button}
                onClick={() => void props.onRefreshRun()}
                disabled={props.refreshPending || props.pending}
              >
                {props.refreshPending ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </>
        )}

        {props.error ? <div className={styles.errorBox}>{props.error}</div> : null}
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

type CharacterSyncButtonProps = {
  character: CharacterReadModel;
  walletAvailability: WalletAvailability;
  walletConnectionStatus: WalletConnectionStatus;
  walletPublicKey: string | null;
  setWalletActionStatus: (status: WalletActionStatus) => void;
  onRefresh: () => Promise<CharacterReadModel | null>;
};

function CharacterSyncButton(props: CharacterSyncButtonProps) {
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
  const canSync = syncState.syncMode !== null;

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
    <div className={styles.syncControlStack}>
      <div className={styles.syncControlRow}>
        <button
          type="button"
          className={`${styles.iconButton} ${styles.iconButtonPrimary}`}
          onClick={() => void handleSync()}
          disabled={
            pending ||
            props.walletConnectionStatus !== "connected" ||
            !canSync ||
            Boolean(mismatchMessage)
          }
          aria-label="Sync character to Solana"
          title="Sync character to Solana"
        >
          <SyncIcon className={styles.iconSvg} />
        </button>

        <details className={styles.inlinePopover}>
          <summary
            className={styles.iconButton}
            aria-label="What sync does"
            title="What sync does"
          >
            <InfoIcon className={styles.iconSvg} />
          </summary>
          <div className={styles.inlinePopoverCard}>
            Sync writes your local character state to the Solana network so later
            settlement and progression can reconcile against chain state.
          </div>
        </details>
      </div>

      {stepMessage ? <div className={styles.syncFeedback}>{stepMessage}</div> : null}
      {props.walletAvailability === "not_installed" ? (
        <div className={styles.syncFeedback}>Install Phantom to use sync.</div>
      ) : null}
      {props.walletConnectionStatus !== "connected" ? (
        <div className={styles.syncFeedback}>Connect Phantom to use sync.</div>
      ) : null}
      {mismatchMessage ? <div className={styles.syncFeedbackError}>{mismatchMessage}</div> : null}
      {error ? <div className={styles.syncFeedbackError}>{error}</div> : null}
      {success ? <div className={styles.syncFeedbackSuccess}>{success}</div> : null}
    </div>
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
  const [zoneRunPending, setZoneRunPending] = useState(false);
  const [zoneRunError, setZoneRunError] = useState<string | null>(null);
  const [zoneRunRefreshPending, setZoneRunRefreshPending] = useState(false);
  const [zoneTopology, setZoneTopology] = useState<ZoneRunTopologyPreview | null>(null);
  const [zoneTopologyPending, setZoneTopologyPending] = useState(false);
  const [zoneTopologyError, setZoneTopologyError] = useState<string | null>(null);
  const [activeZoneRunDetail, setActiveZoneRunDetail] =
    useState<ActiveZoneRunSnapshot | null>(null);
  const [refreshPending, setRefreshPending] = useState(false);
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
      if (response.character?.activeZoneRun === null) {
        setActiveZoneRunDetail(null);
      }
      setAppPhase("ready");
      return response.character;
    } finally {
      setRefreshPending(false);
    }
  }

  async function refreshZoneTopology(
    zoneId: number,
    topologyVersion?: number,
  ): Promise<void> {
    setZoneTopologyPending(true);
    setZoneTopologyError(null);
    console.debug("[zone-run] loading topology", {
      zoneId,
      topologyVersion: topologyVersion ?? "latest",
    });

    try {
      const query = new URLSearchParams({
        zoneId: String(zoneId),
      });
      if (topologyVersion !== undefined) {
        query.set("topologyVersion", String(topologyVersion));
      }

      const response = await apiRequest<ZoneRunTopologyResponse>(
        `/api/zone-runs/topology?${query.toString()}`,
        { method: "GET", headers: undefined },
      );
      setZoneTopology(response.topology);
      console.debug("[zone-run] topology loaded", {
        zoneId: response.topology.zoneId,
        topologyVersion: response.topology.topologyVersion,
        nodeCount: response.topology.nodes.length,
        totalSubnodeCount: response.topology.totalSubnodeCount,
      });
    } catch (error) {
      setZoneTopology(null);
      setZoneTopologyError(
        error instanceof Error ? error.message : "Failed to load zone topology.",
      );
      console.error("[zone-run] topology load failed", error);
    } finally {
      setZoneTopologyPending(false);
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

  useEffect(() => {
    if (character === null) {
      setZoneTopology(null);
      setZoneTopologyError(null);
      return;
    }

    const zoneId = activeZoneRunDetail?.zoneId ?? selectedZoneId;
    const topologyVersion = activeZoneRunDetail?.topologyVersion;
    void refreshZoneTopology(zoneId, topologyVersion);
  }, [
    character?.characterId,
    selectedZoneId,
    activeZoneRunDetail?.zoneId,
    activeZoneRunDetail?.topologyVersion,
  ]);

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

  async function refreshActiveZoneRun(nextCharacter?: CharacterReadModel | null) {
    const activeCharacter = nextCharacter ?? character;
    if (!activeCharacter?.activeZoneRun) {
      setActiveZoneRunDetail(null);
      return;
    }

    setZoneRunRefreshPending(true);
    console.debug("[zone-run] refreshing active run", {
      characterId: activeCharacter.characterId,
      runId: activeCharacter.activeZoneRun.runId,
    });

    try {
      const response = await apiRequest<ZoneRunActionResponse>(
        `/api/zone-runs/active?characterId=${encodeURIComponent(activeCharacter.characterId)}`,
        { method: "GET", headers: undefined },
      );
      setActiveZoneRunDetail(response.activeRun);
      console.debug("[zone-run] active run refreshed", {
        runId: response.activeRun?.runId ?? null,
        state: response.activeRun?.state ?? null,
        currentNodeId: response.activeRun?.currentNodeId ?? null,
        currentSubnodeId: response.activeRun?.currentSubnodeId ?? null,
        closedRun: response.closedRunSummary?.zoneRunId ?? null,
      });
      if (response.closedRunSummary) {
        await refreshCharacter(activeCharacter.userId);
      }
    } catch (error) {
      console.error("[zone-run] refresh failed", error);
      throw error;
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
  ) {
    if (!character) {
      setZoneRunError("Create a character before starting a zone run.");
      return;
    }

    setZoneRunPending(true);
    setZoneRunError(null);
    console.debug("[zone-run] action start", { path, body });

    try {
      const response = await apiRequest<ZoneRunActionResponse>(path, {
        method: "POST",
        headers: {
          "Idempotency-Key": createIdempotencyKey(),
        },
        body: JSON.stringify(body),
      });

      setActiveZoneRunDetail(response.activeRun);
      console.debug("[zone-run] action success", {
        path,
        activeRun: response.activeRun
          ? {
              runId: response.activeRun.runId,
              state: response.activeRun.state,
              currentNodeId: response.activeRun.currentNodeId,
              currentSubnodeId: response.activeRun.currentSubnodeId,
            }
          : null,
        closedRun: response.closedRunSummary
          ? {
              zoneRunId: response.closedRunSummary.zoneRunId,
              terminalStatus: response.closedRunSummary.terminalStatus,
            }
          : null,
      });
      await refreshCharacter(character.userId);
    } catch (error) {
      setZoneRunError(
        error instanceof Error ? error.message : "Zone run action failed.",
      );
      console.error("[zone-run] action failed", { path, body, error });
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
    );
  }

  async function handleAdvanceZoneRun() {
    if (!character) {
      return;
    }

    await executeZoneRunAction(
      "/api/zone-runs/advance",
      { characterId: character.characterId },
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
    );
  }

  async function handleContinueZoneRun() {
    if (!character) {
      return;
    }

    await executeZoneRunAction(
      "/api/zone-runs/continue",
      { characterId: character.characterId },
    );
  }

  async function handleAbandonZoneRun() {
    if (!character) {
      return;
    }

    await executeZoneRunAction(
      "/api/zone-runs/abandon",
      { characterId: character.characterId },
    );
  }

  if (appPhase === "bootstrapping_user" || appPhase === "loading_character") {
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <header className={styles.header}>
            <h1 className={styles.title}>RUNARA</h1>
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
                <div className={styles.characterSummaryGrid}>
                  <div className={styles.characterSummaryCell}>
                    <span className={styles.characterSummaryValue}>
                      Name: {character.name}
                    </span>
                  </div>
                  <div className={styles.characterSummaryCell}>
                    <span className={styles.characterSummaryValue}>
                      Class: Placeholder
                    </span>
                  </div>
                  <div
                    className={`${styles.characterSummaryCell} ${styles.characterSummaryActions}`}
                  >
                    <CharacterSyncButton
                      character={character}
                      walletAvailability={walletAvailability}
                      walletConnectionStatus={walletConnectionStatus}
                      walletPublicKey={walletPublicKey}
                      setWalletActionStatus={setWalletActionStatus}
                      onRefresh={() => refreshCharacter(character.userId)}
                    />
                  </div>

                  <div className={styles.characterSummaryCell}>
                    <span className={styles.characterSummaryValue}>
                      LVL: {character.level}
                    </span>
                  </div>
                  <div className={styles.characterSummaryCell}>
                    <span className={styles.characterSummaryValue}>
                      EXP: {character.exp}/{nextLevelExpTarget(character.level)}
                    </span>
                  </div>
                  <div className={styles.characterSummaryCell} />

                  <div className={styles.characterSummaryCell}>
                    <span className={styles.characterSummaryMetric}>
                      <HeartIcon className={styles.inlineMetricIcon} />
                      <span>
                        : {character.stats.hp}/{character.stats.hpMax}
                      </span>
                    </span>
                  </div>
                  <div className={styles.characterSummaryCell} />
                  <div className={styles.characterSummaryCell} />
                </div>
              </section>

              <ZoneRunPanel
                character={character}
                selectedZoneId={selectedZoneId}
                activeRun={activeZoneRunDetail}
                topology={zoneTopology}
                topologyPending={zoneTopologyPending}
                topologyError={zoneTopologyError}
                pending={zoneRunPending}
                refreshPending={zoneRunRefreshPending}
                error={zoneRunError}
                onSelectZone={setSelectedZoneId}
                onStartRun={handleStartZoneRun}
                onRefreshRun={() => refreshActiveZoneRun(character)}
                onAdvance={handleAdvanceZoneRun}
                onChooseBranch={handleChooseZoneRunBranch}
                onContinue={handleContinueZoneRun}
                onAbandon={handleAbandonZoneRun}
              />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
