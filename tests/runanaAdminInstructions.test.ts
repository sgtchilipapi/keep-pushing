import { createHash } from 'node:crypto';

import { Keypair, SystemProgram } from '@solana/web3.js';

import {
  buildInitializeClassRegistryInstruction,
  buildInitializeProgramConfigInstruction,
  buildInitializeZoneRegistryInstruction,
  buildUpdateZoneEnemySetInstruction,
} from '../lib/solana/runanaAdminInstructions';
import {
  deriveClassRegistryPda,
  deriveProgramConfigPda,
  deriveZoneEnemySetPda,
  deriveZoneRegistryPda,
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

function hex32(value: string): Buffer {
  return Buffer.from(value, 'hex');
}

describe('runanaAdminInstructions', () => {
  it('builds initialize_program_config with canonical PDA order and maxRunsPerBatch', () => {
    const payer = Keypair.generate().publicKey;
    const admin = Keypair.generate().publicKey;
    const trustedServerSigner = Keypair.generate().publicKey;

    const instruction = buildInitializeProgramConfigInstruction({
      payer,
      adminAuthority: admin,
      trustedServerSigner,
      settlementPaused: false,
      maxBattlesPerBatch: 20,
      maxRunsPerBatch: 4,
      maxHistogramEntriesPerBatch: 12,
    });

    expect(instruction.keys).toEqual([
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: false },
      { pubkey: deriveProgramConfigPda(), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]);

    expect(
      instruction.data.equals(
        Buffer.concat([
          discriminator('initialize_program_config'),
          trustedServerSigner.toBuffer(),
          Buffer.from([0]),
          u16(20),
          u16(4),
          u16(12),
        ]),
      ),
    ).toBe(true);
  });

  it('builds initialize_zone_registry with versioned topology metadata bytes', () => {
    const payer = Keypair.generate().publicKey;
    const admin = Keypair.generate().publicKey;
    const topologyHash = 'ab'.repeat(32);

    const instruction = buildInitializeZoneRegistryInstruction({
      payer,
      adminAuthority: admin,
      zoneId: 7,
      topologyVersion: 3,
      totalSubnodeCount: 9,
      topologyHash,
      expMultiplierNum: 2,
      expMultiplierDen: 1,
    });

    expect(instruction.keys).toEqual([
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: false },
      { pubkey: deriveProgramConfigPda(), isSigner: false, isWritable: false },
      { pubkey: deriveZoneRegistryPda(7, 3), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]);

    expect(
      instruction.data.equals(
        Buffer.concat([
          discriminator('initialize_zone_registry'),
          u16(7),
          u16(3),
          u16(9),
          hex32(topologyHash),
          u16(2),
          u16(1),
        ]),
      ),
    ).toBe(true);
  });

  it('builds update_zone_enemy_set with ordered enemy rule entries', () => {
    const admin = Keypair.generate().publicKey;

    const instruction = buildUpdateZoneEnemySetInstruction({
      adminAuthority: admin,
      zoneId: 7,
      topologyVersion: 3,
      enemyRules: [
        { enemyArchetypeId: 10, maxPerRun: 2 },
        { enemyArchetypeId: 15, maxPerRun: 1 },
        { enemyArchetypeId: 42, maxPerRun: 3 },
      ],
    });

    expect(instruction.keys).toEqual([
      { pubkey: admin, isSigner: true, isWritable: false },
      { pubkey: deriveProgramConfigPda(), isSigner: false, isWritable: false },
      { pubkey: deriveZoneEnemySetPda(7, 3), isSigner: false, isWritable: true },
    ]);

    expect(
      instruction.data.equals(
        Buffer.concat([
          discriminator('update_zone_enemy_set'),
          u16(7),
          u16(3),
          u32(3),
          u16(10),
          u16(2),
          u16(15),
          u16(1),
          u16(42),
          u16(3),
        ]),
      ),
    ).toBe(true);
  });

  it('builds initialize_class_registry for compact class ids', () => {
    const payer = Keypair.generate().publicKey;
    const admin = Keypair.generate().publicKey;

    const instruction = buildInitializeClassRegistryInstruction({
      payer,
      adminAuthority: admin,
      classId: 2,
      enabled: true,
    });

    expect(instruction.keys).toEqual([
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: false },
      { pubkey: deriveProgramConfigPda(), isSigner: false, isWritable: false },
      { pubkey: deriveClassRegistryPda(2), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]);

    expect(
      instruction.data.equals(
        Buffer.concat([discriminator('initialize_class_registry'), u16(2), Buffer.from([1])]),
      ),
    ).toBe(true);
  });

  it('rejects unsorted zone enemy rule entries before submit', () => {
    expect(() =>
      buildUpdateZoneEnemySetInstruction({
        adminAuthority: Keypair.generate().publicKey,
        zoneId: 7,
        topologyVersion: 1,
        enemyRules: [
          { enemyArchetypeId: 10, maxPerRun: 1 },
          { enemyArchetypeId: 10, maxPerRun: 2 },
        ],
      }),
    ).toThrow(
      'ERR_INVALID_ENEMYRULES: enemyRules must be strictly increasing without duplicates',
    );
  });
});
