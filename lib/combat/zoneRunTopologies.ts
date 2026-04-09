import { createHash } from "node:crypto";

import { getEnemyArchetypeDef } from "./enemyArchetypes";

export interface ZoneEnemyRuleEntry {
  enemyArchetypeId: number;
  maxPerRun: number;
}

export interface ZoneNodeEnemyWeight {
  enemyArchetypeId: number;
  weight: number;
}

export interface ZoneSubnodeDef {
  subnodeId: string;
  combatChanceBP: number;
}

export interface ZoneNodeDef {
  nodeId: string;
  subnodes: ZoneSubnodeDef[];
  enemyPool: ZoneNodeEnemyWeight[];
  nextNodeIds: string[];
}

export interface ZoneRunTopology {
  zoneId: number;
  topologyVersion: number;
  startNodeId: string;
  terminalNodeIds: string[];
  enemyRules: ZoneEnemyRuleEntry[];
  nodes: ZoneNodeDef[];
  topologyHash: string;
  totalSubnodeCount: number;
}

function hashTopology(input: Omit<ZoneRunTopology, "topologyHash" | "totalSubnodeCount">): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function buildTopology(
  input: Omit<ZoneRunTopology, "topologyHash" | "totalSubnodeCount">,
): ZoneRunTopology {
  const totalSubnodeCount = input.nodes.reduce((sum, node) => sum + node.subnodes.length, 0);
  const topologyHash = hashTopology(input);
  return {
    ...input,
    topologyHash,
    totalSubnodeCount,
  };
}

