import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Commitment, Connection, Keypair, PublicKey } from '@solana/web3.js';

import { RUNANA_PROGRAM_ID } from './runanaProgram';

const DEFAULT_RUNANA_RPC_URL = 'http://127.0.0.1:8899';
const COMMITMENTS: readonly Commitment[] = ['processed', 'confirmed', 'finalized'];

function assertCommitment(value: string, field: string): Commitment {
  if (!COMMITMENTS.includes(value as Commitment)) {
    throw new Error(
      `ERR_INVALID_${field.toUpperCase()}: ${field} must be one of ${COMMITMENTS.join(', ')}`,
    );
  }

  return value as Commitment;
}

export function resolveRunanaRpcUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.RUNANA_SOLANA_RPC_URL ?? env.SOLANA_RPC_URL ?? DEFAULT_RUNANA_RPC_URL;
}

export function resolveRunanaCommitment(env: NodeJS.ProcessEnv = process.env): Commitment {
  const configured = env.RUNANA_SOLANA_COMMITMENT ?? env.SOLANA_COMMITMENT;
  if (!configured) {
    return 'confirmed';
  }

  return assertCommitment(configured, 'commitment');
}

export function resolveRunanaProgramId(env: NodeJS.ProcessEnv = process.env): PublicKey {
  const configured = env.RUNANA_PROGRAM_ID?.trim();
  if (!configured) {
    return RUNANA_PROGRAM_ID;
  }

  return new PublicKey(configured);
}

export function createRunanaConnection(env: NodeJS.ProcessEnv = process.env): Connection {
  return new Connection(resolveRunanaRpcUrl(env), resolveRunanaCommitment(env));
}

export function loadKeypairFromFile(filePath: string): Keypair {
  const resolvedPath = resolve(filePath);
  const raw = readFileSync(resolvedPath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('ERR_INVALID_KEYPAIR_FILE: keypair file must contain a JSON byte array');
  }

  const secretKey = Uint8Array.from(
    parsed.map((value) => {
      if (!Number.isInteger(value) || value < 0 || value > 255) {
        throw new Error('ERR_INVALID_KEYPAIR_FILE: keypair bytes must be integers between 0 and 255');
      }

      return value;
    }),
  );

  return Keypair.fromSecretKey(secretKey);
}

export interface RunanaBootstrapAuthorities {
  admin: Keypair;
  payer: Keypair;
  adminPath: string;
  payerPath: string;
}

export interface RunanaTrustedServerSigner {
  signer: Keypair;
  signerPath: string;
}

export function loadRunanaBootstrapAuthorities(
  env: NodeJS.ProcessEnv = process.env,
): RunanaBootstrapAuthorities {
  const adminPath = env.RUNANA_ADMIN_KEYPAIR_PATH?.trim();
  if (!adminPath) {
    throw new Error(
      'ERR_MISSING_ADMIN_KEYPAIR_PATH: set RUNANA_ADMIN_KEYPAIR_PATH to the admin signer keypair JSON path',
    );
  }

  const payerPath = env.RUNANA_PAYER_KEYPAIR_PATH?.trim() ?? adminPath;

  return {
    admin: loadKeypairFromFile(adminPath),
    payer: loadKeypairFromFile(payerPath),
    adminPath,
    payerPath,
  };
}

export function loadRunanaTrustedServerSigner(
  env: NodeJS.ProcessEnv = process.env,
): RunanaTrustedServerSigner {
  const signerPath =
    env.RUNANA_SERVER_SIGNER_KEYPAIR_PATH?.trim() ??
    env.RUNANA_TRUSTED_SERVER_SIGNER_KEYPAIR_PATH?.trim();

  if (!signerPath) {
    throw new Error(
      'ERR_MISSING_SERVER_SIGNER_KEYPAIR_PATH: set RUNANA_SERVER_SIGNER_KEYPAIR_PATH to the trusted server signer keypair JSON path',
    );
  }

  return {
    signer: loadKeypairFromFile(signerPath),
    signerPath,
  };
}
