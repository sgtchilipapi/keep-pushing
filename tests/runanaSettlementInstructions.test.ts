import {
  AddressLookupTableAccount,
  Ed25519Program,
  Keypair,
  type Connection,
} from '@solana/web3.js';

import { deserializeVersionedTransactionBase64 } from '../lib/solana/playerOwnedV0Transactions';
import type { SettlementInstructionAccountEnvelope } from '../lib/solana/runanaSettlementEnvelope';
import {
  buildApplyBattleSettlementBatchV1Instruction,
  buildCanonicalSettlementMessages,
  buildSettlementTransactionInstructions,
} from '../lib/solana/runanaSettlementInstructions';
import { buildPreparedSettlementVersionedTransaction } from '../lib/solana/settlementTransactionAssembly';
import {
  RUNANA_INSTRUCTIONS_SYSVAR_PUBKEY,
  RUNANA_PROGRAM_ID,
} from '../lib/solana/runanaProgram';
import type { SettlementBatchPayloadV2 } from '../types/settlement';

function seqHex(start: number, length: number): string {
  return Buffer.from(
    Uint8Array.from({ length }, (_, index) => (start + index) & 0xff),
  ).toString('hex');
}

function buildPayload(overrides: Partial<SettlementBatchPayloadV2> = {}): SettlementBatchPayloadV2 {
  return {
    characterId: seqHex(0x00, 16),
    batchId: 7,
    startNonce: 8,
    endNonce: 10,
    battleCount: 3,
    startStateHash: seqHex(0x10, 32),
    endStateHash: seqHex(0x30, 32),
    zoneProgressDelta: [
      { zoneId: 3, newState: 1 },
      { zoneId: 260, newState: 2 },
    ],
    encounterHistogram: [
      { zoneId: 3, enemyArchetypeId: 22, count: 2 },
      { zoneId: 260, enemyArchetypeId: 23, count: 1 },
    ],
    optionalLoadoutRevision: 9,
    batchHash: seqHex(0x50, 32),
    firstBattleTs: 1_700_000_100,
    lastBattleTs: 1_700_000_220,
    seasonId: 4,
    schemaVersion: 2,
    signatureScheme: 0,
    ...overrides,
  };
}

