"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type TouchEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  AddressType,
  useConnect,
  useDisconnect as usePhantomDisconnect,
  usePhantom,
  useSolana,
} from "@phantom/react-sdk";

import type {
  SettlementV1FinalizeData,
  SettlementV1PrepareData,
  SettlementV1ResponseEnvelope,
  SettlementV1PresignData,
} from "../../types/api/settlementV1";
import type {
  CharacterCreateV1ResponseEnvelope,
  CharacterFirstSyncV1FinalizeData,
  CharacterFirstSyncV1PrepareData,
} from "../../types/api/characters";
import type {
  AccountMode,
  CharacterClassCatalogItem,
  CharacterClassesResponse,
  CharacterDetailResponse,
  CharacterReadModel,
  CharacterRosterItem,
  CharacterRosterResponse,
  CharacterSyncDetailResponse,
  CreateCharacterResponse,
  CurrentSeasonResponse,
  RunShareResponse,
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
import { logPhantomConnectClientEvent } from "../../lib/observability/phantomConnectClient";
import {
  normalizeWalletError,
  signAuthorizationMessageUtf8,
  signAndSendPreparedPlayerOwnedTransaction,
  type PhantomSolanaProvider,
  type WalletActionStatus,
  type WalletAvailability,
  type WalletConnectionStatus,
} from "../../lib/solana/phantomBrowser";
import {
  createReactSdkSolanaProvider,
  getReactSdkSolanaAddress,
} from "../../lib/solana/reactPhantomBridge";
import {
  deserializeLegacyOrVersionedTransactionBase64,
  serializeLegacyOrVersionedTransactionBase64,
} from "../../lib/solana/playerOwnedV0Transactions";
import { canUseSkillDuringPostBattlePause } from "../../lib/combat/zoneRunSkillMetadata";
import { getSkillDef } from "../../engine/battle/skillRegistry";

const PENDING_SYNC_STORAGE_KEY = "keep-pushing:pending-sync-acks";

type AppPhase =
  | "bootstrapping_session"
  | "loading_character"
  | "ready"
  | "fatal_error";

type ShellView = "landing" | "roster" | "create" | "character" | "run" | "sync";

type ApiErrorShape = {
  error?: string;
};

type ApiEnvelopeErrorShape = {
  ok?: false;
  error?: {
    code?: string;
    message?: string;
  };
};

type AuthNonceResponse = {
  ok: true;
  data: {
    nonceId: string;
    nonce: string;
    expiresAt: string;
    messageToSign: string;
  };
};

type AuthVerifyResponse = {
  ok: true;
  data: {
    user: {
      id: string;
      walletAddress: string;
    };
    session: {
      id: string;
      expiresAt: string;
    };
  };
};

type ApiError = Error & {
  status?: number;
};

type PhantomAuthProvider = "google" | "apple";

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
    const error = new Error(message) as ApiError;
    error.status = response.status;
    throw error;
  }

  return data as T;
}

async function apiEnvelopeRequest<T>(
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
    | SettlementV1ResponseEnvelope<T>
    | CharacterCreateV1ResponseEnvelope<T>
    | ApiEnvelopeErrorShape
    | null;

  if (!response.ok) {
    const code =
      isObject(data) &&
      "error" in data &&
      isObject(data.error) &&
      typeof data.error.code === "string"
        ? data.error.code
        : `Request failed with status ${response.status}`;
    const error = new Error(code) as ApiError;
    error.status = response.status;
    throw error;
  }

  if (!isObject(data) || data.ok !== true || !("data" in data)) {
    const error = new Error("Malformed API envelope.") as ApiError;
    error.status = response.status;
    throw error;
  }

  return data.data as T;
}

function getApiErrorStatus(error: unknown): number | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    return (error as { status: number }).status;
  }

  return null;
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

function formatCountdown(targetTs: number | null): string {
  if (targetTs === null) {
    return "Not available";
  }

  const nowTs = Math.floor(Date.now() / 1000);
  const remaining = Math.max(0, targetTs - nowTs);
  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function seasonTargetTs(season: CurrentSeasonResponse | null): number | null {
  if (season === null) {
    return null;
  }

  if (season.phase === "active") {
    return season.seasonEndTs;
  }
  if (season.phase === "grace") {
    return season.commitGraceEndTs;
  }
  return null;
}

function seasonCountdownLabel(season: CurrentSeasonResponse | null): string {
  if (season === null) {
    return "Season timing unavailable";
  }

  if (season.phase === "active") {
    return `Season ends in ${formatCountdown(season.seasonEndTs)}`;
  }

  if (season.phase === "grace") {
    return `Grace ends in ${formatCountdown(season.commitGraceEndTs)}`;
  }

  return "Season closed";
}

function seasonTone(
  phase: CurrentSeasonResponse["phase"] | null | undefined,
): "neutral" | "warning" | "success" | "danger" | "info" {
  switch (phase) {
    case "active":
      return "success";
    case "grace":
      return "warning";
    case "ended":
      return "danger";
    default:
      return "neutral";
  }
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

function PeopleIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={props.className}>
      <circle
        cx="9"
        cy="9"
        r="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle
        cx="16.5"
        cy="10.5"
        r="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M4.5 18a4.5 4.5 0 0 1 9 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M14 18a3.5 3.5 0 0 1 6 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BackIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={props.className}>
      <path
        d="M14.5 6.5 9 12l5.5 5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
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
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `zone-run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type PendingSyncAckRecord = {
  kind: "first_sync" | "settlement";
  characterId: string;
  transactionSignature: string;
  prepareRequestId?: string;
  prepared: unknown;
};

function readPendingSyncAck(characterId: string): PendingSyncAckRecord | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(PENDING_SYNC_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }

    const match = parsed.find((entry) => {
      return (
        typeof entry === "object" &&
        entry !== null &&
        "characterId" in entry &&
        (entry as { characterId?: unknown }).characterId === characterId
      );
    });
    return (match as PendingSyncAckRecord | undefined) ?? null;
  } catch {
    return null;
  }
}

function writePendingSyncAck(record: PendingSyncAckRecord): void {
  if (typeof window === "undefined") {
    return;
  }

  const raw = window.localStorage.getItem(PENDING_SYNC_STORAGE_KEY);
  const existing = (() => {
    try {
      return raw ? (JSON.parse(raw) as PendingSyncAckRecord[]) : [];
    } catch {
      return [];
    }
  })();

  const next = existing.filter(
    (entry) => entry.characterId !== record.characterId,
  );
  next.push(record);
  window.localStorage.setItem(PENDING_SYNC_STORAGE_KEY, JSON.stringify(next));
}

function clearPendingSyncAck(characterId: string): void {
  if (typeof window === "undefined") {
    return;
  }

  const raw = window.localStorage.getItem(PENDING_SYNC_STORAGE_KEY);
  if (!raw) {
    return;
  }

  try {
    const parsed = JSON.parse(raw) as PendingSyncAckRecord[];
    const next = parsed.filter((entry) => entry.characterId !== characterId);
    if (next.length === 0) {
      window.localStorage.removeItem(PENDING_SYNC_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(PENDING_SYNC_STORAGE_KEY, JSON.stringify(next));
  } catch {
    window.localStorage.removeItem(PENDING_SYNC_STORAGE_KEY);
  }
}

function formatNodeLabel(nodeId: string): string {
  return nodeId
    .replace(/^z\d+-/, "")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildZoneStepperStages(topology: ZoneRunTopologyPreview) {
  const nodesById = new Map(
    topology.nodes.map((node) => [node.nodeId, node] as const),
  );
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
      nodes: [...nodes].sort((left, right) =>
        left.nodeId.localeCompare(right.nodeId),
      ),
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

function buildRunWindowStages(
  topology: ZoneRunTopologyPreview,
  activeRun: ActiveZoneRunSnapshot | null,
) {
  const stages = buildZoneStepperStages(topology);
  const activeDepth = resolveActiveStepperDepth(topology, activeRun);

  return stages.filter(
    (stage) =>
      stage.depth >= Math.max(0, activeDepth - 1) &&
      stage.depth <= activeDepth + 1,
  );
}

function resolveSubnodeState(args: {
  activeRun: ActiveZoneRunSnapshot | null;
  nodeId: string;
  ordinal: number;
}) {
  const { activeRun, nodeId, ordinal } = args;
  if (activeRun === null) {
    return {
      done: false,
      current: ordinal === 1,
      branchOption: false,
    };
  }

  const current =
    activeRun.currentNodeId === nodeId &&
    activeRun.currentSubnodeId !== null &&
    activeRun.currentSubnodeOrdinal === ordinal;
  const done =
    activeRun.lastConsumedNodeId === nodeId &&
    ordinal <= activeRun.lastConsumedSubnodeOrdinal
      ? true
      : activeRun.enteredNodeIds.includes(nodeId) &&
        activeRun.currentNodeId !== nodeId;

  return {
    done,
    current,
    branchOption: false,
  };
}

type ZonePathDiagramPoint = {
  key: string;
  kind: "entry" | "exit" | "node" | "subnode";
  x: number;
  y: number;
  label: string;
  title: string;
  nodeId?: string;
  done: boolean;
  current: boolean;
  branchOption: boolean;
};

type ZonePathDiagramEdge = {
  key: string;
  d: string;
  fromNodeId?: string;
  toNodeId?: string;
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
  const nodeById = new Map(
    topology.nodes.map((node) => [node.nodeId, node] as const),
  );
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
  const maxSubnodes = Math.max(
    ...topology.nodes.map((node) => node.subnodes.length),
    1,
  );
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
        nodeId: node.nodeId,
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
          nodeId: node.nodeId,
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
          fromNodeId: node.nodeId,
          toNodeId: node.nodeId,
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
        fromNodeId: node.nodeId,
        toNodeId: nextNodeId,
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
      fromNodeId: terminalNodeId,
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
  classes: CharacterClassCatalogItem[];
  selectedClassId: string | null;
  slotIndex: number;
  name: string;
  pending: boolean;
  error: string | null;
  onClassSelect: (classId: string) => void;
  onNameChange: (value: string) => void;
  onBack: () => void;
  onSubmit: () => void;
};

function CreateCharacterPanel(props: CreateCharacterPanelProps) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelTitleRow}>
        <div className={styles.stack}>
          <h2 className={styles.panelTitle}>Create Character</h2>
          <p className={styles.panelText}>
            Choose a class, claim a unique name, and drop straight into the
            current season.
          </p>
        </div>
      </div>

      <div className={styles.formGrid}>
        <div className={styles.inlineStack}>
          <span className={styles.keyLabel}>Slot</span>
          <span className={styles.keyValue}>#{props.slotIndex + 1}</span>
        </div>

        <div className={styles.classGrid}>
          {props.classes.map((item) => (
            <button
              key={item.classId}
              type="button"
              className={[
                styles.classCard,
                props.selectedClassId === item.classId
                  ? styles.classCardSelected
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => props.onClassSelect(item.classId)}
              disabled={props.pending || !item.enabled}
            >
              <span className={styles.classCardTitle}>{item.displayName}</span>
              <span className={styles.classCardText}>{item.description}</span>
            </button>
          ))}
        </div>

        <label className={styles.field}>
          <span className={styles.label}>Character name</span>
          <input
            className={styles.input}
            value={props.name}
            onChange={(event) => props.onNameChange(event.target.value)}
            placeholder="Aegis"
            maxLength={16}
            disabled={props.pending || props.selectedClassId === null}
          />
        </label>

        {props.error ? (
          <div className={styles.errorBox}>{props.error}</div>
        ) : null}

        <div className={styles.buttonRow}>
          <button
            type="button"
            className={styles.button}
            onClick={props.onBack}
            disabled={props.pending}
          >
            Back
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary}`}
            onClick={props.onSubmit}
            disabled={props.pending || props.selectedClassId === null}
          >
            {props.pending ? "Creating Character..." : "Create Character"}
          </button>
        </div>
      </div>
    </section>
  );
}