const TOPOLOGIES: ZoneRunTopology[] = [
  buildTopology({
    zoneId: 1,
    topologyVersion: 1,
    startNodeId: "z1-entry",
    terminalNodeIds: ["z1-exit"],
    enemyRules: [
      { enemyArchetypeId: 100, maxPerRun: 3 },
      { enemyArchetypeId: 101, maxPerRun: 2 },
      { enemyArchetypeId: 104, maxPerRun: 1 },
    ],
    nodes: [
      {
        nodeId: "z1-entry",
        subnodes: [
          { subnodeId: "z1-entry-s1", combatChanceBP: 6000 },
          { subnodeId: "z1-entry-s2", combatChanceBP: 8500 },
        ],
        enemyPool: [
          { enemyArchetypeId: 100, weight: 70 },
          { enemyArchetypeId: 101, weight: 30 },
        ],
        nextNodeIds: ["z1-exit"],
      },
      {
        nodeId: "z1-exit",
        subnodes: [
          { subnodeId: "z1-exit-s1", combatChanceBP: 5500 },
          { subnodeId: "z1-exit-s2", combatChanceBP: 8000 },
        ],
        enemyPool: [
          { enemyArchetypeId: 100, weight: 50 },
          { enemyArchetypeId: 101, weight: 25 },
          { enemyArchetypeId: 104, weight: 25 },
        ],
        nextNodeIds: [],
      },
    ],
  }),
  buildTopology({
    zoneId: 2,
    topologyVersion: 1,
    startNodeId: "z2-entry",
    terminalNodeIds: ["z2-exit"],
    enemyRules: [
      { enemyArchetypeId: 101, maxPerRun: 2 },
      { enemyArchetypeId: 102, maxPerRun: 2 },
      { enemyArchetypeId: 103, maxPerRun: 1 },
      { enemyArchetypeId: 104, maxPerRun: 1 },
    ],
    nodes: [
      {
        nodeId: "z2-entry",
        subnodes: [
          { subnodeId: "z2-entry-s1", combatChanceBP: 7000 },
          { subnodeId: "z2-entry-s2", combatChanceBP: 9000 },
        ],
        enemyPool: [
          { enemyArchetypeId: 101, weight: 40 },
          { enemyArchetypeId: 102, weight: 35 },
          { enemyArchetypeId: 104, weight: 25 },
        ],
        nextNodeIds: ["z2-upper", "z2-lower"],
      },
      {
        nodeId: "z2-upper",
        subnodes: [
          { subnodeId: "z2-upper-s1", combatChanceBP: 7500 },
          { subnodeId: "z2-upper-s2", combatChanceBP: 6000 },
        ],
        enemyPool: [
          { enemyArchetypeId: 102, weight: 45 },
          { enemyArchetypeId: 103, weight: 35 },
          { enemyArchetypeId: 101, weight: 20 },
        ],
        nextNodeIds: ["z2-exit"],
      },
      {
        nodeId: "z2-lower",
        subnodes: [
          { subnodeId: "z2-lower-s1", combatChanceBP: 6500 },
          { subnodeId: "z2-lower-s2", combatChanceBP: 8000 },
        ],
        enemyPool: [
          { enemyArchetypeId: 101, weight: 35 },
          { enemyArchetypeId: 102, weight: 35 },
          { enemyArchetypeId: 104, weight: 30 },
        ],
        nextNodeIds: ["z2-exit"],
      },
      {
        nodeId: "z2-exit",
        subnodes: [
          { subnodeId: "z2-exit-s1", combatChanceBP: 9000 },
          { subnodeId: "z2-exit-s2", combatChanceBP: 5000 },
        ],
        enemyPool: [
          { enemyArchetypeId: 102, weight: 45 },
          { enemyArchetypeId: 103, weight: 40 },
          { enemyArchetypeId: 104, weight: 15 },
        ],
        nextNodeIds: [],
      },
    ],
  }),
  buildTopology({
    zoneId: 3,
    topologyVersion: 1,
    startNodeId: "z3-entry",
    terminalNodeIds: ["z3-core"],
    enemyRules: [
      { enemyArchetypeId: 102, maxPerRun: 2 },
      { enemyArchetypeId: 103, maxPerRun: 2 },
      { enemyArchetypeId: 105, maxPerRun: 2 },
      { enemyArchetypeId: 107, maxPerRun: 1 },
    ],
    nodes: [
      {
        nodeId: "z3-entry",
        subnodes: [
          { subnodeId: "z3-entry-s1", combatChanceBP: 6500 },
          { subnodeId: "z3-entry-s2", combatChanceBP: 8500 },
        ],
        enemyPool: [
          { enemyArchetypeId: 102, weight: 35 },
          { enemyArchetypeId: 103, weight: 35 },
          { enemyArchetypeId: 105, weight: 30 },
        ],
        nextNodeIds: ["z3-left", "z3-right"],
      },
      {
        nodeId: "z3-left",
        subnodes: [
          { subnodeId: "z3-left-s1", combatChanceBP: 7500 },
          { subnodeId: "z3-left-s2", combatChanceBP: 7000 },
        ],
        enemyPool: [
          { enemyArchetypeId: 102, weight: 25 },
          { enemyArchetypeId: 105, weight: 45 },
          { enemyArchetypeId: 107, weight: 30 },
        ],
        nextNodeIds: ["z3-core"],
      },
      {
        nodeId: "z3-right",
        subnodes: [
          { subnodeId: "z3-right-s1", combatChanceBP: 8000 },
          { subnodeId: "z3-right-s2", combatChanceBP: 5500 },
        ],
        enemyPool: [
          { enemyArchetypeId: 103, weight: 40 },
          { enemyArchetypeId: 105, weight: 40 },
          { enemyArchetypeId: 107, weight: 20 },
        ],
        nextNodeIds: ["z3-core"],
      },
      {
        nodeId: "z3-core",
        subnodes: [
          { subnodeId: "z3-core-s1", combatChanceBP: 9000 },
          { subnodeId: "z3-core-s2", combatChanceBP: 8000 },
        ],
        enemyPool: [
          { enemyArchetypeId: 103, weight: 30 },
          { enemyArchetypeId: 105, weight: 35 },
          { enemyArchetypeId: 107, weight: 35 },
        ],
        nextNodeIds: [],
      },
    ],
  }),
  buildTopology({
    zoneId: 4,
    topologyVersion: 1,
    startNodeId: "z4-entry",
    terminalNodeIds: ["z4-core"],
    enemyRules: [
      { enemyArchetypeId: 103, maxPerRun: 2 },
      { enemyArchetypeId: 105, maxPerRun: 2 },
      { enemyArchetypeId: 106, maxPerRun: 2 },
      { enemyArchetypeId: 107, maxPerRun: 1 },
    ],
    nodes: [
      {
        nodeId: "z4-entry",
        subnodes: [
          { subnodeId: "z4-entry-s1", combatChanceBP: 7000 },
          { subnodeId: "z4-entry-s2", combatChanceBP: 8500 },
        ],
        enemyPool: [
          { enemyArchetypeId: 103, weight: 30 },
          { enemyArchetypeId: 105, weight: 30 },
          { enemyArchetypeId: 106, weight: 40 },
        ],
        nextNodeIds: ["z4-upper", "z4-lower"],
      },
      {
        nodeId: "z4-upper",
        subnodes: [
          { subnodeId: "z4-upper-s1", combatChanceBP: 9000 },
          { subnodeId: "z4-upper-s2", combatChanceBP: 6000 },
        ],
        enemyPool: [
          { enemyArchetypeId: 105, weight: 30 },
          { enemyArchetypeId: 106, weight: 45 },
          { enemyArchetypeId: 107, weight: 25 },
        ],
        nextNodeIds: ["z4-core"],
      },
      {
        nodeId: "z4-lower",
        subnodes: [
          { subnodeId: "z4-lower-s1", combatChanceBP: 6500 },
          { subnodeId: "z4-lower-s2", combatChanceBP: 8500 },
        ],
        enemyPool: [
          { enemyArchetypeId: 103, weight: 35 },
          { enemyArchetypeId: 106, weight: 35 },
          { enemyArchetypeId: 107, weight: 30 },
        ],
        nextNodeIds: ["z4-core"],
      },
      {
        nodeId: "z4-core",
        subnodes: [
          { subnodeId: "z4-core-s1", combatChanceBP: 9000 },
          { subnodeId: "z4-core-s2", combatChanceBP: 7500 },
        ],
        enemyPool: [
          { enemyArchetypeId: 105, weight: 30 },
          { enemyArchetypeId: 106, weight: 40 },
          { enemyArchetypeId: 107, weight: 30 },
        ],
        nextNodeIds: [],
      },
    ],
  }),
  buildTopology({
    zoneId: 5,
    topologyVersion: 1,
    startNodeId: "z5-entry",
    terminalNodeIds: ["z5-core"],
    enemyRules: [
      { enemyArchetypeId: 104, maxPerRun: 1 },
      { enemyArchetypeId: 106, maxPerRun: 2 },
      { enemyArchetypeId: 108, maxPerRun: 2 },
      { enemyArchetypeId: 109, maxPerRun: 2 },
    ],
    nodes: [
      {
        nodeId: "z5-entry",
        subnodes: [
          { subnodeId: "z5-entry-s1", combatChanceBP: 8000 },
          { subnodeId: "z5-entry-s2", combatChanceBP: 9000 },
        ],
        enemyPool: [
          { enemyArchetypeId: 104, weight: 20 },
          { enemyArchetypeId: 106, weight: 35 },
          { enemyArchetypeId: 108, weight: 25 },
          { enemyArchetypeId: 109, weight: 20 },
        ],
        nextNodeIds: ["z5-upper", "z5-lower"],
      },
      {
        nodeId: "z5-upper",
        subnodes: [
          { subnodeId: "z5-upper-s1", combatChanceBP: 8500 },
          { subnodeId: "z5-upper-s2", combatChanceBP: 6000 },
        ],
        enemyPool: [
          { enemyArchetypeId: 106, weight: 35 },
          { enemyArchetypeId: 108, weight: 35 },
          { enemyArchetypeId: 109, weight: 30 },
        ],
        nextNodeIds: ["z5-core"],
      },
      {
        nodeId: "z5-lower",
        subnodes: [
          { subnodeId: "z5-lower-s1", combatChanceBP: 7000 },
          { subnodeId: "z5-lower-s2", combatChanceBP: 9000 },
        ],
        enemyPool: [
          { enemyArchetypeId: 104, weight: 15 },
          { enemyArchetypeId: 106, weight: 35 },
          { enemyArchetypeId: 109, weight: 50 },
        ],
        nextNodeIds: ["z5-core"],
      },
      {
        nodeId: "z5-core",
        subnodes: [
          { subnodeId: "z5-core-s1", combatChanceBP: 9500 },
          { subnodeId: "z5-core-s2", combatChanceBP: 8500 },
        ],
        enemyPool: [
          { enemyArchetypeId: 106, weight: 25 },
          { enemyArchetypeId: 108, weight: 35 },
          { enemyArchetypeId: 109, weight: 40 },
        ],
        nextNodeIds: [],
      },
    ],
  }),
];