function buildEnvelope(serverSigner: Keypair): SettlementInstructionAccountEnvelope {
  const playerAuthority = Keypair.generate().publicKey;
  const programConfig = Keypair.generate().publicKey;
  const characterRoot = Keypair.generate().publicKey;
  const characterStats = Keypair.generate().publicKey;
  const characterWorldProgress = Keypair.generate().publicKey;
  const primaryZoneProgressPage = Keypair.generate().publicKey;
  const seasonPolicy = Keypair.generate().publicKey;
  const characterBatchCursor = Keypair.generate().publicKey;
  const additionalZoneProgressPage = Keypair.generate().publicKey;
  const zoneRegistry3 = Keypair.generate().publicKey;
  const zoneRegistry260 = Keypair.generate().publicKey;
  const zoneEnemySet3 = Keypair.generate().publicKey;
  const zoneEnemySet260 = Keypair.generate().publicKey;
  const enemyArchetypeRegistry22 = Keypair.generate().publicKey;
  const enemyArchetypeRegistry23 = Keypair.generate().publicKey;

  return {
    programId: RUNANA_PROGRAM_ID,
    playerAuthority,
    instructionsSysvar: RUNANA_INSTRUCTIONS_SYSVAR_PUBKEY,
    programConfig: {
      pubkey: programConfig,
      trustedServerSigner: serverSigner.publicKey,
    },
    characterRoot: {
      pubkey: characterRoot,
    },
    characterStats: {
      pubkey: characterStats,
    },
    characterWorldProgress: {
      pubkey: characterWorldProgress,
    },
    primaryZoneProgressPage: {
      pubkey: primaryZoneProgressPage,
    },
    seasonPolicy: {
      pubkey: seasonPolicy,
    },
    characterBatchCursor: {
      pubkey: characterBatchCursor,
    },
    additionalZoneProgressPages: [
      {
        pubkey: additionalZoneProgressPage,
      },
    ],
    zoneRegistries: [
      {
        pubkey: zoneRegistry3,
      },
      {
        pubkey: zoneRegistry260,
      },
    ],
    zoneEnemySets: [
      {
        pubkey: zoneEnemySet3,
      },
      {
        pubkey: zoneEnemySet260,
      },
    ],
    enemyArchetypeRegistries: [
      {
        pubkey: enemyArchetypeRegistry22,
      },
      {
        pubkey: enemyArchetypeRegistry23,
      },
    ],
    referencedPageIndices: [0, 1],
    referencedZoneIds: [3, 260],
    referencedEnemyArchetypeIds: [22, 23],
    instructionAccounts: [
      { role: 'playerAuthority', pubkey: playerAuthority, isSigner: false, isWritable: false },
      {
        role: 'instructionsSysvar',
        pubkey: RUNANA_INSTRUCTIONS_SYSVAR_PUBKEY,
        isSigner: false,
        isWritable: false,
      },
      { role: 'programConfig', pubkey: programConfig, isSigner: false, isWritable: false },
      { role: 'characterRoot', pubkey: characterRoot, isSigner: false, isWritable: false },
      { role: 'characterStats', pubkey: characterStats, isSigner: false, isWritable: true },
      {
        role: 'characterWorldProgress',
        pubkey: characterWorldProgress,
        isSigner: false,
        isWritable: true,
      },
      {
        role: 'characterZoneProgressPage',
        pubkey: primaryZoneProgressPage,
        isSigner: false,
        isWritable: true,
      },
      { role: 'seasonPolicy', pubkey: seasonPolicy, isSigner: false, isWritable: false },
      {
        role: 'characterSettlementBatchCursor',
        pubkey: characterBatchCursor,
        isSigner: false,
        isWritable: true,
      },
      {
        role: 'additionalZoneProgressPage:1',
        pubkey: additionalZoneProgressPage,
        isSigner: false,
        isWritable: true,
      },
      { role: 'zoneRegistry:3', pubkey: zoneRegistry3, isSigner: false, isWritable: false },
      { role: 'zoneRegistry:260', pubkey: zoneRegistry260, isSigner: false, isWritable: false },
      { role: 'zoneEnemySet:3', pubkey: zoneEnemySet3, isSigner: false, isWritable: false },
      { role: 'zoneEnemySet:260', pubkey: zoneEnemySet260, isSigner: false, isWritable: false },
      {
        role: 'enemyArchetypeRegistry:22',
        pubkey: enemyArchetypeRegistry22,
        isSigner: false,
        isWritable: false,
      },
      {
        role: 'enemyArchetypeRegistry:23',
        pubkey: enemyArchetypeRegistry23,
        isSigner: false,
        isWritable: false,
      },
    ],
    remainingAccounts: [],
  } as unknown as SettlementInstructionAccountEnvelope;
}

