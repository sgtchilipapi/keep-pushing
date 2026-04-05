import {
  buildCanonicalPlayerAuthorizationMessageText,
  computeCanonicalEndStateHashHex,
  computeSettlementBatchHashHex,
  encodeCanonicalPlayerAuthorizationMessage,
  encodeCanonicalServerAttestationMessage,
  encodeHexLower,
} from "../lib/solana/settlementCanonical";
import { PublicKey } from "@solana/web3.js";

function seq(start: number, length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (start + index) & 0xff);
}

describe("settlementCanonical", () => {
  it("computes stable canonical end-state and batch hashes", () => {
    const payload = {
      characterId: seq(0x00, 16),
      batchId: 7,
      startNonce: 8,
      endNonce: 10,
      battleCount: 3,
      startStateHash: seq(0x10, 32),
      endStateHash: seq(0x30, 32),
      zoneProgressDelta: [
        { zoneId: 3, newState: 1 as const },
        { zoneId: 4, newState: 2 as const },
      ],
      encounterHistogram: [
        { zoneId: 3, enemyArchetypeId: 22, count: 2 },
        { zoneId: 4, enemyArchetypeId: 23, count: 1 },
      ],
      optionalLoadoutRevision: 9,
      batchHash: seq(0x50, 32),
      firstBattleTs: 1_700_000_100,
      lastBattleTs: 1_700_000_220,
      seasonId: 4,
      schemaVersion: 2,
      signatureScheme: 0 as const,
    };

    expect(computeCanonicalEndStateHashHex(payload)).toBe(
      "f23e3e988733090bc516e546edf7dc9c8680ce5a230e7ee9088acf1bebf55dd9",
    );
    expect(computeSettlementBatchHashHex(payload)).toBe(
      "6ddcf602283dd99b2d8a7f53e773bbe9800c9c39a0468f7619cbb14469a75b0f",
    );
  });

  it("encodes the server attestation and player authorization domains in program order", () => {
    const payload = {
      characterId: seq(0x00, 16),
      batchId: 7,
      startNonce: 8,
      endNonce: 10,
      battleCount: 3,
      startStateHash: seq(0x10, 32),
      endStateHash: seq(0x30, 32),
      zoneProgressDelta: [
        { zoneId: 3, newState: 1 as const },
        { zoneId: 4, newState: 2 as const },
      ],
      encounterHistogram: [
        { zoneId: 3, enemyArchetypeId: 22, count: 2 },
        { zoneId: 4, enemyArchetypeId: 23, count: 1 },
      ],
      optionalLoadoutRevision: 9,
      batchHash: seq(0x50, 32),
      firstBattleTs: 1_700_000_100,
      lastBattleTs: 1_700_000_220,
      seasonId: 4,
      schemaVersion: 2,
      signatureScheme: 0 as const,
    };

    expect(
      encodeHexLower(
        encodeCanonicalServerAttestationMessage({
          programId: seq(0x70, 32),
          clusterId: 1,
          characterRootPubkey: seq(0x90, 32),
          payload,
        }),
      ),
    ).toBe(
      "707172737475767778797a7b7c7d7e7f808182838485868788898a8b8c8d8e8f01909192939495969798999a9b9c9d9e9fa0a1a2a3a4a5a6a7a8a9aaabacadaeaf000102030405060708090a0b0c0d0e0f070000000000000008000000000000000a00000000000000030064f1536500000000dcf153650000000004000000101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f02000000030001040002020000000300160002000400170001000109000000505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f020000",
    );

    expect(
      encodeHexLower(
        encodeCanonicalPlayerAuthorizationMessage({
          programId: seq(0x70, 32),
          clusterId: 1,
          playerAuthorityPubkey: seq(0xb0, 32),
          characterRootPubkey: seq(0x90, 32),
          batchHash: seq(0x50, 32),
          batchId: 7,
          signatureScheme: 0,
        }),
      ),
    ).toBe(
      "707172737475767778797a7b7c7d7e7f808182838485868788898a8b8c8d8e8f01b0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7c8c9cacbcccdcecf909192939495969798999a9b9c9d9e9fa0a1a2a3a4a5a6a7a8a9aaabacadaeaf505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f070000000000000000",
    );
  });

  it("builds a readable wallet-safe authorization message for signature scheme 1", () => {
    const program = new PublicKey(seq(0x70, 32)).toBase58();
    const playerAuthority = new PublicKey(seq(0xb0, 32)).toBase58();
    const characterRoot = new PublicKey(seq(0x90, 32)).toBase58();
    const text = buildCanonicalPlayerAuthorizationMessageText({
      programId: seq(0x70, 32),
      clusterId: 1,
      playerAuthorityPubkey: seq(0xb0, 32),
      characterRootPubkey: seq(0x90, 32),
      batchHash: seq(0x50, 32),
      batchId: 7,
      signatureScheme: 1,
    });

    expect(text).toBe(
      `RUNANA|settlement|1|1|${program}|${playerAuthority}|${characterRoot}|7|UFFSU1RVVldYWVpbXF1eX2BhYmNkZWZnaGlqa2xtbm8`,
    );
    expect(
      Buffer.from(
        encodeCanonicalPlayerAuthorizationMessage({
          programId: seq(0x70, 32),
          clusterId: 1,
          playerAuthorityPubkey: seq(0xb0, 32),
          characterRootPubkey: seq(0x90, 32),
          batchHash: seq(0x50, 32),
          batchId: 7,
          signatureScheme: 1,
        }),
      ).toString("utf8"),
    ).toBe(text);
  });
});
