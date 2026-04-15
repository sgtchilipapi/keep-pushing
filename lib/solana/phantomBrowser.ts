'use client';

import { Transaction, VersionedTransaction } from '@solana/web3.js';

import type { PreparedPlayerOwnedTransaction } from '../../types/api/solana';
import {
  deserializeLegacyOrVersionedTransactionBase64,
  serializeLegacyOrVersionedTransactionMessageBase64,
} from './playerOwnedV0Transactions';

export type WalletAvailability = 'unknown' | 'installed' | 'not_installed';
export type WalletConnectionStatus = 'checking_trusted' | 'disconnected' | 'connecting' | 'connected';
export type WalletActionStatus = 'idle' | 'signing_message' | 'signing_transaction';

type PhantomConnectProvider = 'google' | 'apple' | 'phantom' | 'injected' | 'deeplink';

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

type BrowserSdkAddressType = {
  solana: string;
};

type BrowserSdkModule = {
  AddressType: BrowserSdkAddressType;
  BrowserSDK: new (config: {
    providers: PhantomConnectProvider[];
    addressTypes: string[];
    appId?: string;
    autoConnect?: boolean;
    authOptions?: {
      redirectUrl?: string;
    };
  }) => BrowserSDKLike;
  base64urlDecode(value: string): Uint8Array;
  base64urlEncode(value: Uint8Array): string;
};

type BrowserSDKLike = {
  solana: {
    publicKey: string | null;
    isConnected: boolean;
    signMessage(message: string | Uint8Array): Promise<{
      signature: Uint8Array;
      publicKey: string;
    }>;
    signTransaction(
      transaction: Transaction | VersionedTransaction,
    ): Promise<Transaction | VersionedTransaction>;
    signAndSendTransaction(
      transaction: Transaction | VersionedTransaction,
      options?: {
        presignTransaction?: (transaction: string) => Promise<string>;
      },
    ): Promise<{ signature: string }>;
  };
  connect(options: { provider: PhantomConnectProvider }): Promise<unknown>;
  disconnect(): Promise<void>;
  autoConnect(): Promise<void>;
  on(event: string, callback: (...args: unknown[]) => void): void;
  off(event: string, callback: (...args: unknown[]) => void): void;
};

type BrowserSdkProvider = PhantomSolanaProvider & {
  __phantomSdk: BrowserSDKLike;
};

const PHANTOM_CONNECT_APP_ID =
  process.env.NEXT_PUBLIC_PHANTOM_APP_ID ??
  '7b1fd2de-302c-4f27-b70b-9591ab44cdf3';
const PHANTOM_CONNECT_DEFAULT_PROVIDER = (process.env.NEXT_PUBLIC_PHANTOM_CONNECT_PROVIDER ??
  'google') as PhantomConnectProvider;
const PHANTOM_CONNECT_REDIRECT_URL =
  process.env.NEXT_PUBLIC_PHANTOM_CONNECT_REDIRECT_URL ??
  'https://keep-pushing-git-sync-496362-jay-emmanuel-c-garcianos-projects.vercel.app/';

let browserSdkPromise: Promise<BrowserSDKLike | null> | null = null;
let browserSdkModulePromise: Promise<BrowserSdkModule | null> | null = null;

function logPhantomDebug(message: string, details?: Record<string, unknown>) {
  if (typeof window === 'undefined') {
    return;
  }

  if (details) {
    console.info(`[phantom-connect] ${message}`, details);
    return;
  }

  console.info(`[phantom-connect] ${message}`);
}

function normalizeUnknownError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  if (typeof error === 'object' && error !== null) {
    return { ...error };
  }

  return { value: error };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function resolveBrowserRedirectUrl(): string | undefined {
  if (PHANTOM_CONNECT_REDIRECT_URL.trim().length > 0) {
    return PHANTOM_CONNECT_REDIRECT_URL.trim();
  }

  if (typeof window === 'undefined') {
    return undefined;
  }

  return `${window.location.origin}/`;
}

async function loadBrowserSdkModule(): Promise<BrowserSdkModule | null> {
  if (typeof window === 'undefined') {
    return null;
  }

  if (!browserSdkModulePromise) {
    logPhantomDebug('loading browser sdk module', {
      origin: window.location.origin,
      href: window.location.href,
    });
    browserSdkModulePromise = import('@phantom/browser-sdk')
      .then((module) => module as unknown as BrowserSdkModule)
      .catch((error) => {
        logPhantomDebug('failed to load browser sdk module', normalizeUnknownError(error));
        return null;
      });
  }

  return browserSdkModulePromise;
}