type LandingPanelProps = {
  connectionStatus: WalletConnectionStatus;
  pending: boolean;
  onConnect: (provider: PhantomAuthProvider) => Promise<void>;
};

function LandingPanel(props: LandingPanelProps) {
  return (
    <section className={`${styles.panel} ${styles.heroPanel}`}>
      <div className={styles.stack}>
        <span className={styles.eyebrow}>Phantom Connect</span>
        <h2 className={styles.heroTitle}>
          Connect Phantom to enter the season.
        </h2>
        <p className={styles.panelText}>
          Wallet-backed sessions are now the only login path. Sign in with
          Phantom to load your roster, create a character, and submit
          sponsored on-chain sync flows.
        </p>
        <div className={styles.buttonRow}>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary}`}
            onClick={() => void props.onConnect("google")}
            disabled={props.pending}
          >
            {props.connectionStatus === "connecting"
              ? "Connecting..."
              : "Continue with Google"}
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={() => void props.onConnect("apple")}
            disabled={props.pending}
          >
            {props.connectionStatus === "connecting"
              ? "Connecting..."
              : "Continue with Apple"}
          </button>
        </div>
      </div>
    </section>
  );
}

type RosterPanelProps = {
  accountMode: AccountMode;
  slotsTotal: number;
  characters: CharacterRosterItem[];
  onCreate: (slotIndex: number) => void;
  onOpenCharacter: (characterId: string) => void;
};

function RosterPanel(props: RosterPanelProps) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelTitleRow}>
        <div className={styles.stack}>
          <h2 className={styles.panelTitle}>Characters</h2>
          <p className={styles.panelText}>
            {props.accountMode === "anon"
              ? "Anonymous mode currently gives you one playable slot."
              : "Wallet-linked mode gives you three character slots."}
          </p>
        </div>
        <StatusBadge
          label={props.accountMode === "anon" ? "Anon" : "Wallet-linked"}
          tone={props.accountMode === "anon" ? "neutral" : "info"}
        />
      </div>

      <div className={styles.slotGrid}>
        {Array.from({ length: props.slotsTotal }, (_, index) => {
          const character =
            props.characters.find((item) => item.slotIndex === index) ?? null;

          if (character === null) {
            return (
              <button
                key={`slot-${index}`}
                type="button"
                className={`${styles.slotCard} ${styles.slotCardEmpty}`}
                onClick={() => props.onCreate(index)}
              >
                <span className={styles.slotEyebrow}>Slot {index + 1}</span>
                <span className={styles.slotTitle}>Create Character</span>
                <span className={styles.slotText}>
                  Pick a class and claim a unique name to start your run.
                </span>
              </button>
            );
          }

          return (
            <button
              key={character.characterId}
              type="button"
              className={styles.slotCard}
              onClick={() => props.onOpenCharacter(character.characterId)}
            >
              <span className={styles.slotEyebrow}>Slot {index + 1}</span>
              <span className={styles.slotTitle}>{character.name}</span>
              <span className={styles.slotText}>
                {character.classId} · Level {character.level}
              </span>
              <div className={styles.inlineStack}>
                <StatusBadge
                  label={character.syncStatus}
                  tone={settlementTone(character.syncStatus)}
                />
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

type WalletToolbarProps = {
  availability: WalletAvailability;
  connectionStatus: WalletConnectionStatus;
  actionStatus: WalletActionStatus;
  signedIn: boolean;
  sessionWalletAddress: string | null;
  publicKey: string | null;
  error: string | null;
  pending: boolean;
  refreshPending: boolean;
  onConnect: (provider?: PhantomAuthProvider) => Promise<void>;
  onDisconnect: () => Promise<void>;
  onRefresh: () => void;
};

function WalletToolbar(props: WalletToolbarProps) {
  const actionLabel = walletActionLabel(props.actionStatus);
  const walletStatusLabel =
    props.connectionStatus === "connected"
      ? `Wallet ${truncateMiddle(props.publicKey)}`
      : "Wallet disconnected";

  return (
    <div className={styles.menuWrap}>
      <details className={styles.menu}>
        <summary
          className={styles.menuSummary}
          aria-label={
            actionLabel
              ? `${walletStatusLabel}. ${actionLabel}`
              : walletStatusLabel
          }
          title={walletStatusLabel}
        >
          <span
            className={[
              styles.iconButton,
              props.connectionStatus === "connected"
                ? styles.iconButtonActive
                : "",
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
              <span className={styles.keyLabel}>Session</span>
              <span className={styles.keyValue}>
                {props.signedIn
                  ? props.sessionWalletAddress ?? props.publicKey
                    ? `Active ${truncateMiddle(
                        props.sessionWalletAddress ?? props.publicKey,
                      )}`
                    : "Active"
                  : "Signed out"}
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
            {props.signedIn ? (
              <button
                type="button"
                className={styles.button}
                onClick={() => void props.onDisconnect()}
                disabled={props.pending}
              >
                Sign Out
              </button>
            ) : (
              <button
                type="button"
                className={styles.button}
                onClick={() => void props.onConnect("google")}
                disabled={props.pending}
              >
                {props.connectionStatus === "connecting"
                  ? "Connecting..."
                  : props.connectionStatus === "connected"
                    ? "Sign In"
                    : "Connect Phantom"}
              </button>
            )}

            <button
              type="button"
              className={styles.button}
              onClick={props.onRefresh}
              disabled={props.refreshPending || !props.signedIn}
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
  season: CurrentSeasonResponse | null;
  selectedZoneId: number;
  activeRun: ActiveZoneRunSnapshot | null;
  resumePending: boolean;
  topology: ZoneRunTopologyPreview | null;
  topologyPending: boolean;
  topologyError: string | null;
  pending: boolean;
  refreshPending: boolean;
  error: string | null;
  onBack: () => void;
  onSelectZone: (zoneId: number) => void;
  onStartRun: () => Promise<void>;
  onRefreshRun: () => Promise<void>;
  onAdvance: () => Promise<void>;
  onChooseBranch: (nextNodeId: string) => Promise<void>;
  onUsePauseSkill: (skillId: string) => Promise<void>;
  onContinue: () => Promise<void>;
  onAbandon: () => Promise<void>;
  onShareRun: (runId: string) => Promise<void>;
};

function ZoneRunMapWindow(props: {
  topology: ZoneRunTopologyPreview | null;
  topologyPending: boolean;
  topologyError: string | null;
  activeRun: ActiveZoneRunSnapshot | null;
}) {
  if (props.topologyPending && props.topology === null) {
    return <div className={styles.infoBox}>Loading zone map...</div>;
  }

  if (props.topologyError) {
    return <div className={styles.errorBox}>{props.topologyError}</div>;
  }

  if (props.topology === null) {
    return null;
  }

  const diagram = buildZonePathDiagram(props.topology, props.activeRun);
  const stages = buildRunWindowStages(props.topology, props.activeRun);
  const highlightedNodeIds = new Set(
    stages.flatMap((stage) => stage.nodes.map((node) => node.nodeId)),
  );

  return (
    <section className={styles.visualMapShell}>
      <div className={styles.panelTitleRow}>
        <div className={styles.stack}>
          <span className={styles.slotEyebrow}>Zone Map</span>
          <h3 className={styles.panelTitle}>Active route</h3>
          <p className={styles.panelText}>
            The full topology stays visible while only the previous, current,
            and next depth stay highlighted.
          </p>
        </div>
      </div>

      <div className={styles.visualMapFrame}>
        <svg
          viewBox={`0 0 ${diagram.width} ${diagram.height}`}
          className={styles.visualMapSvg}
          role="img"
          aria-label="Active zone route map"
        >
          {diagram.edges.map((edge) => {
            const inWindow =
              edge.fromNodeId === undefined ||
              edge.toNodeId === undefined ||
              highlightedNodeIds.has(edge.fromNodeId) ||
              highlightedNodeIds.has(edge.toNodeId);

            return (
              <path
                key={edge.key}
                d={edge.d}
                className={[
                  styles.visualMapEdge,
                  edge.branchOption ? styles.visualMapEdgeBranch : "",
                  !inWindow ? styles.visualMapEdgeMuted : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              />
            );
          })}

          {diagram.points.map((point) => {
            const inWindow =
              point.kind === "entry" ||
              point.kind === "exit" ||
              point.nodeId === undefined ||
              highlightedNodeIds.has(point.nodeId);

            return (
              <g
                key={point.key}
                className={[
                  styles.visualMapPoint,
                  point.done ? styles.visualMapPointDone : "",
                  point.current ? styles.visualMapPointCurrent : "",
                  point.branchOption ? styles.visualMapPointBranch : "",
                  !inWindow ? styles.visualMapPointMuted : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <title>{point.title}</title>
                {point.kind === "subnode" ? (
                  <circle cx={point.x} cy={point.y} r={9} />
                ) : (
                  <rect
                    x={point.x - 18}
                    y={point.y - 18}
                    width={36}
                    height={36}
                    rx={12}
                    ry={12}
                  />
                )}
                {point.label ? (
                  <text
                    x={point.x}
                    y={point.y + 1}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className={styles.visualMapGlyph}
                  >
                    {point.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      <div className={styles.visualMapStageGrid}>
        {stages.map((stage, index) => (
          <div key={stage.depth} className={styles.visualMapStageCard}>
            <span className={styles.slotEyebrow}>
              {index === 0 ? "Previous" : index === 1 ? "Current" : "Next"}
            </span>
            <div className={styles.visualMapStageNodes}>
              {stage.nodes.map((node) => (
                <span
                  key={node.nodeId}
                  className={[
                    styles.visualMapStageChip,
                    props.activeRun?.currentNodeId === node.nodeId
                      ? styles.visualMapStageChipCurrent
                      : props.activeRun?.branchOptions.includes(node.nodeId)
                        ? styles.visualMapStageChipBranch
                        : props.activeRun?.enteredNodeIds.includes(node.nodeId)
                          ? styles.visualMapStageChipDone
                          : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {formatNodeLabel(node.nodeId)}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {props.activeRun?.state === "AWAITING_BRANCH" ? (
        <div className={styles.noteText}>
          Branch options:{" "}
          {props.activeRun.branchOptions
            .map((nodeId) => formatNodeLabel(nodeId))
            .join(", ")}
        </div>
      ) : null}
    </section>
  );
}

function ZoneRunPanel(props: ZoneRunPanelProps) {
  const activeRun = props.activeRun;
  const unlockedZoneCount = maxUnlockedZone(props.character);
  const canStartRun =
    activeRun === null &&
    !props.resumePending &&
    props.character.battleEligible &&
    !props.pending &&
    props.selectedZoneId <= unlockedZoneCount;
  const pauseSkills = props.character.activeSkills
    .filter((skillId) => canUseSkillDuringPostBattlePause(skillId))
    .map((skillId) => getSkillDef(skillId));
  const completedRunPreview =
    activeRun !== null &&
    activeRun.state === "POST_BATTLE_PAUSE" &&
    activeRun.totalSubnodesTraversed >= activeRun.totalSubnodesInRun;
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const zoneIds = Array.from(
    { length: Math.max(1, unlockedZoneCount + 1) },
    (_, index) => index + 1,
  );
  const activeZoneId = zoneIds.includes(props.selectedZoneId)
    ? props.selectedZoneId
    : (zoneIds[0] ?? 1);
  const activeZoneIndex = zoneIds.indexOf(activeZoneId);
  const displayZoneId = zoneIds[activeZoneIndex] ?? 1;
  const displayZoneUnlocked = displayZoneId <= unlockedZoneCount;
  const canGoPreviousZone = activeZoneIndex > 0;
  const canGoNextZone = activeZoneIndex < zoneIds.length - 1;

  function cycleZone(direction: -1 | 1) {
    if (zoneIds.length === 0) {
      return;
    }

    const nextIndex = Math.min(
      zoneIds.length - 1,
      Math.max(0, activeZoneIndex + direction),
    );
    const nextZoneId = zoneIds[nextIndex];
    if (nextZoneId !== undefined) {
      props.onSelectZone(nextZoneId);
    }
  }

  function handleCarouselTouchStart(event: TouchEvent<HTMLDivElement>) {
    setTouchStartX(event.changedTouches[0]?.clientX ?? null);
  }

  function handleCarouselTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const startX = touchStartX;
    const endX = event.changedTouches[0]?.clientX ?? null;
    setTouchStartX(null);

    if (startX === null || endX === null) {
      return;
    }

    const deltaX = endX - startX;
    if (Math.abs(deltaX) < 36) {
      return;
    }

    cycleZone(deltaX < 0 ? 1 : -1);
  }

  return (
    <section className={`${styles.panel} ${styles.runPanelFull}`}>
      <div className={styles.panelTitleRow}>
        <button
          type="button"
          className={styles.backTextButton}
          onClick={props.onBack}
          disabled={props.pending}
          aria-label="Back to character page"
          title="Back to character page"
        >
          {"<- Back to character"}
        </button>
      </div>

      <div className={`${styles.formGrid} ${styles.runPanelBody}`}>
        {activeRun === null ? (
          <>
            {props.resumePending ? (
              <div className={styles.infoBox}>
                Restoring the active run snapshot from the server.
              </div>
            ) : (
              <div className={styles.zoneCarouselStage}>
                <div
                  className={styles.zoneCarousel}
                  onTouchStart={handleCarouselTouchStart}
                  onTouchEnd={handleCarouselTouchEnd}
                >
                  <div
                    className={[
                      styles.zoneCard,
                      displayZoneUnlocked
                        ? styles.zoneCardUnlocked
                        : styles.zoneCardLocked,
                      displayZoneId === 1 ? styles.zoneCardZone1 : "",
                      styles.zoneCardSelected,
                      styles.zoneCarouselCard,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <button
                      type="button"
                      className={`${styles.iconButton} ${styles.zoneCarouselIconButton} ${styles.zoneCarouselIconButtonLeft}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        cycleZone(-1);
                      }}
                      disabled={props.pending || !canGoPreviousZone}
                      aria-label="Previous zone"
                    >
                      <span className={styles.zoneCarouselIcon}>&#8249;</span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.iconButton} ${styles.zoneCarouselIconButton} ${styles.zoneCarouselIconButtonRight}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        cycleZone(1);
                      }}
                      disabled={props.pending || !canGoNextZone}
                      aria-label="Next zone"
                    >
                      <span className={styles.zoneCarouselIcon}>&#8250;</span>
                    </button>
                    <div className={styles.zoneCarouselCopy}>
                      <span
                        className={`${styles.slotEyebrow} ${styles.zoneCarouselCaption} ${styles.zoneCarouselCaptionEyebrow}`}
                      >
                        Zone {displayZoneId}
                      </span>
                      <span
                        className={`${styles.slotTitle} ${styles.zoneCarouselCaption} ${styles.zoneCarouselCaptionTitle}`}
                      >
                        {displayZoneId === 1
                          ? "Fringe Fields"
                          : displayZoneUnlocked
                            ? "Ready to enter"
                            : "Locked"}
                      </span>
                      <span
                        className={`${styles.slotText} ${styles.zoneCarouselCaption} ${styles.zoneCarouselCaptionBody}`}
                      >
                        {displayZoneId === 1
                          ? "A quiet stretch of reclaimed land where broken machines lie scattered and forgotten."
                          : displayZoneUnlocked
                            ? displayZoneId === unlockedZoneCount
                              ? "Highest unlocked zone. Stronger rewards, higher risk."
                              : "Unlocked and ready for a fresh run."
                            : "Finish earlier zones to unlock this route."}
                      </span>
                    </div>
                    <div
                      className={`${styles.buttonRow} ${styles.runActionRow} ${styles.zoneCarouselActions}`}
                    >
                      <button
                        type="button"
                        className={styles.iconButton}
                        onClick={(event) => {
                          event.stopPropagation();
                          void props.onRefreshRun();
                        }}
                        disabled={props.refreshPending}
                        aria-label="Refresh run state"
                        title="Refresh run state"
                      >
                        <SyncIcon className={styles.iconSvg} />
                      </button>
                      <button
                        type="button"
                        className={`${styles.button} ${styles.buttonPrimary}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          void props.onStartRun();
                        }}
                        disabled={!canStartRun}
                      >
                        {props.pending ? "Starting run..." : "Start Run"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <ZoneRunMapWindow
              topology={props.topology}
              topologyPending={props.topologyPending}
              topologyError={props.topologyError}
              activeRun={activeRun}
            />

            <div className={styles.infoBox}>
              {completedRunPreview
                ? "Run complete. Share the preview now or exit the pause to finalize the result page."
                : activeRun.state === "POST_BATTLE_PAUSE"
                  ? "Post-battle pause is live. Support and recovery skills can be used before continuing."
                  : activeRun.state === "AWAITING_BRANCH"
                    ? "Choose the next node from the currently legal branches."
                    : "Advance one subnode at a time through the authored zone path."}
            </div>

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
                    Enter {formatNodeLabel(branchNodeId)}
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
              <>
                {pauseSkills.length > 0 ? (
                  <div className={styles.buttonRow}>
                    {pauseSkills.map((skill) => (
                      <button
                        key={skill.skillId}
                        type="button"
                        className={styles.button}
                        onClick={() =>
                          void props.onUsePauseSkill(skill.skillId)
                        }
                        disabled={props.pending}
                      >
                        Use {skill.skillName}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className={styles.buttonRow}>
                  {completedRunPreview ? (
                    <button
                      type="button"
                      className={styles.button}
                      onClick={() => void props.onShareRun(activeRun.runId)}
                      disabled={props.pending}
                    >
                      Share Preview
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={`${styles.button} ${styles.buttonPrimary}`}
                    onClick={() => void props.onContinue()}
                    disabled={props.pending}
                  >
                    {props.pending
                      ? "Exiting..."
                      : completedRunPreview
                        ? "Exit Zone"
                        : "Continue"}
                  </button>
                </div>
              </>
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

        {props.error ? (
          <div className={styles.errorBox}>{props.error}</div>
        ) : null}
      </div>
    </section>
  );
}

type CharacterSyncButtonProps = {
  character: CharacterReadModel;
  onOpen: () => void;
};

function CharacterSyncButton(props: CharacterSyncButtonProps) {
  const syncState = resolveSyncPanelState(props.character);
  const pendingAck = readPendingSyncAck(props.character.characterId) !== null;
  const feedbackMessage = pendingAck
    ? "Submitted tx is waiting for server acknowledgement."
    : syncState.syncMode === null
      ? "Chain state is caught up."
      : null;

  return (
    <div className={styles.syncControlStack}>
      <div className={styles.syncControlRow}>
        <button
          type="button"
          className={`${styles.iconButton} ${styles.iconButtonPrimary}`}
          onClick={props.onOpen}
          aria-label="Open sync page"
          title="Open sync page"
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
            Sync writes character progression to Solana and shows whether any
            submitted tx still needs acknowledgement.
          </div>
        </details>
      </div>

      {feedbackMessage ? (
        <div className={styles.syncFeedback}>{feedbackMessage}</div>
      ) : null}
    </div>
  );
}

type CharacterSyncPageProps = {
  detail: CharacterSyncDetailResponse;
  walletAvailability: WalletAvailability;
  walletConnectionStatus: WalletConnectionStatus;
  walletPublicKey: string | null;
  walletProvider: PhantomSolanaProvider | null;
  setWalletActionStatus: (status: WalletActionStatus) => void;
  onConnectWallet: () => Promise<void>;
  onRefreshCharacter: () => Promise<CharacterReadModel | null>;
  onRefreshSyncDetail: () => Promise<CharacterSyncDetailResponse | null>;
  onBack: () => void;
};

function CharacterSyncPage(props: CharacterSyncPageProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stepMessage, setStepMessage] = useState<string | null>(null);
  const [pendingAck, setPendingAck] = useState<PendingSyncAckRecord | null>(
    readPendingSyncAck(props.detail.character.characterId),
  );

  const { character, season, sync } = props.detail;
  const syncState = resolveSyncPanelState(character);
  const mismatchMessage = authorityMismatchMessage(
    character,
    props.walletPublicKey,
  );

  useEffect(() => {
    setPendingAck(readPendingSyncAck(character.characterId));
    setError(null);
    setNotice(null);
    setStepMessage(null);
  }, [
    character.characterId,
    character.syncPhase,
    character.nextPendingSettlementRun?.zoneRunId,
  ]);

  async function refreshAll() {
    await props.onRefreshCharacter();
    await props.onRefreshSyncDetail();
    setPendingAck(readPendingSyncAck(character.characterId));
  }

  async function acknowledgePending(record: PendingSyncAckRecord) {
    if (record.kind === "first_sync") {
      const response = await apiEnvelopeRequest<CharacterFirstSyncV1FinalizeData>(
        "/api/v1/characters/first-sync/finalize",
        {
          method: "POST",
          body: JSON.stringify({
            prepared: record.prepared,
            transactionSignature: record.transactionSignature,
          }),
        },
      );

      clearPendingSyncAck(record.characterId);
      setPendingAck(null);
      await refreshAll();
      setNotice(
        response.phase === "confirmed"
          ? `First sync confirmed. Tx ${truncateMiddle(response.transactionSignature)}`
          : `First sync is still in flight. Tx ${truncateMiddle(response.transactionSignature)}`,
      );
      return;
    }

    const response = await apiEnvelopeRequest<SettlementV1FinalizeData>(
      "/api/v1/settlement/finalize",
      {
        method: "POST",
        body: JSON.stringify({
          prepareRequestId: record.prepareRequestId,
          transactionSignature: record.transactionSignature,
        }),
      },
    );

    clearPendingSyncAck(record.characterId);
    setPendingAck(null);
    await refreshAll();
    setNotice(
      response.phase === "confirmed"
        ? `Settlement confirmed. Tx ${truncateMiddle(response.transactionSignature)}`
        : `Settlement is still reconciling. Tx ${truncateMiddle(response.transactionSignature)}`,
    );
  }

  async function handleSync() {
    if (pendingAck) {
      setPending(true);
      setError(null);
      setNotice(null);
      setStepMessage("Retrying server acknowledgement");

      try {
        await acknowledgePending(pendingAck);
      } catch (nextError) {
        setError(normalizeWalletError(nextError));
      } finally {
        setStepMessage(null);
        setPending(false);
      }
      return;
    }

    if (syncState.syncMode === null) {
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

    const provider = props.walletProvider;
    if (provider === null) {
      setError("Phantom wallet is not connected.");
      return;
    }

    setPending(true);
    setError(null);
    setNotice(null);

    try {
      if (syncState.syncMode === "create_then_settle") {
        setStepMessage("Preparing first sync transaction");
        const prepared = await apiEnvelopeRequest<CharacterFirstSyncV1PrepareData>(
          "/api/v1/characters/first-sync/prepare",
          {
            method: "POST",
            body: JSON.stringify({
              characterId: character.characterId,
            }),
          },
        );
        if (prepared.phase !== "sign_transaction") {
          throw new Error(
            "Unexpected first sync response: expected sign_transaction phase.",
          );
        }
        if (!prepared.preparedTransaction) {
          throw new Error(
            "Unexpected first sync response: prepared transaction was missing.",
          );
        }

        props.setWalletActionStatus("signing_transaction");
        setStepMessage("Submitting with Phantom");
        const submitted = await signAndSendPreparedPlayerOwnedTransaction(
          provider,
          prepared.preparedTransaction,
        );

        try {
          setStepMessage("Acknowledging first sync");
          const response = await apiEnvelopeRequest<CharacterFirstSyncV1FinalizeData>(
            "/api/v1/characters/first-sync/finalize",
            {
              method: "POST",
              body: JSON.stringify({
                prepared: prepared.preparedTransaction,
                transactionSignature: submitted.transactionSignature,
              }),
            },
          );

          clearPendingSyncAck(character.characterId);
          setPendingAck(null);
          await refreshAll();
          setNotice(
            response.phase === "confirmed"
              ? `First sync confirmed. Tx ${truncateMiddle(response.transactionSignature)}`
              : `First sync submitted. Tx ${truncateMiddle(response.transactionSignature)}`,
          );
        } catch (ackError) {
          const record: PendingSyncAckRecord = {
            kind: "first_sync",
            characterId: character.characterId,
            transactionSignature: submitted.transactionSignature,
            prepared: prepared.preparedTransaction,
          };
          writePendingSyncAck(record);
          setPendingAck(record);
          await refreshAll();
          setNotice(
            `First sync transaction submitted. Ack will retry from this device. Tx ${truncateMiddle(submitted.transactionSignature)}`,
          );
          setError(normalizeWalletError(ackError));
        }
      } else {
        const pendingRun = character.nextPendingSettlementRun;
        if (!pendingRun) {
          throw new Error("No pending settlement run is available.");
        }
        setStepMessage("Preparing oldest pending settlement run");
        const prepared = await apiEnvelopeRequest<SettlementV1PrepareData>(
          "/api/v1/settlement/prepare",
          {
            method: "POST",
            body: JSON.stringify({
              characterId: character.characterId,
              zoneRunId: pendingRun.zoneRunId,
              idempotencyKey: crypto.randomUUID(),
            }),
          },
        );

        props.setWalletActionStatus("signing_transaction");
        setStepMessage("Submitting with Phantom");
        const submitted = await signAndSendPreparedPlayerOwnedTransaction(
          provider,
          prepared.preparedTransaction,
          {
            presignTransaction: async (transaction) => {
              const presigned = await apiEnvelopeRequest<SettlementV1PresignData>(
                "/api/v1/settlement/presign",
                {
                  method: "POST",
                  body: JSON.stringify({
                    prepareRequestId: prepared.prepareRequestId,
                    presignToken: prepared.presignToken,
                    transactionBase64:
                      serializeLegacyOrVersionedTransactionBase64(transaction),
                  }),
                },
              );

              return deserializeLegacyOrVersionedTransactionBase64(
                presigned.transactionBase64,
              );
            },
          },
        );

        try {
          setStepMessage("Finalizing settlement");
          const response = await apiEnvelopeRequest<SettlementV1FinalizeData>(
            "/api/v1/settlement/finalize",
            {
              method: "POST",
              body: JSON.stringify({
                prepareRequestId: prepared.prepareRequestId,
                transactionSignature: submitted.transactionSignature,
              }),
            },
          );

          clearPendingSyncAck(character.characterId);
          setPendingAck(null);
          await refreshAll();
          setNotice(
            response.phase === "confirmed"
              ? `Settlement confirmed. Tx ${truncateMiddle(response.transactionSignature)}`
              : `Settlement submitted. Tx ${truncateMiddle(response.transactionSignature)}`,
          );
        } catch (ackError) {
          const record: PendingSyncAckRecord = {
            kind: "settlement",
            characterId: character.characterId,
            transactionSignature: submitted.transactionSignature,
            prepareRequestId: prepared.prepareRequestId,
            prepared: prepared.preparedTransaction,
          };
          writePendingSyncAck(record);
          setPendingAck(record);
          await refreshAll();
          setNotice(
            `Settlement transaction submitted. Ack will retry from this device. Tx ${truncateMiddle(submitted.transactionSignature)}`,
          );
          setError(normalizeWalletError(ackError));
        }
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
    <div className={styles.panelGrid}>
      <section className={styles.panel}>
        <div className={styles.panelTitleRow}>
          <div className={styles.stack}>
            <h2 className={styles.panelTitle}>Sync Page</h2>
            <p className={styles.panelText}>
              Progression first, sync state second. One tap submits the oldest
              unresolved work.
            </p>
          </div>
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={styles.button}
              onClick={props.onBack}
            >
              Character Page
            </button>
          </div>
        </div>

        <div className={styles.characterSummaryGrid}>
          <div className={styles.characterSummaryCell}>
            <span className={styles.characterSummaryValue}>
              Name: {character.name}
            </span>
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
          <div className={styles.characterSummaryCell}>
            <StatusBadge
              label={character.syncPhase}
              tone={settlementTone(character.syncPhase)}
            />
          </div>
          <div className={styles.characterSummaryCell}>
            <span className={styles.characterSummaryValue}>
              {season.seasonName}
            </span>
          </div>
          <div className={styles.characterSummaryCell}>
            <StatusBadge
              label={season.phase.toUpperCase()}
              tone={seasonTone(season.phase)}
            />
          </div>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelTitleRow}>
          <div className={styles.stack}>
            <h2 className={styles.panelTitle}>Pending Work</h2>
            <p className={styles.panelText}>
              {pendingAck
                ? "A wallet submission already happened. Retry acknowledgement from here."
                : sync.mode === "first_sync"
                  ? "First sync creates the on-chain character, then settlement continues through the normal per-run flow."
                : sync.mode === "settlement"
                    ? "Only the oldest unresolved settlement run can be submitted from here."
                    : "No sync action is pending."}
            </p>
          </div>
          {character.nextPendingSettlementRun ? (
            <StatusBadge
              label={`Run ${character.nextPendingSettlementRun.closedRunSequence}`}
              tone="warning"
            />
          ) : null}
        </div>

        <div className={styles.keyValueGrid}>
          <div className={styles.keyValueItem}>
            <span className={styles.keyLabel}>Mode</span>
            <span className={styles.keyValue}>{sync.mode ?? "none"}</span>
          </div>
          <div className={styles.keyValueItem}>
            <span className={styles.keyLabel}>Pending run</span>
            <span className={styles.keyValue}>
              {sync.pendingRunSequence ?? "None"}
            </span>
          </div>
          <div className={styles.keyValueItem}>
            <span className={styles.keyLabel}>Pending queue</span>
            <span className={styles.keyValue}>
              {sync.pendingRunCount ?? character.pendingSettlementRunCount ?? 0}
            </span>
          </div>
          <div className={styles.keyValueItem}>
            <span className={styles.keyLabel}>Wallet authority</span>
            <span className={styles.keyValue}>
              {truncateMiddle(props.walletPublicKey)}
            </span>
          </div>
          <div className={styles.keyValueItem}>
            <span className={styles.keyLabel}>Season timing</span>
            <span className={styles.keyValue}>
              {seasonCountdownLabel(season)}
            </span>
          </div>
        </div>

        {props.walletConnectionStatus !== "connected" ? (
          <div className={styles.infoBox}>
            Connect Phantom before syncing this character.
          </div>
        ) : null}
        {mismatchMessage ? (
          <div className={styles.errorBox}>{mismatchMessage}</div>
        ) : null}

        <div className={styles.buttonRow}>
          {props.walletConnectionStatus !== "connected" ? (
            <button
              type="button"
              className={`${styles.button} ${styles.buttonPrimary}`}
              onClick={() => void props.onConnectWallet()}
              disabled={pending}
            >
              {props.walletConnectionStatus === "connecting"
                ? "Connecting..."
                : "Connect Phantom"}
            </button>
          ) : (
            <button
              type="button"
              className={`${styles.button} ${styles.buttonPrimary}`}
              onClick={() => void handleSync()}
              disabled={
                pending ||
                Boolean(mismatchMessage) ||
                (syncState.syncMode === null && pendingAck === null)
              }
            >
              {pending
                ? "Syncing..."
                : pendingAck
                  ? "Retry Acknowledgement"
                  : syncState.syncMode === "create_then_settle"
                    ? "First Sync"
                    : syncState.syncMode === "settlement"
                      ? "Sync Oldest Run"
                      : "Nothing To Sync"}
            </button>
          )}
        </div>

        {stepMessage ? (
          <div className={styles.syncFeedback}>{stepMessage}</div>
        ) : null}
        {notice ? <div className={styles.successBox}>{notice}</div> : null}
        {error ? <div className={styles.errorBox}>{error}</div> : null}
      </section>

      <section className={styles.panel}>
        <div className={styles.panelTitleRow}>
          <div className={styles.stack}>
            <h2 className={styles.panelTitle}>Attempt History</h2>
            <p className={styles.panelText}>
              Server reconciliation attempts for the currently pending settlement item.
            </p>
          </div>
        </div>

        {sync.attempts.length === 0 ? (
          <div className={styles.infoBox}>
            No submission attempts recorded yet.
          </div>
        ) : (
          <div className={styles.stack}>
            {sync.attempts.map((attempt) => (
              <div key={attempt.attemptId} className={styles.infoBox}>
                <div className={styles.panelTitleRow}>
                  <span className={styles.metaText}>
                    Attempt {attempt.attemptNumber}
                  </span>
                  <StatusBadge
                    label={attempt.status}
                    tone={settlementTone(attempt.status)}
                  />
                </div>
                <div className={styles.metaText}>
                  Tx {truncateMiddle(attempt.transactionSignature)}
                </div>
                <div className={styles.metaText}>
                  Submitted {formatDateTime(attempt.submittedAt)} · Resolved{" "}
                  {formatDateTime(attempt.resolvedAt)}
                </div>
                {attempt.rpcError ? (
                  <div className={styles.metaText}>{attempt.rpcError}</div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default function GameClient() {
  const router = useRouter();
  const {
    connect: connectEmbeddedWallet,
    isConnecting: explicitConnectPending,
    error: explicitConnectError,
  } = useConnect();
  const { disconnect: disconnectEmbeddedWallet } = usePhantomDisconnect();
  const {
    addresses: phantomAddresses,
    isConnected: phantomConnected,
    isConnecting: phantomConnecting,
    isLoading: phantomLoading,
    errors: phantomErrors,
  } = usePhantom();
  const { solana } = useSolana();
  const [appPhase, setAppPhase] = useState<AppPhase>("bootstrapping_session");
  const [shellView, setShellView] = useState<ShellView>("landing");
  const [accountMode, setAccountMode] = useState<AccountMode>("wallet-linked");
  const [slotsTotal, setSlotsTotal] = useState(3);
  const [roster, setRoster] = useState<CharacterRosterItem[]>([]);
  const [character, setCharacter] = useState<CharacterReadModel | null>(null);
  const [season, setSeason] = useState<CurrentSeasonResponse | null>(null);
  const [classCatalog, setClassCatalog] = useState<CharacterClassCatalogItem[]>(
    [],
  );
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [createName, setCreateName] = useState("Rookie");
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [createSlotIndex, setCreateSlotIndex] = useState(0);
  const [selectedZoneId, setSelectedZoneId] = useState(1);
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [zoneRunPending, setZoneRunPending] = useState(false);
  const [zoneRunError, setZoneRunError] = useState<string | null>(null);
  const [zoneRunNotice, setZoneRunNotice] = useState<string | null>(null);
  const [zoneRunRefreshPending, setZoneRunRefreshPending] = useState(false);
  const [zoneTopology, setZoneTopology] =
    useState<ZoneRunTopologyPreview | null>(null);
  const [zoneTopologyPending, setZoneTopologyPending] = useState(false);
  const [zoneTopologyError, setZoneTopologyError] = useState<string | null>(
    null,
  );
  const [activeZoneRunDetail, setActiveZoneRunDetail] =
    useState<ActiveZoneRunSnapshot | null>(null);
  const [syncDetail, setSyncDetail] =
    useState<CharacterSyncDetailResponse | null>(null);
  const [refreshPending, setRefreshPending] = useState(false);
  const [walletActionStatus, setWalletActionStatus] =
    useState<WalletActionStatus>("idle");
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionWalletAddress, setSessionWalletAddress] = useState<
    string | null
  >(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const authWalletInFlightRef = useRef<string | null>(null);
  const phantomStateRef = useRef<string | null>(null);

  const walletAvailability: WalletAvailability = "installed";
  const walletPublicKey = useMemo(
    () =>
      getReactSdkSolanaAddress(phantomAddresses, AddressType.solana) ??
      solana.publicKey ??
      null,
    [phantomAddresses, solana.publicKey],
  );
  const walletProvider = useMemo(() => createReactSdkSolanaProvider(solana), [solana]);
  const walletConnectionStatus: WalletConnectionStatus = phantomConnecting
    || explicitConnectPending
    ? "connecting"
    : phantomLoading
      ? "checking_trusted"
      : walletPublicKey
        ? "connected"
        : "disconnected";

  const walletPending =
    walletConnectionStatus === "connecting" || walletActionStatus !== "idle";

  function resetAuthenticatedState() {
    setSessionActive(false);
    setSessionWalletAddress(null);
    setAccountMode("wallet-linked");
    setSlotsTotal(3);
    setRoster([]);
    setCharacter(null);
    setSyncDetail(null);
    setActiveZoneRunDetail(null);
    setZoneRunNotice(null);
    setZoneRunError(null);
    setZoneTopology(null);
    setZoneTopologyError(null);
  }

  async function authenticateWalletSession(args: {
    provider: PhantomSolanaProvider;
    walletAddress: string;
  }): Promise<AuthVerifyResponse> {
    logPhantomConnectClientEvent({
      area: "auth",
      stage: "auth_nonce_request_started",
      message: "Starting backend nonce request.",
      details: {
        walletAddress: args.walletAddress,
      },
    });

    const nonce = await apiRequest<AuthNonceResponse>("/api/v1/auth/nonce", {
      method: "POST",
      body: JSON.stringify({
        chain: "solana",
        walletAddress: args.walletAddress,
      }),
    });

    logPhantomConnectClientEvent({
      area: "auth",
      stage: "auth_nonce_request_succeeded",
      message: "Backend nonce request succeeded.",
      details: {
        walletAddress: args.walletAddress,
        nonceId: nonce.data.nonceId,
        expiresAt: nonce.data.expiresAt,
      },
    });

    setWalletActionStatus("signing_message");
    logPhantomConnectClientEvent({
      area: "auth",
      stage: "auth_sign_message_started",
      message: "Starting Phantom message signature for auth verify.",
      details: {
        walletAddress: args.walletAddress,
        nonceId: nonce.data.nonceId,
        messageLength: nonce.data.messageToSign.length,
      },
    });

    let signatureBase64: string;
    try {
      signatureBase64 = await signAuthorizationMessageUtf8(
        args.provider,
        nonce.data.messageToSign,
      );
    } catch (error) {
      logPhantomConnectClientEvent({
        area: "auth",
        stage: "auth_sign_message_failed",
        level: "error",
        message: "Phantom message signature failed.",
        details: {
          walletAddress: args.walletAddress,
          nonceId: nonce.data.nonceId,
          error: normalizeWalletError(error),
        },
      });
      throw error;
    }

    logPhantomConnectClientEvent({
      area: "auth",
      stage: "auth_sign_message_succeeded",
      message: "Phantom message signature succeeded.",
      details: {
        walletAddress: args.walletAddress,
        nonceId: nonce.data.nonceId,
        signatureLength: signatureBase64.length,
      },
    });

    logPhantomConnectClientEvent({
      area: "auth",
      stage: "auth_verify_request_started",
      message: "Starting backend auth verify request.",
      details: {
        walletAddress: args.walletAddress,
        nonceId: nonce.data.nonceId,
      },
    });

    let verified: AuthVerifyResponse;
    try {
      verified = await apiRequest<AuthVerifyResponse>("/api/v1/auth/verify", {
        method: "POST",
        body: JSON.stringify({
          nonceId: nonce.data.nonceId,
          walletAddress: args.walletAddress,
          signatureBase64,
          signedMessage: nonce.data.messageToSign,
        }),
      });
    } catch (error) {
      logPhantomConnectClientEvent({
        area: "auth",
        stage: "auth_verify_request_failed",
        level: "error",
        message: "Backend auth verify request failed.",
        details: {
          walletAddress: args.walletAddress,
          nonceId: nonce.data.nonceId,
          error: normalizeWalletError(error),
          status: getApiErrorStatus(error),
        },
      });
      throw error;
    }

    logPhantomConnectClientEvent({
      area: "auth",
      stage: "auth_verify_request_succeeded",
      message: "Backend auth verify request succeeded.",
      details: {
        walletAddress: verified.data.user.walletAddress,
        userId: verified.data.user.id,
        sessionId: verified.data.session.id,
        expiresAt: verified.data.session.expiresAt,
      },
    });

    setSessionActive(true);
    setSessionWalletAddress(verified.data.user.walletAddress);
    return verified;
  }

  async function refreshSeason(): Promise<CurrentSeasonResponse> {
    const response = await apiRequest<CurrentSeasonResponse>(
      "/api/seasons/current",
      { method: "GET", headers: undefined },
    );
    setSeason(response);
    return response;
  }

  async function refreshClasses(): Promise<CharacterClassCatalogItem[]> {
    const response = await apiRequest<CharacterClassesResponse>(
      "/api/classes",
      {
        method: "GET",
        headers: undefined,
      },
    );
    setClassCatalog(response.classes);
    return response.classes;
  }

  async function refreshRoster(): Promise<CharacterRosterResponse> {
    const response = await apiRequest<CharacterRosterResponse>(
      "/api/characters",
      { method: "GET", headers: undefined },
    );
    setAccountMode(response.accountMode);
    setSlotsTotal(response.slotsTotal);
    setRoster(response.characters);
    setSessionActive(true);
    return response;
  }

  async function loadCharacterDetail(
    characterId: string,
    preferredView?: ShellView,
  ): Promise<CharacterReadModel | null> {
    setRefreshPending(true);

    try {
      const response = await apiRequest<CharacterDetailResponse>(
        `/api/characters/${encodeURIComponent(characterId)}`,
        { method: "GET", headers: undefined },
      );
      setCharacter(response.character);
      setSeason(response.season);
      setSyncDetail(null);
      if (response.character.activeZoneRun === null) {
        setActiveZoneRunDetail(null);
      }
      setAppPhase("ready");
      setShellView(
        preferredView ??
          (response.character.activeZoneRun !== null || shellView === "run"
            ? "run"
            : "character"),
      );
      return response.character;
    } finally {
      setRefreshPending(false);
    }
  }

  const loadCharacterDetailRef = useRef(loadCharacterDetail);
  loadCharacterDetailRef.current = loadCharacterDetail;

  async function refreshCharacter(): Promise<CharacterReadModel | null> {
    const rosterResponse = await refreshRoster();
    const nextCharacterId =
      character?.characterId ??
      rosterResponse.characters[0]?.characterId ??
      null;

    if (nextCharacterId === null) {
      setCharacter(null);
      setActiveZoneRunDetail(null);
      setShellView("roster");
      return null;
    }

    return loadCharacterDetail(nextCharacterId);
  }

  async function refreshSyncDetail(
    nextCharacterId?: string,
  ): Promise<CharacterSyncDetailResponse | null> {
    const resolvedCharacterId =
      nextCharacterId ?? character?.characterId ?? null;

    if (!resolvedCharacterId) {
      setSyncDetail(null);
      return null;
    }

    const response = await apiRequest<CharacterSyncDetailResponse>(
      `/api/characters/${encodeURIComponent(resolvedCharacterId)}/sync`,
      { method: "GET", headers: undefined },
    );
    setSyncDetail(response);
    return response;
  }

  async function bootstrapAuthenticatedApp(): Promise<void> {
    setAppPhase("loading_character");
    const [rosterResponse] = await Promise.all([
      refreshRoster(),
      refreshClasses(),
      refreshSeason(),
    ]);

    if (rosterResponse.characters.length === 0) {
      setCharacter(null);
      setShellView("roster");
      setAppPhase("ready");
      return;
    }

    await loadCharacterDetail(rosterResponse.characters[0]!.characterId);
    setAppPhase("ready");
  }

  const bootstrapAuthenticatedAppRef = useRef(bootstrapAuthenticatedApp);
  bootstrapAuthenticatedAppRef.current = bootstrapAuthenticatedApp;

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
        error instanceof Error
          ? error.message
          : "Failed to load zone topology.",
      );
      console.error("[zone-run] topology load failed", error);
    } finally {
      setZoneTopologyPending(false);
    }
  }

  const refreshZoneTopologyRef = useRef(refreshZoneTopology);
  refreshZoneTopologyRef.current = refreshZoneTopology;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const url = new URL(window.location.href);
    logPhantomConnectClientEvent({
      area: "ui",
      stage: "game_client_loaded",
      message: "Game client loaded with Phantom debug telemetry.",
      details: {
        pathname: url.pathname,
        search: url.search,
        hash: url.hash,
        hasCode: url.searchParams.has("code"),
        hasError: url.searchParams.has("error"),
      },
    });
  }, []);

  useEffect(() => {
    if (phantomErrors.connect) {
      logPhantomConnectClientEvent({
        area: "sdk",
        stage: "react_sdk_connect_error",
        level: "error",
        message: "React SDK connect error surfaced to GameClient.",
        details: {
          error: normalizeWalletError(phantomErrors.connect),
        },
      });
      setWalletError(normalizeWalletError(phantomErrors.connect));
    }
  }, [phantomErrors.connect]);

  useEffect(() => {
    const snapshot = JSON.stringify({
      phantomConnecting,
      phantomConnected,
      walletPublicKey,
      sessionActive,
      sessionWalletAddress,
      addressCount: phantomAddresses.length,
    });

    if (phantomStateRef.current === snapshot) {
      return;
    }

    phantomStateRef.current = snapshot;
    logPhantomConnectClientEvent({
      area: "session",
      stage: "react_sdk_state_changed",
      message: "React SDK/session state changed.",
      details: {
        phantomConnecting,
        phantomConnected,
        walletPublicKey,
        sessionActive,
        sessionWalletAddress,
        addressCount: phantomAddresses.length,
      },
    });
  }, [
    phantomAddresses.length,
    phantomConnected,
    phantomConnecting,
    sessionActive,
    sessionWalletAddress,
    walletPublicKey,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        setAppPhase("bootstrapping_session");
        await Promise.all([refreshClasses(), refreshSeason()]);

        if (cancelled) {
          return;
        }

        try {
          const rosterResponse = await refreshRoster();
          if (cancelled) {
            return;
          }

          if (rosterResponse.characters.length === 0) {
            setCharacter(null);
            setShellView("roster");
          } else {
            await loadCharacterDetailRef.current(
              rosterResponse.characters[0]!.characterId,
            );
          }
        } catch (error) {
          const status = getApiErrorStatus(error);
          if (status === 401 || status === 403) {
            resetAuthenticatedState();
            setShellView("landing");
            setAppPhase("ready");
            return;
          }
          throw error;
        }

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
    if (!explicitConnectError) {
      return;
    }

    logPhantomConnectClientEvent({
      area: "sdk",
      stage: "react_sdk_connect_error",
      level: "error",
      message: "React SDK direct connect returned an error.",
      details: {
        errorName: explicitConnectError.name,
        errorMessage: explicitConnectError.message,
      },
    });
  }, [explicitConnectError]);

  useEffect(() => {
    if (
      !phantomConnected ||
      !walletPublicKey ||
      walletProvider === null ||
      sessionActive
    ) {
      if (!phantomConnected || !walletPublicKey) {
        authWalletInFlightRef.current = null;
      }
      return;
    }

    if (authWalletInFlightRef.current === walletPublicKey) {
      return;
    }

    authWalletInFlightRef.current = walletPublicKey;
    let cancelled = false;

    setWalletError(null);
    setAppPhase("loading_character");
    logPhantomConnectClientEvent({
      area: "session",
      stage: "session_bootstrap_started",
      message: "Starting session bootstrap from connected wallet.",
      details: {
        walletPublicKey,
      },
    });

    void authenticateWalletSession({
      provider: walletProvider,
      walletAddress: walletPublicKey,
    })
      .then(async () => {
        if (cancelled) {
          return;
        }
        await bootstrapAuthenticatedAppRef.current();
        if (cancelled) {
          return;
        }
        logPhantomConnectClientEvent({
          area: "session",
          stage: "session_bootstrap_succeeded",
          message: "Wallet session bootstrap completed.",
          details: {
            walletPublicKey,
          },
        });
        setShellView("roster");
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        authWalletInFlightRef.current = null;
        logPhantomConnectClientEvent({
          area: "session",
          stage: "session_bootstrap_failed",
          level: "error",
          message: "Wallet session bootstrap failed.",
          details: {
            walletPublicKey,
            error: normalizeWalletError(error),
            status: getApiErrorStatus(error),
          },
        });
        setWalletError(normalizeWalletError(error));
        setAppPhase("ready");
      })
      .finally(() => {
        if (!cancelled) {
          setWalletActionStatus("idle");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [phantomConnected, sessionActive, walletProvider, walletPublicKey]);

  useEffect(() => {
    const maxZone = maxUnlockedZone(character);
    const maxVisibleZone = Math.max(1, maxZone + 1);
    if (selectedZoneId > maxVisibleZone) {
      setSelectedZoneId(maxVisibleZone);
    }
  }, [character, selectedZoneId]);

  useEffect(() => {
    if (!character?.characterId) {
      setZoneTopology(null);
      setZoneTopologyError(null);
      return;
    }

    const zoneId = activeZoneRunDetail?.zoneId ?? selectedZoneId;
    const topologyVersion = activeZoneRunDetail?.topologyVersion;
    void refreshZoneTopologyRef.current(zoneId, topologyVersion);
  }, [
    character?.characterId,
    selectedZoneId,
    activeZoneRunDetail?.zoneId,
    activeZoneRunDetail?.topologyVersion,
  ]);

  async function handleConnectWallet(provider: PhantomAuthProvider = "google") {
    authWalletInFlightRef.current = null;
    setWalletError(null);
    logPhantomConnectClientEvent({
      area: "ui",
      stage: "connect_modal_open_requested",
      message: "User requested Phantom connect modal.",
      details: {
        shellView,
        provider,
      },
    });

    try {
      const result = await connectEmbeddedWallet({ provider });
      logPhantomConnectClientEvent({
        area: "sdk",
        stage: "react_sdk_direct_connect_succeeded",
        message: "Direct React SDK connect returned successfully.",
        details: {
          provider,
          addressCount: result.addresses.length,
          addresses: result.addresses.map((address) => ({
            address: address.address,
            addressType: address.addressType,
          })),
        },
      });
    } catch (error) {
      logPhantomConnectClientEvent({
        area: "sdk",
        stage: "react_sdk_direct_connect_failed",
        level: "error",
        message: "Direct React SDK connect failed.",
        details: {
          provider,
          error: normalizeWalletError(error),
        },
      });
      setWalletError(normalizeWalletError(error));
    }
  }

  async function handleDisconnectWallet() {
    setWalletError(null);
    logPhantomConnectClientEvent({
      area: "session",
      stage: "logout_started",
      message: "Starting app logout and wallet disconnect.",
      details: {
        sessionWalletAddress,
        walletPublicKey,
      },
    });

    try {
      await apiRequest<{ ok: true }>("/api/v1/auth/logout", {
        method: "POST",
        body: JSON.stringify({}),
      });
      logPhantomConnectClientEvent({
        area: "session",
        stage: "logout_request_succeeded",
        message: "Backend logout request succeeded.",
        details: {
          sessionWalletAddress,
        },
      });
    } catch (error) {
      logPhantomConnectClientEvent({
        area: "session",
        stage: "logout_request_failed",
        level: "error",
        message: "Backend logout request failed.",
        details: {
          error: normalizeWalletError(error),
          status: getApiErrorStatus(error),
        },
      });
      setWalletError(normalizeWalletError(error));
    }

    try {
      await disconnectEmbeddedWallet();
      logPhantomConnectClientEvent({
        area: "session",
        stage: "wallet_disconnect_succeeded",
        message: "Embedded wallet disconnect succeeded.",
      });
    } catch (error) {
      logPhantomConnectClientEvent({
        area: "session",
        stage: "wallet_disconnect_failed",
        level: "error",
        message: "Embedded wallet disconnect failed.",
        details: {
          error: normalizeWalletError(error),
        },
      });
      setWalletError(normalizeWalletError(error));
    } finally {
      authWalletInFlightRef.current = walletPublicKey;
      resetAuthenticatedState();
      setShellView("landing");
      setWalletActionStatus("idle");
    }
  }

  function handleOpenCreate(slotIndex: number) {
    setCreateError(null);
    setZoneRunNotice(null);
    setCreateSlotIndex(slotIndex);
    setSelectedClassId(null);
    setShellView("create");
  }

  async function handleOpenCharacter(characterId: string) {
    try {
      await loadCharacterDetail(characterId, "character");
    } catch (error) {
      setFatalError(
        error instanceof Error ? error.message : "Failed to load character.",
      );
      setAppPhase("fatal_error");
    }
  }

  async function handleOpenSync() {
    if (!character) {
      return;
    }

    try {
      await refreshSyncDetail(character.characterId);
      setShellView("sync");
    } catch (error) {
      setFatalError(
        error instanceof Error ? error.message : "Failed to load sync detail.",
      );
      setAppPhase("fatal_error");
    }
  }

  async function handleCreateCharacter() {
    setCreatePending(true);
    setCreateError(null);

    try {
      const created = await apiRequest<CreateCharacterResponse>(
        "/api/characters",
        {
          method: "POST",
          body: JSON.stringify({
            name: createName,
            classId: selectedClassId,
            slotIndex: createSlotIndex,
          }),
        },
      );

      await refreshRoster();
      if (created.characterId !== null) {
        await loadCharacterDetail(created.characterId, "character");
      } else {
        await refreshCharacter();
      }
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Failed to create character.",
      );
    } finally {
      setCreatePending(false);
    }
  }

  async function refreshActiveZoneRun(input: {
    characterId: string;
    runId: string;
  }) {
    if (!input.runId) {
      setActiveZoneRunDetail(null);
      return;
    }

    setZoneRunRefreshPending(true);
    console.debug("[zone-run] refreshing active run", {
      characterId: input.characterId,
      runId: input.runId,
    });

    try {
      const response = await apiRequest<ZoneRunActionResponse>(
        `/api/zone-runs/active?characterId=${encodeURIComponent(input.characterId)}`,
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
        await refreshCharacter();
        router.push(
          `/runs/${encodeURIComponent(response.closedRunSummary.zoneRunId)}`,
        );
      }
    } catch (error) {
      console.error("[zone-run] refresh failed", error);
      throw error;
    } finally {
      setZoneRunRefreshPending(false);
    }
  }

  const refreshActiveZoneRunRef = useRef(refreshActiveZoneRun);
  refreshActiveZoneRunRef.current = refreshActiveZoneRun;

  useEffect(() => {
    const activeCharacterId = character?.characterId ?? null;
    const activeRun = character?.activeZoneRun ?? null;

    if (!activeCharacterId || !activeRun) {
      setActiveZoneRunDetail(null);
      return;
    }

    void refreshActiveZoneRunRef.current({
      characterId: activeCharacterId,
      runId: activeRun.runId,
    });
  }, [
    character?.characterId,
    character?.activeZoneRun,
    character?.activeZoneRun?.runId,
    character?.activeZoneRun?.state,
    character?.activeZoneRun?.currentNodeId,
    character?.activeZoneRun?.currentSubnodeId,
  ]);

  const refreshSyncDetailRef = useRef(refreshSyncDetail);
  refreshSyncDetailRef.current = refreshSyncDetail;

  useEffect(() => {
    const activeCharacterId = character?.characterId ?? null;

    if (shellView !== "sync" || !activeCharacterId) {
      return;
    }

    void refreshSyncDetailRef.current(activeCharacterId);
  }, [
    shellView,
    character?.characterId,
    character?.syncPhase,
    character?.nextPendingSettlementRun?.zoneRunId,
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
    setZoneRunNotice(null);
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
      await refreshCharacter();
      if (response.closedRunSummary) {
        router.push(
          `/runs/${encodeURIComponent(response.closedRunSummary.zoneRunId)}`,
        );
        return;
      }
      setShellView("run");
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

    setShellView("run");
    await executeZoneRunAction("/api/zone-runs/start", {
      characterId: character.characterId,
      zoneId: selectedZoneId,
    });
  }

  async function handleAdvanceZoneRun() {
    if (!character) {
      return;
    }

    await executeZoneRunAction("/api/zone-runs/advance", {
      characterId: character.characterId,
    });
  }

  async function handleChooseZoneRunBranch(nextNodeId: string) {
    if (!character) {
      return;
    }

    await executeZoneRunAction("/api/zone-runs/choose-branch", {
      characterId: character.characterId,
      nextNodeId,
    });
  }

  async function handleUseZoneRunPauseSkill(skillId: string) {
    if (!character) {
      return;
    }

    await executeZoneRunAction("/api/zone-runs/use-skill", {
      characterId: character.characterId,
      skillId,
    });
  }

  async function handleContinueZoneRun() {
    if (!character) {
      return;
    }

    await executeZoneRunAction("/api/zone-runs/continue", {
      characterId: character.characterId,
    });
  }

  async function handleAbandonZoneRun() {
    if (!character) {
      return;
    }

    await executeZoneRunAction("/api/zone-runs/abandon", {
      characterId: character.characterId,
    });
  }

  async function handleShareZoneRun(runId: string) {
    try {
      const share = await apiRequest<RunShareResponse>(
        `/api/runs/${encodeURIComponent(runId)}/share`,
        {
          method: "POST",
        },
      );

      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(share.shareText);
        setZoneRunNotice(`Share link copied. ${share.shareStatus}.`);
      } else {
        window.open(share.shareUrl, "_blank", "noopener,noreferrer");
        setZoneRunNotice("Share page opened in a new tab.");
      }
    } catch (error) {
      setZoneRunError(
        error instanceof Error ? error.message : "Failed to create share link.",
      );
    }
  }

  if (
    appPhase === "bootstrapping_session" ||
    appPhase === "loading_character"
  ) {
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
            <h1 className={styles.title}>RUNARA</h1>
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
          <div className={styles.stack}>
            <div className={styles.titleRow}>
              <h1 className={styles.title}>RUNARA</h1>
              {season ? (
                <>
                  <StatusBadge
                    label={season.seasonName}
                    tone={seasonTone(season.phase)}
                  />
                  <span className={styles.headerMetaText}>
                    ends in {formatCountdown(seasonTargetTs(season))}
                  </span>
                </>
              ) : null}
            </div>
            {season ? (
              season.phase === "grace" ? (
                <p className={styles.subtitle}>
                  Grace period is open for sync and settlement.
                </p>
              ) : null
            ) : null}
          </div>

          <div className={styles.toolbar}>
            {shellView !== "landing" ? (
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setShellView("roster")}
                aria-label="Open characters"
                title="Open characters"
              >
                <PeopleIcon className={styles.iconSvg} />
              </button>
            ) : null}
            <WalletToolbar
              availability={walletAvailability}
              connectionStatus={walletConnectionStatus}
              actionStatus={walletActionStatus}
              signedIn={sessionActive}
              sessionWalletAddress={sessionWalletAddress}
              publicKey={walletPublicKey}
              error={walletError}
              pending={walletPending}
              refreshPending={refreshPending}
              onConnect={handleConnectWallet}
              onDisconnect={handleDisconnectWallet}
              onRefresh={() => {
                if (sessionActive) {
                  void refreshCharacter();
                }
              }}
            />
            {refreshPending ? (
              <StatusBadge label="Refreshing state" tone="info" />
            ) : null}
          </div>
        </header>

        {shellView === "landing" ? (
          <LandingPanel
            connectionStatus={walletConnectionStatus}
            pending={walletPending}
            onConnect={handleConnectWallet}
          />
        ) : shellView === "roster" ? (
          <RosterPanel
            accountMode={accountMode}
            slotsTotal={slotsTotal}
            characters={roster}
            onCreate={handleOpenCreate}
            onOpenCharacter={(characterId) =>
              void handleOpenCharacter(characterId)
            }
          />
        ) : shellView === "create" ? (
          <CreateCharacterPanel
            classes={classCatalog}
            selectedClassId={selectedClassId}
            slotIndex={createSlotIndex}
            name={createName}
            pending={createPending}
            error={createError}
            onClassSelect={setSelectedClassId}
            onNameChange={setCreateName}
            onBack={() => setShellView("roster")}
            onSubmit={handleCreateCharacter}
          />
        ) : shellView === "run" && character !== null ? (
          <div className={`${styles.panelGrid} ${styles.characterStage}`}>
            <ZoneRunPanel
              character={character}
              season={season}
              selectedZoneId={selectedZoneId}
              activeRun={activeZoneRunDetail}
              resumePending={
                character.activeZoneRun !== null && activeZoneRunDetail === null
              }
              topology={zoneTopology}
              topologyPending={zoneTopologyPending}
              topologyError={zoneTopologyError}
              pending={zoneRunPending}
              refreshPending={zoneRunRefreshPending}
              error={zoneRunError}
              onBack={() => setShellView("character")}
              onSelectZone={setSelectedZoneId}
              onStartRun={handleStartZoneRun}
              onRefreshRun={async () => {
                if (activeZoneRunDetail || character.activeZoneRun) {
                  await refreshActiveZoneRun({
                    characterId: character.characterId,
                    runId:
                      activeZoneRunDetail?.runId ??
                      character.activeZoneRun?.runId ??
                      "",
                  });
                  return;
                }

                await refreshCharacter();
              }}
              onAdvance={handleAdvanceZoneRun}
              onChooseBranch={handleChooseZoneRunBranch}
              onUsePauseSkill={handleUseZoneRunPauseSkill}
              onContinue={handleContinueZoneRun}
              onAbandon={handleAbandonZoneRun}
              onShareRun={handleShareZoneRun}
            />

            {zoneRunNotice ? (
              <section className={styles.panel}>
                <div className={styles.successBox}>{zoneRunNotice}</div>
              </section>
            ) : null}
          </div>
        ) : shellView === "sync" &&
          character !== null &&
          syncDetail !== null ? (
          <CharacterSyncPage
            detail={syncDetail}
            walletAvailability={walletAvailability}
            walletConnectionStatus={walletConnectionStatus}
            walletPublicKey={walletPublicKey}
            walletProvider={walletProvider}
            setWalletActionStatus={setWalletActionStatus}
            onConnectWallet={handleConnectWallet}
            onRefreshCharacter={() => refreshCharacter()}
            onRefreshSyncDetail={() => refreshSyncDetail(character.characterId)}
            onBack={() => setShellView("character")}
          />
        ) : shellView === "sync" && character !== null ? (
          <section className={styles.panel}>
            <div className={styles.infoBox}>Loading sync detail...</div>
          </section>
        ) : character === null ? (
          <RosterPanel
            accountMode={accountMode}
            slotsTotal={slotsTotal}
            characters={roster}
            onCreate={handleOpenCreate}
            onOpenCharacter={(characterId) =>
              void handleOpenCharacter(characterId)
            }
          />
        ) : (
          <div className={`${styles.panelGrid} ${styles.characterStage}`}>
            <section className={`${styles.panel} ${styles.characterPanelFull}`}>
              <div className={styles.characterPanelHeader}>
                <div className={styles.characterPanelTopRow}>
                  <div className={styles.characterIdentityRow}>
                    <h2 className={styles.characterHeroName}>
                      {character.name}
                    </h2>
                    <span className={styles.classTag}>
                      {classCatalog.find(
                        (item) => item.classId === character.classId,
                      )?.displayName ?? character.classId}
                    </span>
                    <span className={styles.secondaryTag}>
                      Lvl {character.level}
                    </span>
                    <span className={styles.secondaryTag}>
                      Exp {character.exp}/{nextLevelExpTarget(character.level)}
                    </span>
                  </div>
                  <CharacterSyncButton
                    character={character}
                    onOpen={() => void handleOpenSync()}
                  />
                </div>
              </div>

              <div className={styles.characterSummaryGrid}>
                <div className={styles.characterSummaryCell}>
                  {character.syncPhase !== "LOCAL_ONLY" ? (
                    <StatusBadge
                      label={character.syncPhase}
                      tone={settlementTone(character.syncPhase)}
                    />
                  ) : null}
                </div>
              </div>

              <div className={styles.panelFooterRow}>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonPrimary}`}
                  onClick={() => setShellView("run")}
                  disabled={zoneRunPending || !character.battleEligible}
                >
                  {character.activeZoneRun ? "Resume Run" : "Start Run"}
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
