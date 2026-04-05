import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

import { createRunanaConnection, loadKeypairFromFile, resolveRunanaCommitment } from '../../lib/solana/runanaClient';
import { buildCanonicalSettlementInstructionAccounts } from '../../lib/solana/runanaSettlementEnvelope';
import type {
  PrepareFirstSyncRouteResponse,
  PrepareSettlementRouteResponse,
} from '../../types/api/solana';

type LookupTableMode = 'first-sync' | 'settlement';

interface CliOptions {
  mode: LookupTableMode;
  serverUrl: string;
  payerKeypairPath: string;
  authority?: string;
  characterId: string;
  lookupTableAddress?: string;
  artifactsDir: string;
}

type PrepareAuthorizeResponse = PrepareFirstSyncRouteResponse | PrepareSettlementRouteResponse;

interface PrepareAuthorizeResult {
  phase: 'authorize';
  payload: PrepareAuthorizeResponse['payload'];
  permitDomain: PrepareAuthorizeResponse['permitDomain'];
  raw: PrepareAuthorizeResponse;
}

function usage(): string {
  return [
    'Usage: npx tsx scripts/solana/createSettlementLookupTable.ts --mode <first-sync|settlement> --payer-keypair <path> --character-id <id> [options]',
    '',
    'Options:',
    '  --mode <mode>             Required. One of: first-sync, settlement',
    '  --server-url <url>        Backend base URL. Default: http://127.0.0.1:3000',
    '  --payer-keypair <path>    Required funded keypair JSON path used to create/extend the ALT',
    '  --authority <pubkey>      Player wallet authority public key. Defaults to payer pubkey',
    '  --character-id <id>       Required backend character id',
    '  --lookup-table <address>  Existing ALT to extend instead of creating a fresh one',
    '  --artifacts-dir <path>    Output directory for requests/responses.',
    '                            Default: .tmp/manual-settlement-lookup-table/<timestamp>',
    '  --help                    Show this message',
  ].join('\n');
}

function parseCliArgs(argv: string[]): CliOptions {
  let mode: LookupTableMode | '' = '';
  let serverUrl = 'http://127.0.0.1:3000';
  let payerKeypairPath = '';
  let authority = '';
  let characterId = '';
  let lookupTableAddress = '';
  let artifactsDir = `.tmp/manual-settlement-lookup-table/${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19)}`;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--mode') {
      const value = argv[index + 1] ?? '';
      if (value !== 'first-sync' && value !== 'settlement') {
        throw new Error('ERR_INVALID_MODE: --mode must be first-sync or settlement');
      }
      mode = value;
      index += 1;
      continue;
    }
    if (arg === '--server-url') {
      serverUrl = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--payer-keypair') {
      payerKeypairPath = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--authority') {
      authority = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--character-id') {
      characterId = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--lookup-table') {
      lookupTableAddress = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--artifacts-dir') {
      artifactsDir = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--help') {
      console.log(usage());
      process.exit(0);
    }

    throw new Error(`ERR_UNKNOWN_ARGUMENT: unsupported argument ${arg}`);
  }

  if (mode === '') {
    throw new Error('ERR_MISSING_MODE: provide --mode <first-sync|settlement>');
  }
  if (payerKeypairPath.trim().length === 0) {
    throw new Error('ERR_MISSING_PAYER_KEYPAIR: provide --payer-keypair <path>');
  }
  if (characterId.trim().length === 0) {
    throw new Error('ERR_MISSING_CHARACTER_ID: provide --character-id <id>');
  }

  return {
    mode,
    serverUrl: serverUrl.replace(/\/+$/, ''),
    payerKeypairPath,
    authority: authority.trim().length > 0 ? authority : undefined,
    characterId,
    lookupTableAddress: lookupTableAddress.trim().length > 0 ? lookupTableAddress : undefined,
    artifactsDir,
  };
}

function writeJson(targetPath: string, value: unknown): void {
  writeFileSync(targetPath, JSON.stringify(value, null, 2));
}

async function postJson<TResponse>(url: string, body: unknown): Promise<TResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  const json = text.length > 0 ? (JSON.parse(text) as unknown) : undefined;

  if (!response.ok) {
    const message =
      typeof json === 'object' &&
      json !== null &&
      'error' in json &&
      typeof (json as { error?: unknown }).error === 'string'
        ? (json as { error: string }).error
        : `${response.status} ${response.statusText}`;
    throw new Error(`ERR_HTTP_${response.status}: ${message}`);
  }

  return json as TResponse;
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

function chunkPublicKeys(values: readonly PublicKey[], chunkSize: number): PublicKey[][] {
  const result: PublicKey[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    result.push(values.slice(index, index + chunkSize));
  }
  return result;
}

async function waitForSlotAdvance(connection: ReturnType<typeof createRunanaConnection>, priorSlot: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const currentSlot = await connection.getSlot('processed');
    if (currentSlot > priorSlot) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error('ERR_LOOKUP_TABLE_NOT_WARMED: address lookup table did not warm up on localnet');
}

async function loadExistingLookupTable(address: PublicKey): Promise<AddressLookupTableAccount | null> {
  const connection = createRunanaConnection();
  const result = await connection.getAddressLookupTable(address);
  return result.value;
}

