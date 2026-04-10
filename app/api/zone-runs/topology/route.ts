import { NextResponse } from 'next/server';

import {
  getLatestZoneRunTopology,
  getZoneRunTopology,
} from '../../../../lib/combat/zoneRunTopologies';
import { getEnemyArchetypeDef } from '../../../../lib/combat/enemyArchetypes';
import type { ZoneRunTopologyResponse } from '../../../../types/zoneRun';

function parsePositiveInt(value: string | null): number | null {
  if (value === null || value.length === 0) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const zoneId = parsePositiveInt(searchParams.get('zoneId'));
  const topologyVersion = parsePositiveInt(searchParams.get('topologyVersion'));

  if (zoneId === null) {
    return NextResponse.json(
      { error: 'zoneId query parameter is required and must be a positive integer.' },
      { status: 400 },
    );
  }

  try {
    const topology =
      topologyVersion === null
        ? getLatestZoneRunTopology(zoneId)
        : getZoneRunTopology(zoneId, topologyVersion);

    const response: ZoneRunTopologyResponse = {
      topology: {
        zoneId: topology.zoneId,
        topologyVersion: topology.topologyVersion,
        topologyHash: topology.topologyHash,
        startNodeId: topology.startNodeId,
        terminalNodeIds: [...topology.terminalNodeIds],
        totalSubnodeCount: topology.totalSubnodeCount,
        enemyRules: topology.enemyRules.map((rule) => ({
          enemyArchetypeId: rule.enemyArchetypeId,
          displayName: getEnemyArchetypeDef(rule.enemyArchetypeId).displayName,
          maxPerRun: rule.maxPerRun,
        })),
        nodes: topology.nodes.map((node) => ({
          nodeId: node.nodeId,
          subnodes: node.subnodes.map((subnode) => ({ ...subnode })),
          nextNodeIds: [...node.nextNodeIds],
          enemyArchetypes: [...new Set(node.enemyPool.map((entry) => entry.enemyArchetypeId))].map(
            (enemyArchetypeId) => ({
              enemyArchetypeId,
              displayName: getEnemyArchetypeDef(enemyArchetypeId).displayName,
            }),
          ),
        })),
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to resolve zone topology.',
      },
      { status: 404 },
    );
  }
}
