import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { VersionedTransaction } from "@solana/web3.js";

import { loadKeypairFromFile } from "../../lib/solana/runanaClient";
import type {
  PreparedPlayerOwnedTransaction,
  SubmitSignedPlayerOwnedTransactionRequest,
} from "../../types/api/solana";

interface CliOptions {
  serverUrl: string;
  playerKeypairPath: string;
  userId?: string;
  name?: string;
  seasonId: number;
  zoneId: number;
  artifactsDir: string;
}

interface PrepareRouteResponse {
  character: {
    characterId: string;
    userId: string;
    name: string;
    chain: {
      playerAuthorityPubkey: string;
      chainCharacterIdHex: string;
      characterRootPubkey: string;
      chainCreationStatus: string;
    };
  };
  preparedTransaction: PreparedPlayerOwnedTransaction;
}

interface SubmitRouteResponse {
  characterId: string;
  chainCreationStatus: string;
  transactionSignature: string;
  chainCharacterIdHex: string;
  characterRootPubkey: string;
  chainCreatedAt: string;
  cursor: {
    lastCommittedEndNonce: number;
    lastCommittedStateHash: string;
    lastCommittedBatchId: number;
    lastCommittedBattleTs: number;
    lastCommittedSeasonId: number;
  };
}

function usage(): string {
  return [
    "Usage: npx tsx scripts/solana/createCharacter.ts --player-keypair <path> [options]",
    "",
    "Options:",
    "  --server-url <url>        Backend base URL. Default: http://127.0.0.1:3000",
    "  --player-keypair <path>   Required signer keypair JSON path",
    "  --user-id <id>            Optional existing backend user id; otherwise create anon user",
    "  --name <name>             Optional character name. Default: CLI Manual",
    "  --season-id <id>          Season id at creation. Default: 1",
    "  --zone-id <id>            Initial unlocked zone id. Default: 1",
    "  --artifacts-dir <path>    Output directory for requests/responses.",
    "                            Default: .tmp/manual-character-create/<timestamp>",
    "  --help                    Show this message",
  ].join("\n");
}

function assertInteger(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `ERR_INVALID_${field.toUpperCase()}: ${field} must be a non-negative integer`,
    );
  }
  return parsed;
}

function parseCliArgs(argv: string[]): CliOptions {
  let serverUrl = "http://127.0.0.1:3000";
  let playerKeypairPath = "";
  let userId: string | undefined;
  let name: string | undefined;
  let seasonId = 1;
  let zoneId = 1;
  let artifactsDir = `.tmp/manual-character-create/${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--server-url") {
      serverUrl = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--player-keypair") {
      playerKeypairPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--user-id") {
      userId = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--name") {
      name = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--season-id") {
      seasonId = assertInteger(argv[index + 1] ?? "", "seasonId");
      index += 1;
      continue;
    }

    if (arg === "--zone-id") {
      zoneId = assertInteger(argv[index + 1] ?? "", "zoneId");
      index += 1;
      continue;
    }

    if (arg === "--artifacts-dir") {
      artifactsDir = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--help") {
      console.log(usage());
      process.exit(0);
    }

    throw new Error(`ERR_UNKNOWN_ARGUMENT: unsupported argument ${arg}`);
  }

  if (playerKeypairPath.trim().length === 0) {
    throw new Error(
      "ERR_MISSING_PLAYER_KEYPAIR: provide --player-keypair <path>",
    );
  }

  if (serverUrl.trim().length === 0) {
    throw new Error("ERR_INVALID_SERVER_URL: server url must be non-empty");
  }

  if (artifactsDir.trim().length === 0) {
    throw new Error(
      "ERR_INVALID_ARTIFACTS_DIR: artifacts dir must be non-empty",
    );
  }

  return {
    serverUrl: serverUrl.replace(/\/+$/, ""),
    playerKeypairPath,
    userId: userId?.trim() || undefined,
    name: name?.trim() || "CLI Manual",
    seasonId,
    zoneId,
    artifactsDir,
  };
}

function writeJson(targetPath: string, value: unknown): void {
  writeFileSync(targetPath, JSON.stringify(value, null, 2));
}

async function postJson<TResponse>(
  url: string,
  body?: unknown,
): Promise<TResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  const json = text.length > 0 ? (JSON.parse(text) as unknown) : undefined;

  if (!response.ok) {
    const message =
      typeof json === "object" &&
      json !== null &&
      "error" in json &&
      typeof (json as { error?: unknown }).error === "string"
        ? (json as { error: string }).error
        : `${response.status} ${response.statusText}`;
    throw new Error(`ERR_HTTP_${response.status}: ${message}`);
  }

  return json as TResponse;
}

async function resolveUserId(
  serverUrl: string,
  explicitUserId?: string,
): Promise<string> {
  if (explicitUserId) {
    return explicitUserId;
  }

  const response = await postJson<{ userId: string }>(
    `${serverUrl}/api/auth/anon`,
  );
  if (response.userId.trim().length === 0) {
    throw new Error("ERR_EMPTY_USER_ID: backend returned an empty user id");
  }
  return response.userId;
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const player = loadKeypairFromFile(options.playerKeypairPath);
  const authority = player.publicKey.toBase58();
  const artifactsDir = resolve(process.cwd(), options.artifactsDir);

  mkdirSync(artifactsDir, { recursive: true });

  const userId = await resolveUserId(options.serverUrl, options.userId);
  const prepareRequest = {
    userId,
    authority,
    feePayer: authority,
    name: options.name,
    initialUnlockedZoneId: options.zoneId,
  };

  writeJson(resolve(artifactsDir, "prepare.request.json"), prepareRequest);

  const prepareResponse = await postJson<PrepareRouteResponse>(
    `${options.serverUrl}/api/solana/character/create/prepare`,
    prepareRequest,
  );
  writeJson(resolve(artifactsDir, "prepare.response.json"), prepareResponse);

  const tx = VersionedTransaction.deserialize(
    Buffer.from(
      prepareResponse.preparedTransaction.serializedTransactionBase64,
      "base64",
    ),
  );
  tx.sign([player]);

  const submitRequest: SubmitSignedPlayerOwnedTransactionRequest = {
    prepared:
      prepareResponse.preparedTransaction as PreparedPlayerOwnedTransaction,
    signedMessageBase64: Buffer.from(tx.message.serialize()).toString("base64"),
    signedTransactionBase64: Buffer.from(tx.serialize()).toString("base64"),
  };
  writeJson(resolve(artifactsDir, "submit.request.json"), submitRequest);

  const submitResponse = await postJson<SubmitRouteResponse>(
    `${options.serverUrl}/api/solana/character/create/submit`,
    submitRequest,
  );
  writeJson(resolve(artifactsDir, "submit.response.json"), submitResponse);

  console.log(`artifacts=${artifactsDir}`);
  console.log(`userId=${userId}`);
  console.log(`characterId=${submitResponse.characterId}`);
  console.log(`status=${submitResponse.chainCreationStatus}`);
  console.log(`tx=${submitResponse.transactionSignature}`);
  console.log(`chainCharacterIdHex=${submitResponse.chainCharacterIdHex}`);
  console.log(`characterRootPubkey=${submitResponse.characterRootPubkey}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