function buildCompactEnvelope(serverSigner: Keypair): SettlementInstructionAccountEnvelope {
  const playerAuthority = Keypair.generate().publicKey;
  const programConfig = Keypair.generate().publicKey;
  const characterRoot = Keypair.generate().publicKey;
  const characterStats = Keypair.generate().publicKey;
  const characterWorldProgress = Keypair.generate().publicKey;
  const primaryZoneProgressPage = Keypair.generate().publicKey;
  const seasonPolicy = Keypair.generate().publicKey;
  const characterBatchCursor = Keypair.generate().publicKey;
  const zoneRegistry3 = Keypair.generate().publicKey;
  const zoneEnemySet3 = Keypair.generate().publicKey;
  const enemyArchetypeRegistry22 = Keypair.generate().publicKey;

  return {
    programId: RUNANA_PROGRAM_ID,
    playerAuthority,
    instructionsSysvar: RUNANA_INSTRUCTIONS_SYSVAR_PUBKEY,
    programConfig: {
      pubkey: programConfig,
      trustedServerSigner: serverSigner.publicKey,
    },
    characterRoot: {
      pubkey: characterRoot,
    },
    characterStats: {
      pubkey: characterStats,
    },
    characterWorldProgress: {
      pubkey: characterWorldProgress,
    },
    primaryZoneProgressPage: {
      pubkey: primaryZoneProgressPage,
    },
    seasonPolicy: {
      pubkey: seasonPolicy,
    },
    characterBatchCursor: {
      pubkey: characterBatchCursor,
    },
    additionalZoneProgressPages: [],
    zoneRegistries: [
      {
        pubkey: zoneRegistry3,
      },
    ],
    zoneEnemySets: [
      {
        pubkey: zoneEnemySet3,
      },
    ],
    enemyArchetypeRegistries: [
      {
        pubkey: enemyArchetypeRegistry22,
      },
    ],
    referencedPageIndices: [0],
    referencedZoneIds: [3],
    referencedEnemyArchetypeIds: [22],
    instructionAccounts: [
      { role: 'playerAuthority', pubkey: playerAuthority, isSigner: false, isWritable: false },
      {
        role: 'instructionsSysvar',
        pubkey: RUNANA_INSTRUCTIONS_SYSVAR_PUBKEY,
        isSigner: false,
        isWritable: false,
      },
      { role: 'programConfig', pubkey: programConfig, isSigner: false, isWritable: false },
      { role: 'characterRoot', pubkey: characterRoot, isSigner: false, isWritable: false },
      { role: 'characterStats', pubkey: characterStats, isSigner: false, isWritable: true },
      {
        role: 'characterWorldProgress',
        pubkey: characterWorldProgress,
        isSigner: false,
        isWritable: true,
      },
      {
        role: 'characterZoneProgressPage',
        pubkey: primaryZoneProgressPage,
        isSigner: false,
        isWritable: true,
      },
      { role: 'seasonPolicy', pubkey: seasonPolicy, isSigner: false, isWritable: false },
      {
        role: 'characterSettlementBatchCursor',
        pubkey: characterBatchCursor,
        isSigner: false,
        isWritable: true,
      },
      { role: 'zoneRegistry:3', pubkey: zoneRegistry3, isSigner: false, isWritable: false },
      { role: 'zoneEnemySet:3', pubkey: zoneEnemySet3, isSigner: false, isWritable: false },
      {
        role: 'enemyArchetypeRegistry:22',
        pubkey: enemyArchetypeRegistry22,
        isSigner: false,
        isWritable: false,
      },
    ],
    remainingAccounts: [],
  } as unknown as SettlementInstructionAccountEnvelope;
}

