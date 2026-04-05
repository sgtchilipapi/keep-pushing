import { VersionedTransaction } from '@solana/web3.js';

import type { PreparedPlayerOwnedTransaction } from '../../types/api/solana';

export type WalletAvailability = 'unknown' | 'installed' | 'not_installed';
export type WalletConnectionStatus = 'checking_trusted' | 'disconnected' | 'connecting' | 'connected';
export type WalletActionStatus = 'idle' | 'signing_message' | 'signing_transaction';

export interface PhantomPublicKeyLike {
  toBase58(): string;
}

export interface PhantomConnectOptions {
  onlyIfTrusted?: boolean;
}

export interface PhantomMessageSignature {
  publicKey: PhantomPublicKeyLike;
  signature: Uint8Array;
}

export interface PhantomSolanaProvider {
  isPhantom?: boolean;
  publicKey?: PhantomPublicKeyLike | null;
  connect(options?: PhantomConnectOptions): Promise<{ publicKey: PhantomPublicKeyLike }>;
  disconnect(): Promise<void>;
  signMessage(message: Uint8Array, display?: 'utf8' | 'hex'): Promise<PhantomMessageSignature>;
  signTransaction(transaction: VersionedTransaction): Promise<VersionedTransaction>;
  on?(event: 'connect' | 'disconnect' | 'accountChanged', handler: (...args: unknown[]) => void): void;
  removeListener?(event: 'connect' | 'disconnect' | 'accountChanged', handler: (...args: unknown[]) => void): void;
}

export type PhantomWindowLike = {
  phantom?: {
    solana?: unknown;
  };
  solana?: unknown;
};

export function resolvePhantomProvider(source: PhantomWindowLike | undefined): PhantomSolanaProvider | null {
  if (source === undefined) {
    return null;
  }

  const candidate = source.phantom?.solana ?? source.solana;
  if (candidate === undefined || candidate === null || typeof candidate !== 'object') {
    return null;
  }

  const provider = candidate as Partial<PhantomSolanaProvider>;
  if (provider.isPhantom !== true) {
    return null;
  }

  if (
    typeof provider.connect !== 'function' ||
    typeof provider.disconnect !== 'function' ||
    typeof provider.signMessage !== 'function' ||
    typeof provider.signTransaction !== 'function'
  ) {
    return null;
  }

  return provider as PhantomSolanaProvider;
}

export function getPhantomProvider(): PhantomSolanaProvider | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return resolvePhantomProvider(window as unknown as PhantomWindowLike);
}

export function getWalletAvailability(): WalletAvailability {
  return getPhantomProvider() === null ? 'not_installed' : 'installed';
}

export function getProviderPublicKey(provider: PhantomSolanaProvider): string | null {
  const publicKey = provider.publicKey;
  return publicKey ? publicKey.toBase58() : null;
}

export function normalizeWalletError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }

  return 'Wallet interaction failed.';
}

export async function connectPhantom(args: { onlyIfTrusted?: boolean } = {}): Promise<{
  provider: PhantomSolanaProvider;
  publicKey: string;
}> {
  const provider = getPhantomProvider();
  if (provider === null) {
    throw new Error('Phantom wallet is not installed.');
  }

  const result = await provider.connect(args.onlyIfTrusted ? { onlyIfTrusted: true } : undefined);
  const publicKey = result.publicKey?.toBase58() ?? getProviderPublicKey(provider);
  if (publicKey === null) {
    throw new Error('Phantom did not return a public key.');
  }

  return { provider, publicKey };
}

export async function disconnectPhantom(): Promise<void> {
  const provider = getPhantomProvider();
  if (provider === null) {
    return;
  }

  await provider.disconnect();
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(value, 'base64'));
  }

  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function signAuthorizationMessageBase64(
  provider: PhantomSolanaProvider,
  playerAuthorizationMessageBase64: string,
): Promise<string> {
  const messageBytes = base64ToBytes(playerAuthorizationMessageBase64);
  const signed = await provider.signMessage(messageBytes);
  return bytesToBase64(signed.signature);
}

export async function signPreparedPlayerOwnedTransaction(
  provider: PhantomSolanaProvider,
  prepared: PreparedPlayerOwnedTransaction,
): Promise<{
  signedMessageBase64: string;
  signedTransactionBase64: string;
}> {
  const transactionBytes = base64ToBytes(prepared.serializedTransactionBase64);
  const transaction = VersionedTransaction.deserialize(transactionBytes);
  const signedTransaction = await provider.signTransaction(transaction);
  const signedMessageBytes = signedTransaction.message.serialize();
  const signedTransactionBytes = signedTransaction.serialize();

  return {
    signedMessageBase64: bytesToBase64(signedMessageBytes),
    signedTransactionBase64: bytesToBase64(signedTransactionBytes),
  };
}
