import { createHash } from 'node:crypto';

import { Keypair, SystemProgram } from '@solana/web3.js';

import {
  buildInitializeProgramConfigInstruction,
  buildInitializeSeasonPolicyInstruction,
  buildUpdateZoneEnemySetInstruction,
} from '../lib/solana/runanaAdminInstructions';
import {
  deriveProgramConfigPda,
  deriveSeasonPolicyPda,
  deriveZoneEnemySetPda,
} from '../lib/solana/runanaProgram';

function discriminator(name: string): Buffer {
  return createHash('sha256')
    .update(`global:${name}`)
    .digest()
    .subarray(0, 8);
}

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

function u64(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value, 0);
  return buffer;
}

describe('runanaAdminInstructions', () => {
  it('builds initialize_program_config with the live Anchor discriminator and PDA order', () => {
    const payer = Keypair.generate().publicKey;
    const admin = Keypair.generate().publicKey;
    const trustedServerSigner = Keypair.generate().publicKey;

    const instruction = buildInitializeProgramConfigInstruction({
      payer,
      adminAuthority: admin,
      trustedServerSigner,
      settlementPaused: false,
      maxBattlesPerBatch: 20,
      maxHistogramEntriesPerBatch: 12,
    });

    expect(instruction.keys).toEqual([
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: false },
      { pubkey: deriveProgramConfigPda(), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]);

    expect(instruction.data.equals(
      Buffer.concat([
        discriminator('initialize_program_config'),
        trustedServerSigner.toBuffer(),
        Buffer.from([0]),
        u16(20),
        u16(12),
      ]),
    )).toBe(true);
  });

  it('builds update_zone_enemy_set with strictly ordered vec<u16> bytes', () => {
    const admin = Keypair.generate().publicKey;

    const instruction = buildUpdateZoneEnemySetInstruction({
      adminAuthority: admin,
      zoneId: 7,
      allowedEnemyArchetypeIds: [10, 15, 42],
    });

    expect(instruction.keys).toEqual([
      { pubkey: admin, isSigner: true, isWritable: false },
      { pubkey: deriveProgramConfigPda(), isSigner: false, isWritable: false },
      { pubkey: deriveZoneEnemySetPda(7), isSigner: false, isWritable: true },
    ]);

    expect(instruction.data.equals(
      Buffer.concat([
        discriminator('update_zone_enemy_set'),
        u16(7),
        u32(3),
        u16(10),
        u16(15),
        u16(42),
      ]),
    )).toBe(true);
  });

  it('serializes initialize_season_policy timestamps as little-endian u64 values', () => {
    const payer = Keypair.generate().publicKey;
    const admin = Keypair.generate().publicKey;

    const instruction = buildInitializeSeasonPolicyInstruction({
      payer,
      adminAuthority: admin,
      seasonId: 4,
      seasonStartTs: 1_710_000_000,
      seasonEndTs: 1_710_086_400,
      commitGraceEndTs: 1_710_172_800n,
    });

    expect(instruction.keys).toEqual([
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: false },
      { pubkey: deriveProgramConfigPda(), isSigner: false, isWritable: false },
      { pubkey: deriveSeasonPolicyPda(4), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]);

    expect(instruction.data.equals(
      Buffer.concat([
        discriminator('initialize_season_policy'),
        u32(4),
        u64(1_710_000_000n),
        u64(1_710_086_400n),
        u64(1_710_172_800n),
      ]),
    )).toBe(true);
  });

  it('rejects unsorted zone enemy member lists before submit', () => {
    expect(() =>
      buildUpdateZoneEnemySetInstruction({
        adminAuthority: Keypair.generate().publicKey,
        zoneId: 7,
        allowedEnemyArchetypeIds: [10, 10],
      }),
    ).toThrow(
      'ERR_INVALID_ALLOWEDENEMYARCHETYPEIDS: allowedEnemyArchetypeIds must be strictly increasing without duplicates',
    );
  });
});