describe('runanaSettlementInstructions', () => {
  it('builds the settlement instruction with canonical account ordering', () => {
    const serverSigner = Keypair.generate();
    const envelope = buildEnvelope(serverSigner);
    const payload = buildPayload();

    const instruction = buildApplyBattleSettlementBatchV1Instruction({
      payload,
      instructionAccounts: envelope.instructionAccounts,
    });

    expect(instruction.programId.toBase58()).toBe(RUNANA_PROGRAM_ID.toBase58());
    expect(instruction.keys.map((key) => key.pubkey.toBase58())).toEqual(
      envelope.instructionAccounts.map((account) => account.pubkey.toBase58()),
    );
    expect(instruction.keys.map((key) => key.isWritable)).toEqual(
      envelope.instructionAccounts.map((account) => account.isWritable),
    );
    expect(instruction.data.subarray(0, 8).toString('hex')).toBe('b8533f822811dde6');
  });

  it('assembles dual ed25519 preinstructions ahead of the settlement instruction', () => {
    const serverSigner = Keypair.generate();
    const envelope = buildEnvelope(serverSigner);
    const payload = buildPayload();
    const playerAuthorizationSignature = Uint8Array.from(
      Array.from({ length: 64 }, (_, index) => index + 1),
    );

    const canonicalMessages = buildCanonicalSettlementMessages({
      payload,
      playerAuthority: envelope.playerAuthority,
      characterRoot: envelope.characterRoot.pubkey,
    });
    const bundle = buildSettlementTransactionInstructions({
      payload,
      envelope,
      playerAuthorizationSignature,
      serverSigner,
    });

    expect(bundle.instructions).toHaveLength(3);
    expect(bundle.instructions[0].programId.toBase58()).toBe(Ed25519Program.programId.toBase58());
    expect(bundle.instructions[1].programId.toBase58()).toBe(Ed25519Program.programId.toBase58());
    expect(bundle.instructions[2].programId.toBase58()).toBe(RUNANA_PROGRAM_ID.toBase58());
    expect(Buffer.from(bundle.messages.serverAttestationMessage).toString('hex')).toBe(
      Buffer.from(canonicalMessages.serverAttestationMessage).toString('hex'),
    );
    expect(Buffer.from(bundle.messages.playerAuthorizationMessage).toString('hex')).toBe(
      Buffer.from(canonicalMessages.playerAuthorizationMessage).toString('hex'),
    );
  });

  it('prepares a lookup-table-backed v0 settlement transaction', async () => {
    const serverSigner = Keypair.generate();
    const envelope = buildCompactEnvelope(serverSigner);
    const payload = buildPayload({
      zoneProgressDelta: [{ zoneId: 3, newState: 1 }],
      encounterHistogram: [{ zoneId: 3, enemyArchetypeId: 22, count: 1 }],
    });
    const lookupTable = new AddressLookupTableAccount({
      key: Keypair.generate().publicKey,
      state: {
        deactivationSlot: 18446744073709551615n,
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        // Mirror the harness behavior by offloading nearly every non-signer
        // settlement account into the lookup table so the dual-ed25519 flow fits.
        addresses: envelope.instructionAccounts.slice(1).map((account) => account.pubkey),
      },
    });
    const connection = {
      getLatestBlockhash: jest.fn().mockResolvedValue({
        blockhash: Keypair.generate().publicKey.toBase58(),
        lastValidBlockHeight: 88,
      }),
    } as unknown as Connection;

    const prepared = await buildPreparedSettlementVersionedTransaction({
      connection,
      envelope,
      payload,
      playerAuthorizationSignature: Uint8Array.from(
        Array.from({ length: 64 }, (_, index) => 200 - index),
      ),
      serverSigner,
      addressLookupTableAccounts: [lookupTable],
    });
    const transaction = deserializeVersionedTransactionBase64(
      prepared.serializedTransactionBase64,
    );
    const accountKeys = transaction.message.getAccountKeys({
      addressLookupTableAccounts: [lookupTable],
    });

    expect(transaction.message.addressTableLookups).toHaveLength(1);
    expect(transaction.message.compiledInstructions).toHaveLength(3);
    expect(
      transaction.message.compiledInstructions.map((instruction) =>
        accountKeys.get(instruction.programIdIndex)?.toBase58(),
      ),
    ).toEqual([
      Ed25519Program.programId.toBase58(),
      Ed25519Program.programId.toBase58(),
      RUNANA_PROGRAM_ID.toBase58(),
    ]);
    expect(prepared.serverSignerPubkey).toBe(serverSigner.publicKey.toBase58());
    expect(Buffer.from(prepared.serverAttestationMessageBase64, 'base64').length).toBeGreaterThan(32);
    expect(Buffer.from(prepared.playerAuthorizationMessageBase64, 'base64').length).toBeGreaterThan(32);
  });
});
