import { createPublicKey, randomUUID, verify } from 'node:crypto';

import { PublicKey } from '@solana/web3.js';

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function randomNonce(): string {
  return randomUUID().replace(/-/g, '');
}

export function buildWalletAuthMessage(args: {
  origin: string;
  walletAddress: string;
  nonce: string;
  issuedAtIso: string;
  expiresAtIso: string;
}): string {
  return [
    'KEEP_PUSHING_AUTH_V1',
    `origin:${args.origin}`,
    `wallet:${args.walletAddress}`,
    `nonce:${args.nonce}`,
    `issued_at:${args.issuedAtIso}`,
    `expires_at:${args.expiresAtIso}`,
  ].join('\n');
}

export function verifySolanaMessageSignature(args: {
  walletAddress: string;
  message: string;
  signatureBase64: string;
}): boolean {
  const publicKeyBytes = new PublicKey(args.walletAddress).toBytes();
  const keyObject = createPublicKey({
    key: {
      kty: 'OKP',
      crv: 'Ed25519',
      x: base64UrlEncode(publicKeyBytes),
    },
    format: 'jwk',
  });

  return verify(
    null,
    Buffer.from(args.message, 'utf8'),
    keyObject,
    Buffer.from(args.signatureBase64, 'base64'),
  );
}
