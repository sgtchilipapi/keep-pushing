import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  type Commitment,
  type Connection,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

import type { SettlementBatchPayloadV2 } from '../../types/settlement';
import { loadRunanaBootstrapAuthorities, loadRunanaSettlementLookupTables } from './runanaClient';
import { buildCanonicalSettlementInstructionAccounts } from './runanaSettlementEnvelope';

function isTruthy(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function uniquePublicKeys(values: readonly PublicKey[]): PublicKey[] {
  const seen = new Set<string>();
  const result: PublicKey[] = [];

  for (const value of values) {
    const key = value.toBase58();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }

  return result;
}

function chunkPublicKeys(values: readonly PublicKey[], size: number): PublicKey[][] {
  const chunks: PublicKey[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function waitForSlotAdvance(connection: Connection, priorSlot: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const currentSlot = await connection.getSlot('processed');
    if (currentSlot > priorSlot) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error('ERR_LOOKUP_TABLE_NOT_WARMED: address lookup table did not warm up on localnet');
}

function shouldAutoCreateSettlementLookupTables(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthy(env.RUNANA_AUTO_CREATE_SETTLEMENT_LOOKUP_TABLES);
}

async function createLocalDevLookupTable(args: {
  connection: Connection;
  commitment?: Commitment;
  payload: SettlementBatchPayloadV2;
  playerAuthority: PublicKey;
  characterRootPubkey: PublicKey;
  programId: PublicKey;
  env?: NodeJS.ProcessEnv;
}): Promise<AddressLookupTableAccount[]> {
  const { admin, payer } = loadRunanaBootstrapAuthorities(args.env);
  const addresses = uniquePublicKeys(
    buildCanonicalSettlementInstructionAccounts({
      payload: args.payload,
      playerAuthority: args.playerAuthority,
      characterRootPubkey: args.characterRootPubkey,
      programId: args.programId,
    })
      .slice(1)
      .map((account) => account.pubkey),
  );

  const currentSlot = await args.connection.getSlot('processed');
  const recentSlot = Math.max(currentSlot - 1, 0);
  const [createInstruction, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
    authority: admin.publicKey,
    payer: payer.publicKey,
    recentSlot,
  });

  await sendAndConfirmTransaction(
    args.connection,
    new Transaction().add(createInstruction),
    [payer, admin],
    { commitment: args.commitment },
  );

  for (const chunk of chunkPublicKeys(addresses, 20)) {
    const extendInstruction = AddressLookupTableProgram.extendLookupTable({
      payer: payer.publicKey,
      authority: admin.publicKey,
      lookupTable: lookupTableAddress,
      addresses: chunk,
    });

    await sendAndConfirmTransaction(
      args.connection,
      new Transaction().add(extendInstruction),
      [payer, admin],
      { commitment: args.commitment },
    );
  }

  const priorSlot = await args.connection.getSlot('processed');
  await waitForSlotAdvance(args.connection, priorSlot);

  const lookupTable = await args.connection.getAddressLookupTable(lookupTableAddress);
  if (lookupTable.value === null) {
    throw new Error(
      `ERR_LOOKUP_TABLE_NOT_FOUND: lookup table ${lookupTableAddress.toBase58()} was not found after creation`,
    );
  }

  return [lookupTable.value];
}

export async function resolveRunanaSettlementLookupTablesOrAutoCreate(args: {
  connection: Connection;
  commitment?: Commitment;
  payload: SettlementBatchPayloadV2;
  playerAuthority: PublicKey;
  characterRootPubkey: PublicKey;
  programId: PublicKey;
  env?: NodeJS.ProcessEnv;
}): Promise<AddressLookupTableAccount[]> {
  const configured = await loadRunanaSettlementLookupTables(args.connection, args.env);
  if (configured.length > 0) {
    return configured;
  }

  if (!shouldAutoCreateSettlementLookupTables(args.env)) {
    return [];
  }

  return createLocalDevLookupTable(args);
}
