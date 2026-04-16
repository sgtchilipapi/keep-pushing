import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ed25519 } from '@noble/curves/ed25519';
import { VersionedTransaction } from '@solana/web3.js';

import { loadKeypairFromFile } from '../../lib/solana/runanaClient';
import type {
  PrepareSettlementRouteResponse,
  PreparedPlayerOwnedTransaction,
  SubmitSettlementRouteRequest,
} from '../../types/api/solana';

interface CliOptions {
  serverUrl: string;
  playerKeypairPath: string;
  characterId: string;
  zoneId: number;
  seed: number;
  artifactsDir: string;
}

interface EncounterRouteResponse {
  battleId: string;
  characterId: string;
  zoneId: number;
  enemyArchetypeId: number;
  battleNonce: number;
  seasonId: number;
  battleTs: number;
  settlementStatus: 'PENDING';
}

interface SettlementSubmitResponse {
  state: string;
  retryDisposition: string;
  batch: {
    id: string;
    status: string;
    latestTransactionSignature: string | null;
  };
  cursor: {
    lastCommittedEndNonce: number;
    lastCommittedBatchId: number;
  } | null;
}

function usage(): string {
  return [
    'Usage: npx tsx scripts/solana/runEncounterSettlement.ts --player-keypair <path> --character-id <id> [options]',
    '',
    'Options:',
    '  --server-url <url>        Backend base URL. Default: http://127.0.0.1:3000',
    '  --player-keypair <path>   Required signer keypair JSON path',
    '  --character-id <id>       Required confirmed backend character id',
    '  --zone-id <id>            Encounter zone id. Default: 1',
    '  --seed <n>                Encounter seed. Default: 77',
    '  --artifacts-dir <path>    Output directory for requests/responses.',
    '                            Default: .tmp/manual-encounter-settlement/<timestamp>',
    '  --help                    Show this message',
  ].join('\n');
}

function assertInteger(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`ERR_INVALID_${field.toUpperCase()}: ${field} must be a non-negative integer`);
  }
  return parsed;
}

function parseCliArgs(argv: string[]): CliOptions {
  let serverUrl = 'http://127.0.0.1:3000';
  let playerKeypairPath = '';
  let characterId = '';
  let zoneId = 1;
  let seed = 77;
  let artifactsDir = `.tmp/manual-encounter-settlement/${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--server-url') {
      serverUrl = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--player-keypair') {
      playerKeypairPath = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--character-id') {
      characterId = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--zone-id') {
      zoneId = assertInteger(argv[index + 1] ?? '', 'zoneId');
      index += 1;
      continue;
    }
    if (arg === '--seed') {
      seed = assertInteger(argv[index + 1] ?? '', 'seed');
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

  if (playerKeypairPath.trim().length === 0) {
    throw new Error('ERR_MISSING_PLAYER_KEYPAIR: provide --player-keypair <path>');
  }
  if (characterId.trim().length === 0) {
    throw new Error('ERR_MISSING_CHARACTER_ID: provide --character-id <id>');
  }

  return {
    serverUrl: serverUrl.replace(/\/+$/, ''),
    playerKeypairPath,
    characterId,
    zoneId,
    seed,
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

function signAuthorizationMessageBase64(messageBase64: string, secretKey: Uint8Array): string {
  const signature = ed25519.sign(Buffer.from(messageBase64, 'base64'), secretKey.slice(0, 32));
  return Buffer.from(signature).toString('base64');
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const player = loadKeypairFromFile(options.playerKeypairPath);
  const authority = player.publicKey.toBase58();
  const artifactsDir = resolve(process.cwd(), options.artifactsDir);

  mkdirSync(artifactsDir, { recursive: true });

  const encounterRequest = {
    characterId: options.characterId,
    zoneId: options.zoneId,
    seed: options.seed,
  };
  writeJson(resolve(artifactsDir, 'encounter.request.json'), encounterRequest);

  const encounterResponse = await postJson<EncounterRouteResponse>(
    `${options.serverUrl}/api/combat/encounter`,
    encounterRequest,
  );
  writeJson(resolve(artifactsDir, 'encounter.response.json'), encounterResponse);

  const prepareAuthorizeRequest = {
    characterId: options.characterId,
    authority,
    feePayer: authority,
  };
  writeJson(resolve(artifactsDir, 'settlement.prepare.authorize.request.json'), prepareAuthorizeRequest);

  const prepareAuthorizeResponse = await postJson<PrepareSettlementRouteResponse>(
    `${options.serverUrl}/api/solana/settlement/prepare`,
    prepareAuthorizeRequest,
  );
  writeJson(resolve(artifactsDir, 'settlement.prepare.authorize.response.json'), prepareAuthorizeResponse);

  if (prepareAuthorizeResponse.phase !== 'authorize') {
    throw new Error(
      `ERR_SETTLEMENT_PREPARE_PHASE: expected authorize response, received ${prepareAuthorizeResponse.phase}`,
    );
  }

  const playerAuthorizationSignatureBase64 = signAuthorizationMessageBase64(
    prepareAuthorizeResponse.playerAuthorizationMessageBase64,
    player.secretKey,
  );

  const prepareSignRequest = {
    ...prepareAuthorizeRequest,
    playerAuthorizationSignatureBase64,
  };
  writeJson(resolve(artifactsDir, 'settlement.prepare.sign.request.json'), prepareSignRequest);

  const prepareSignResponse = await postJson<PrepareSettlementRouteResponse>(
    `${options.serverUrl}/api/solana/settlement/prepare`,
    prepareSignRequest,
  );
  writeJson(resolve(artifactsDir, 'settlement.prepare.sign.response.json'), prepareSignResponse);

  if (prepareSignResponse.phase !== 'sign_transaction') {
    throw new Error('ERR_SETTLEMENT_PREPARE_PHASE: expected sign_transaction response');
  }

  const tx = VersionedTransaction.deserialize(
    Buffer.from(prepareSignResponse.preparedTransaction.serializedTransactionBase64, 'base64'),
  );
  tx.sign([player]);

  const submitRequest: SubmitSettlementRouteRequest = {
    settlementBatchId: prepareSignResponse.settlementBatchId,
    prepared: prepareSignResponse.preparedTransaction as PreparedPlayerOwnedTransaction,
    signedMessageBase64: Buffer.from(tx.message.serialize()).toString('base64'),
    signedTransactionBase64: Buffer.from(tx.serialize()).toString('base64'),
  };
  writeJson(resolve(artifactsDir, 'settlement.submit.request.json'), submitRequest);

  const submitResponse = await postJson<SettlementSubmitResponse>(
    `${options.serverUrl}/api/solana/settlement/submit`,
    submitRequest,
  );
  writeJson(resolve(artifactsDir, 'settlement.submit.response.json'), submitResponse);

  console.log(`artifacts=${artifactsDir}`);
  console.log(`battleId=${encounterResponse.battleId}`);
  console.log(`battleNonce=${encounterResponse.battleNonce}`);
  console.log(`enemyArchetypeId=${encounterResponse.enemyArchetypeId}`);
  console.log(`settlementBatchId=${submitResponse.batch.id}`);
  console.log(`settlementState=${submitResponse.state}`);
  console.log(`batchStatus=${submitResponse.batch.status}`);
  console.log(`tx=${submitResponse.batch.latestTransactionSignature ?? ''}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