const TOPOLOGY_BY_ZONE_ID = new Map(TOPOLOGIES.map((topology) => [topology.zoneId, topology] as const));

function cloneTopology(topology: ZoneRunTopology): ZoneRunTopology {
  return {
    ...topology,
    enemyRules: topology.enemyRules.map((entry) => ({ ...entry })),
    nodes: topology.nodes.map((node) => ({
      ...node,
      subnodes: node.subnodes.map((subnode) => ({ ...subnode })),
      enemyPool: node.enemyPool.map((entry) => ({ ...entry })),
      nextNodeIds: [...node.nextNodeIds],
    })),
  };
}

function assertIntegrity(): void {
  for (const topology of TOPOLOGIES) {
    const nodeIds = new Set(topology.nodes.map((node) => node.nodeId));
    if (!nodeIds.has(topology.startNodeId)) {
      throw new Error(`ERR_INVALID_ZONE_TOPOLOGY: zone ${topology.zoneId} missing start node`);
    }

    const legalEnemyIds = new Set(topology.enemyRules.map((entry) => entry.enemyArchetypeId));
    for (const rule of topology.enemyRules) {
      getEnemyArchetypeDef(rule.enemyArchetypeId);
      if (!Number.isInteger(rule.maxPerRun) || rule.maxPerRun <= 0) {
        throw new Error(`ERR_INVALID_ZONE_TOPOLOGY: zone ${topology.zoneId} has invalid maxPerRun`);
      }
    }

    for (const node of topology.nodes) {
      if (node.subnodes.length === 0) {
        throw new Error(`ERR_INVALID_ZONE_TOPOLOGY: node ${node.nodeId} has no subnodes`);
      }

      for (const subnode of node.subnodes) {
        if (!Number.isInteger(subnode.combatChanceBP) || subnode.combatChanceBP < 0 || subnode.combatChanceBP > 10000) {
          throw new Error(`ERR_INVALID_ZONE_TOPOLOGY: subnode ${subnode.subnodeId} has invalid combat chance`);
        }
      }

      for (const nextNodeId of node.nextNodeIds) {
        if (!nodeIds.has(nextNodeId)) {
          throw new Error(`ERR_INVALID_ZONE_TOPOLOGY: node ${node.nodeId} references unknown node ${nextNodeId}`);
        }
      }

      for (const poolEntry of node.enemyPool) {
        if (!legalEnemyIds.has(poolEntry.enemyArchetypeId)) {
          throw new Error(`ERR_INVALID_ZONE_TOPOLOGY: node ${node.nodeId} references illegal enemy ${poolEntry.enemyArchetypeId}`);
        }
        if (!Number.isInteger(poolEntry.weight) || poolEntry.weight <= 0) {
          throw new Error(`ERR_INVALID_ZONE_TOPOLOGY: node ${node.nodeId} has non-positive weight`);
        }
      }
    }
  }
}

assertIntegrity();

export function getZoneRunTopology(zoneId: number): ZoneRunTopology {
  const topology = TOPOLOGY_BY_ZONE_ID.get(zoneId);
  if (topology === undefined) {
    throw new Error(`ERR_UNKNOWN_ZONE_ID: ${zoneId}`);
  }

  return cloneTopology(topology);
}

export function getZoneNode(topology: ZoneRunTopology, nodeId: string): ZoneNodeDef {
  const node = topology.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (node === undefined) {
    throw new Error(`ERR_UNKNOWN_ZONE_NODE: ${nodeId}`);
  }

  return {
    ...node,
    subnodes: node.subnodes.map((subnode) => ({ ...subnode })),
    enemyPool: node.enemyPool.map((entry) => ({ ...entry })),
    nextNodeIds: [...node.nextNodeIds],
  };
}