async function loadBrowserSdk(): Promise<BrowserSDKLike | null> {
  if (typeof window === 'undefined') {
    return null;
  }

  if (!browserSdkPromise) {
    browserSdkPromise = loadBrowserSdkModule()
      .then((sdkModule) => {
        if (!sdkModule) {
          return null;
        }

        const { BrowserSDK, AddressType } = sdkModule;
        const providers: PhantomConnectProvider[] = PHANTOM_CONNECT_APP_ID
          ? ['google', 'apple', 'phantom', 'injected', 'deeplink']
          : ['injected'];
        const redirectUrl = resolveBrowserRedirectUrl();
        logPhantomDebug('initializing browser sdk', {
          origin: window.location.origin,
          href: window.location.href,
          appIdPresent: PHANTOM_CONNECT_APP_ID.length > 0,
          appId: PHANTOM_CONNECT_APP_ID,
          redirectUrl,
          providerFallback: PHANTOM_CONNECT_DEFAULT_PROVIDER,
          providers,
        });
        return new BrowserSDK({
          providers,
          addressTypes: [AddressType.solana],
          appId: PHANTOM_CONNECT_APP_ID || undefined,
          authOptions: {
            redirectUrl,
          },
        });
      })
      .catch((error) => {
        logPhantomDebug('failed to initialize browser sdk', normalizeUnknownError(error));
        return null;
      });
  }

  return browserSdkPromise;
}

function createSdkPublicKey(publicKey: string): PhantomPublicKeyLike {
  return { toBase58: () => publicKey };
}

async function resolveSdkPublicKey(sdk: BrowserSDKLike): Promise<string> {
  const publicKey = sdk.solana.publicKey;
  if (!publicKey) {
    throw new Error('Phantom Connect did not return a public key.');
  }
  return publicKey;
}

function createSdkProvider(sdk: BrowserSDKLike, publicKey: string): BrowserSdkProvider {
  return {
    __phantomSdk: sdk,
    isPhantom: true,
    publicKey: createSdkPublicKey(publicKey),
    async connect() {
      return { publicKey: createSdkPublicKey(publicKey) };
    },
    async disconnect() {
      await sdk.disconnect();
    },
    async signMessage(message: Uint8Array, display: 'utf8' | 'hex' = 'utf8') {
      const text = display === 'hex' ? bytesToHex(message) : new TextDecoder().decode(message);
      const signed = await sdk.solana.signMessage(text);
      return { publicKey: createSdkPublicKey(publicKey), signature: signed.signature };
    },
    async signTransaction(transaction: Transaction | VersionedTransaction) {
      return sdk.solana.signTransaction(transaction);
    },
    async signAndSendTransaction(
      transaction: Transaction | VersionedTransaction,
      options?: {
        presignTransaction?: (
          transaction: Transaction | VersionedTransaction,
        ) => Promise<Transaction | VersionedTransaction>;
      },
    ) {
      const presignTransaction = options?.presignTransaction;
      const result = await sdk.solana.signAndSendTransaction(transaction, {
        presignTransaction: presignTransaction
          ? async (encodedTransaction: string) => {
              const sdkModule = await browserSdkModulePromise;
              if (!sdkModule) {
                throw new Error('Phantom Connect SDK is not available.');
              }

              const transactionBytes = sdkModule.base64urlDecode(encodedTransaction);
              const deserialized = VersionedTransaction.deserialize(transactionBytes);
              const presigned = await presignTransaction(deserialized);
              const serialized =
                presigned instanceof Transaction
                  ? presigned.serialize({
                      requireAllSignatures: false,
                      verifySignatures: false,
                    })
                  : presigned.serialize();
              return sdkModule.base64urlEncode(serialized);
            }
          : undefined,
      });

      if (typeof result.signature !== 'string' || result.signature.length === 0) {
        throw new Error('Phantom did not return a transaction signature.');
      }
      return result;
    },
    on(event: 'connect' | 'disconnect' | 'accountChanged', handler: (...args: unknown[]) => void) {
      if (event === 'accountChanged') {
        return;
      }
      if (typeof (sdk as { on?: unknown }).on === 'function') {
        (sdk as { on(event: string, handler: (...args: unknown[]) => void): void }).on(event, handler);
      }
    },
    removeListener(
      event: 'connect' | 'disconnect' | 'accountChanged',
      handler: (...args: unknown[]) => void,
    ) {
      if (event === 'accountChanged') {
        return;
      }
      if (typeof (sdk as { off?: unknown }).off === 'function') {
        (sdk as { off(event: string, handler: (...args: unknown[]) => void): void }).off(event, handler);
      }
    },
  };
}