async function createOrExtendLookupTable(args: {
  payerKeypairPath: string;
  lookupTableAddress?: string;
  addresses: PublicKey[];
}): Promise<{ lookupTableAddress: string; created: boolean; extendedAddressCount: number }> {
  const connection = createRunanaConnection();
  const commitment = resolveRunanaCommitment();
  const payer = loadKeypairFromFile(args.payerKeypairPath);
  const addresses = uniquePublicKeys(args.addresses);

  let lookupTableAddress: PublicKey;
  let created = false;
  let existingAddresses = new Set<string>();

  if (args.lookupTableAddress) {
    lookupTableAddress = new PublicKey(args.lookupTableAddress);
    const existing = await loadExistingLookupTable(lookupTableAddress);
    if (existing === null) {
      throw new Error(
        `ERR_LOOKUP_TABLE_NOT_FOUND: lookup table ${lookupTableAddress.toBase58()} was not found`,
      );
    }
    existingAddresses = new Set(existing.state.addresses.map((address) => address.toBase58()));
  } else {
    const currentSlot = await connection.getSlot('processed');
    const recentSlot = Math.max(currentSlot - 1, 0);
    const [createInstruction, createdAddress] = AddressLookupTableProgram.createLookupTable({
      authority: payer.publicKey,
      payer: payer.publicKey,
      recentSlot,
    });
    const createTransaction = new Transaction().add(createInstruction);
    await sendAndConfirmTransaction(connection, createTransaction, [payer], {
      commitment,
    });
    lookupTableAddress = createdAddress;
    created = true;
  }

  const missingAddresses = addresses.filter((address) => !existingAddresses.has(address.toBase58()));
  const chunks = chunkPublicKeys(missingAddresses, 20);
  let shouldWaitForWarmup = created;

  for (const chunk of chunks) {
    const extendInstruction = AddressLookupTableProgram.extendLookupTable({
      payer: payer.publicKey,
      authority: payer.publicKey,
      lookupTable: lookupTableAddress,
      addresses: chunk,
    });
    const extendTransaction = new Transaction().add(extendInstruction);
    await sendAndConfirmTransaction(connection, extendTransaction, [payer], {
      commitment,
    });
    shouldWaitForWarmup = true;
  }

  if (shouldWaitForWarmup) {
    const priorSlot = await connection.getSlot('processed');
    await waitForSlotAdvance(connection, priorSlot);
  }

  return {
    lookupTableAddress: lookupTableAddress.toBase58(),
    created,
    extendedAddressCount: missingAddresses.length,
  };
}

async function loadPrepareAuthorize(args: {
  mode: LookupTableMode;
  serverUrl: string;
  characterId: string;
  authority: string;
}): Promise<PrepareAuthorizeResult> {
  const body = {
    characterId: args.characterId,
    authority: args.authority,
    feePayer: args.authority,
  };
  const url =
    args.mode === 'first-sync'
      ? `${args.serverUrl}/api/solana/character/first-sync/prepare`
      : `${args.serverUrl}/api/solana/settlement/prepare`;
  const response = await postJson<PrepareAuthorizeResponse>(url, body);
  if (response.phase !== 'authorize') {
    throw new Error('ERR_PREPARE_PHASE: expected authorize response');
  }

  return {
    phase: 'authorize',
    payload: response.payload,
    permitDomain: response.permitDomain,
    raw: response,
  };
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const payer = loadKeypairFromFile(options.payerKeypairPath);
  const authority = options.authority ?? payer.publicKey.toBase58();
  const artifactsDir = resolve(process.cwd(), options.artifactsDir);

  mkdirSync(artifactsDir, { recursive: true });

  const prepareRequest = {
    characterId: options.characterId,
    authority,
    feePayer: authority,
  };
  writeJson(resolve(artifactsDir, `${options.mode}.prepare.authorize.request.json`), prepareRequest);

  const prepareAuthorize = await loadPrepareAuthorize({
    mode: options.mode,
    serverUrl: options.serverUrl,
    characterId: options.characterId,
    authority,
  });
  writeJson(
    resolve(artifactsDir, `${options.mode}.prepare.authorize.response.json`),
    prepareAuthorize.raw,
  );

  const instructionAccounts = buildCanonicalSettlementInstructionAccounts({
    payload: prepareAuthorize.payload,
    playerAuthority: prepareAuthorize.permitDomain.playerAuthority,
    characterRootPubkey: prepareAuthorize.permitDomain.characterRootPubkey,
    programId: new PublicKey(prepareAuthorize.permitDomain.programId),
  });
  const altAddresses = uniquePublicKeys(
    instructionAccounts.slice(1).map((account) => account.pubkey),
  );

  writeJson(
    resolve(artifactsDir, 'lookup-table.addresses.json'),
    altAddresses.map((address) => address.toBase58()),
  );

  const lookupTable = await createOrExtendLookupTable({
    payerKeypairPath: options.payerKeypairPath,
    lookupTableAddress: options.lookupTableAddress,
    addresses: altAddresses,
  });

  writeFileSync(resolve(artifactsDir, 'lookup-table-address.txt'), `${lookupTable.lookupTableAddress}\n`);
  writeJson(resolve(artifactsDir, 'lookup-table.result.json'), {
    mode: options.mode,
    characterId: options.characterId,
    authority,
    payer: payer.publicKey.toBase58(),
    lookupTableAddress: lookupTable.lookupTableAddress,
    created: lookupTable.created,
    extendedAddressCount: lookupTable.extendedAddressCount,
    exportEnv: `export RUNANA_SETTLEMENT_LOOKUP_TABLES=${lookupTable.lookupTableAddress}`,
  });

  console.log(`artifacts=${artifactsDir}`);
  console.log(`mode=${options.mode}`);
  console.log(`characterId=${options.characterId}`);
  console.log(`authority=${authority}`);
  console.log(`payer=${payer.publicKey.toBase58()}`);
  console.log(`lookupTableAddress=${lookupTable.lookupTableAddress}`);
  console.log(`created=${lookupTable.created ? 'yes' : 'no'}`);
  console.log(`extendedAddressCount=${lookupTable.extendedAddressCount}`);
  console.log(`export RUNANA_SETTLEMENT_LOOKUP_TABLES=${lookupTable.lookupTableAddress}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
