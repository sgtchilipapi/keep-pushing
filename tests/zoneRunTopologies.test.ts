import { getZoneNode, getZoneRunTopology } from "../lib/combat/zoneRunTopologies";

describe("zone run topologies", () => {
  it("returns stable zone topology metadata", () => {
    const topology = getZoneRunTopology(2);

    expect(topology.zoneId).toBe(2);
    expect(topology.topologyVersion).toBe(1);
    expect(topology.totalSubnodeCount).toBeGreaterThan(0);
    expect(topology.topologyHash).toHaveLength(64);
  });

  it("exposes node-local enemy pools and branches", () => {
    const topology = getZoneRunTopology(2);
    const node = getZoneNode(topology, "z2-entry");

    expect(node.enemyPool.length).toBeGreaterThan(0);
    expect(node.nextNodeIds).toEqual(["z2-upper", "z2-lower"]);
  });
});