async function connectWithBrowserSdk(): Promise<{ provider: PhantomSolanaProvider; publicKey: string }> {
  const sdk = await loadBrowserSdk();
  if (!sdk) {
    throw new Error('Phantom Connect SDK is not available.');
  }

  let provider: PhantomConnectProvider = PHANTOM_CONNECT_DEFAULT_PROVIDER;
  if (!PHANTOM_CONNECT_APP_ID) {
    provider = 'injected';
  } else if (provider === 'injected' && getPhantomProvider() === null) {
    provider = 'google';
  }

  logPhantomDebug('starting sdk.connect', {
    provider,
    origin: window.location.origin,
    href: window.location.href,
    redirectUrl: resolveBrowserRedirectUrl(),
    appId: PHANTOM_CONNECT_APP_ID,
  });

  try {
    await sdk.connect({ provider });
  } catch (error) {
    logPhantomDebug('sdk.connect failed', {
      provider,
      origin: window.location.origin,
      href: window.location.href,
      redirectUrl: resolveBrowserRedirectUrl(),
      appId: PHANTOM_CONNECT_APP_ID,
      ...normalizeUnknownError(error),
    });
    throw error;
  }

  logPhantomDebug('sdk.connect succeeded', {
    provider,
    publicKey: sdk.solana.publicKey,
    isConnected: sdk.solana.isConnected,
  });
  const publicKey = await resolveSdkPublicKey(sdk);
  return { provider: createSdkProvider(sdk, publicKey), publicKey };
}

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
  if (PHANTOM_CONNECT_APP_ID) {
    return 'installed';
  }
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
  if (PHANTOM_CONNECT_APP_ID) {
    return connectWithBrowserSdk();
  }

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
  if (PHANTOM_CONNECT_APP_ID) {
    const sdk = await loadBrowserSdk();
    if (sdk && typeof (sdk as { disconnect?: unknown }).disconnect === 'function') {
      await (sdk as { disconnect(): Promise<void> }).disconnect();
    }
    return;
  }

  const provider = getPhantomProvider();
  if (provider === null) {
    return;
  }

  await provider.disconnect();
}

export async function autoConnectPhantom(): Promise<{
  provider: PhantomSolanaProvider;
  publicKey: string;
} | null> {
  if (PHANTOM_CONNECT_APP_ID) {
    const sdk = await loadBrowserSdk();
    if (!sdk) {
      return null;
    }
    if (typeof (sdk as { autoConnect?: unknown }).autoConnect === 'function') {
      await (sdk as { autoConnect(): Promise<void> }).autoConnect();
    }
    if (!sdk.solana.isConnected) {
      return null;
    }
    const publicKey = await resolveSdkPublicKey(sdk);
    return { provider: createSdkProvider(sdk, publicKey), publicKey };
  }

  try {
    return await connectPhantom({ onlyIfTrusted: true });
  } catch {
    return null;
  }
}

export async function subscribeWalletEvents(handlers: {
  onConnect?: (publicKey: string | null) => void;
  onDisconnect?: () => void;
  onAccountChanged?: (publicKey: string | null) => void;
}): Promise<() => void> {
  if (PHANTOM_CONNECT_APP_ID) {
    const sdk = await loadBrowserSdk();
    if (!sdk || typeof (sdk as { on?: unknown }).on !== 'function') {
      return () => undefined;
    }

    const handleConnect = async () => {
      const publicKey = sdk.solana.isConnected ? await resolveSdkPublicKey(sdk) : null;
      handlers.onConnect?.(publicKey);
    };
    const handleDisconnect = () => handlers.onDisconnect?.();

    (sdk as { on(event: string, handler: (...args: unknown[]) => void): void }).on('connect', handleConnect);
    (sdk as { on(event: string, handler: (...args: unknown[]) => void): void }).on('disconnect', handleDisconnect);

    return () => {
      sdk.off('connect', handleConnect);
      sdk.off('disconnect', handleDisconnect);
    };
  }

  const provider = getPhantomProvider();
  if (
    provider === null ||
    typeof provider.on !== 'function' ||
    typeof provider.removeListener !== 'function'
  ) {
    return () => undefined;
  }

  const handleConnect = () => {
    const publicKey = provider.publicKey?.toBase58() ?? null;
    handlers.onConnect?.(publicKey);
  };
  const handleDisconnect = () => handlers.onDisconnect?.();
  const handleAccountChanged = (...args: unknown[]) => {
    const [nextPublicKey] = args;
    if (
      nextPublicKey !== null &&
      typeof nextPublicKey === 'object' &&
      nextPublicKey !== undefined &&
      'toBase58' in nextPublicKey &&
      typeof (nextPublicKey as { toBase58?: unknown }).toBase58 === 'function'
    ) {
      handlers.onAccountChanged?.((nextPublicKey as { toBase58(): string }).toBase58());
      return;
    }
    handlers.onAccountChanged?.(null);
  };

  provider.on('connect', handleConnect);
  provider.on('disconnect', handleDisconnect);
  provider.on('accountChanged', handleAccountChanged);

  return () => {
    provider.removeListener?.('connect', handleConnect);
    provider.removeListener?.('disconnect', handleDisconnect);
    provider.removeListener?.('accountChanged', handleAccountChanged);
  };
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
