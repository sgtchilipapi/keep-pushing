import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ed25519 } from '@noble/curves/ed25519';
import { VersionedTransaction } from '@solana/web3.js';

import { loadKeypairFromFile } from '../../lib/solana/runanaClient';
import type {
  PrepareFirstSyncRouteResponse,
  PreparedPlayerOwnedTransaction,
  SubmitFirstSyncRouteResponse,
} from '../../types/api/solana';

interface CliOptions {
  serverUrl: string;
  playerKeypairPath: string;
  characterId: string;
  artifactsDir: string;
}

function usage(): string {
  return [
    'Usage: npx tsx scripts/solana/runFirstSync.ts --player-keypair <path> --character-id <id> [options]',
    '',
    'Options:',
    '  --server-url <url>        Backend base URL. Default: http://127.0.0.1:3000',
    '  --player-keypair <path>   Required signer keypair JSON path',
    '  --character-id <id>       Required local-first backend character id',
    '  --artifacts-dir <path>    Output directory for requests/responses.',
    '                            Default: .tmp/manual-first-sync-cli/<timestamp>',
    '  --help                    Show this message',
  ].join('\n');
}

function parseCliArgs(argv: string[]): CliOptions {
  let serverUrl = 'http://127.0.0.1:3000';
  let playerKeypairPath = '';
  let characterId = '';
  let artifactsDir = `.tmp/manual-first-sync-cli/${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19)}`;

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

  const prepareAuthorizeRequest = {
    characterId: options.characterId,
    authority,
    feePayer: authority,
  };
  writeJson(resolve(artifactsDir, 'first-sync.prepare.authorize.request.json'), prepareAuthorizeRequest);

  const prepareAuthorizeResponse = await postJson<PrepareFirstSyncRouteResponse>(
    `${options.serverUrl}/api/solana/character/first-sync/prepare`,
    prepareAuthorizeRequest,
  );
  writeJson(resolve(artifactsDir, 'first-sync.prepare.authorize.response.json'), prepareAuthorizeResponse);

  const playerAuthorizationSignatureBase64 = signAuthorizationMessageBase64(
    prepareAuthorizeResponse.playerAuthorizationMessageBase64,
    player.secretKey,
  );

  const prepareSignRequest = {
    ...prepareAuthorizeRequest,
    playerAuthorizationSignatureBase64,
  };
  writeJson(resolve(artifactsDir, 'first-sync.prepare.sign.request.json'), prepareSignRequest);

  const prepareSignResponse = await postJson<PrepareFirstSyncRouteResponse>(
    `${options.serverUrl}/api/solana/character/first-sync/prepare`,
    prepareSignRequest,
  );
  writeJson(resolve(artifactsDir, 'first-sync.prepare.sign.response.json'), prepareSignResponse);

  if (prepareSignResponse.phase !== 'sign_transaction') {
    throw new Error('ERR_FIRST_SYNC_PREPARE_PHASE: expected sign_transaction response');
  }

  const tx = VersionedTransaction.deserialize(
    Buffer.from(prepareSignResponse.preparedTransaction.serializedTransactionBase64, 'base64'),
  );
  tx.sign([player]);

  const submitRequest = {
    prepared: prepareSignResponse.preparedTransaction as PreparedPlayerOwnedTransaction,
    signedMessageBase64: Buffer.from(tx.message.serialize()).toString('base64'),
    signedTransactionBase64: Buffer.from(tx.serialize()).toString('base64'),
  };
  writeJson(resolve(artifactsDir, 'first-sync.submit.request.json'), submitRequest);

  const submitResponse = await postJson<SubmitFirstSyncRouteResponse>(
    `${options.serverUrl}/api/solana/character/first-sync/submit`,
    submitRequest,
  );
  writeJson(resolve(artifactsDir, 'first-sync.submit.response.json'), submitResponse);

  console.log(`artifacts=${artifactsDir}`);
  console.log(`characterId=${submitResponse.characterId}`);
  console.log(`chainCharacterIdHex=${submitResponse.chainCharacterIdHex}`);
  console.log(`characterRootPubkey=${submitResponse.characterRootPubkey}`);
  console.log(`firstSettlementBatchId=${submitResponse.firstSettlementBatchId}`);
  console.log(`tx=${submitResponse.transactionSignature}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
