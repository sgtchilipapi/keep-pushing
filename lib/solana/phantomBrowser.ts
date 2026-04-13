import { Transaction, VersionedTransaction } from '@solana/web3.js';

import type { PreparedPlayerOwnedTransaction } from '../../types/api/solana';
import {
  deserializeLegacyOrVersionedTransactionBase64,
  serializeLegacyOrVersionedTransactionMessageBase64,
} from './playerOwnedV0Transactions';

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
  signTransaction(
    transaction: Transaction | VersionedTransaction,
  ): Promise<Transaction | VersionedTransaction>;
  signAndSendTransaction?(
    transaction: Transaction | VersionedTransaction,
    options?: {
      presignTransaction?: (
        transaction: Transaction | VersionedTransaction,
      ) => Promise<Transaction | VersionedTransaction>;
    },
  ): Promise<{ signature: string }>;
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

export async function signAuthorizationMessageUtf8(
  provider: PhantomSolanaProvider,
  playerAuthorizationMessageUtf8: string,
): Promise<string> {
  const messageBytes = new TextEncoder().encode(playerAuthorizationMessageUtf8);
  const signed = await provider.signMessage(messageBytes, 'utf8');
  return bytesToBase64(signed.signature);
}

export async function signPreparedPlayerOwnedTransaction(
  provider: PhantomSolanaProvider,
  prepared: PreparedPlayerOwnedTransaction,
): Promise<{
  signedMessageBase64: string;
  signedTransactionBase64: string;
}> {
  const transaction = deserializeLegacyOrVersionedTransactionBase64(
    prepared.serializedTransactionBase64,
  );
  const signedTransaction = await provider.signTransaction(transaction);
  const signedMessageBase64 = serializeLegacyOrVersionedTransactionMessageBase64(signedTransaction);
  const maybeLegacy = signedTransaction as Transaction & { serializeMessage?: unknown };
  const signedTransactionBytes =
    typeof maybeLegacy.serializeMessage === 'function'
      ? maybeLegacy.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        })
      : (signedTransaction as VersionedTransaction).serialize();

  return {
    signedMessageBase64,
    signedTransactionBase64: bytesToBase64(signedTransactionBytes),
  };
}

export async function signAndSendPreparedPlayerOwnedTransaction(
  provider: PhantomSolanaProvider,
  prepared: PreparedPlayerOwnedTransaction,
  options?: {
    presignTransaction?: (
      transaction: Transaction | VersionedTransaction,
    ) => Promise<Transaction | VersionedTransaction>;
  },
): Promise<{
  transactionSignature: string;
}> {
  const transaction = deserializeLegacyOrVersionedTransactionBase64(
    prepared.serializedTransactionBase64,
  );

  if (typeof provider.signAndSendTransaction !== "function") {
    throw new Error("This Phantom version does not support signAndSendTransaction.");
  }

  const result = await provider.signAndSendTransaction(transaction, options);
  if (typeof result.signature !== "string" || result.signature.length === 0) {
    throw new Error("Phantom did not return a transaction signature.");
  }

  return {
    transactionSignature: result.signature,
  };
}
