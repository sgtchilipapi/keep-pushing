import { Keypair, TransactionMessage, VersionedTransaction } from '@solana/web3.js';

import {
  base64ToBytes,
  bytesToBase64,
  resolvePhantomProvider,
  signAuthorizationMessageUtf8,
  signPreparedPlayerOwnedTransaction,
} from '../lib/solana/phantomBrowser';
import type { PreparedPlayerOwnedTransaction } from '../types/api/solana';

describe('phantomBrowser helpers', () => {
  it('accepts a Phantom provider and rejects non-Phantom providers', () => {
    const phantomProvider = {
      isPhantom: true,
      connect: jest.fn(),
      disconnect: jest.fn(),
      signMessage: jest.fn(),
      signTransaction: jest.fn(),
    };

    const otherProvider = {
      isPhantom: false,
      connect: jest.fn(),
      disconnect: jest.fn(),
      signMessage: jest.fn(),
      signTransaction: jest.fn(),
    };

    expect(resolvePhantomProvider({ phantom: { solana: phantomProvider } })).toBe(phantomProvider);
    expect(resolvePhantomProvider({ solana: otherProvider })).toBeNull();
    expect(resolvePhantomProvider(undefined)).toBeNull();
  });

  it('round-trips bytes through base64 helpers', () => {
    const bytes = Uint8Array.from([1, 2, 3, 4, 200, 201, 255]);
    const encoded = bytesToBase64(bytes);

    expect(base64ToBytes(encoded)).toEqual(bytes);
  });

  it('signs authorization messages with Phantom utf8 display mode', async () => {
    const signature = Uint8Array.from({ length: 64 }, (_, index) => (index + 1) % 256);
    const signMessage = jest.fn(async () => ({
      publicKey: { toBase58: () => 'wallet' },
      signature,
    }));

    const result = await signAuthorizationMessageUtf8(
      {
        isPhantom: true,
        publicKey: { toBase58: () => 'wallet' },
        connect: async () => ({ publicKey: { toBase58: () => 'wallet' } }),
        disconnect: async () => undefined,
        signMessage,
        signTransaction: async (transaction) => transaction,
      },
      'Authorize settlement batch',
    );

    expect(signMessage).toHaveBeenCalledWith(
      new TextEncoder().encode('Authorize settlement batch'),
      'utf8',
    );
    expect(result).toBe(bytesToBase64(signature));
  });

  it('signs a prepared player-owned transaction and returns base64 payloads', async () => {
    const payer = Keypair.generate();
    const versionedTransaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: '11111111111111111111111111111111',
        instructions: [],
      }).compileToV0Message(),
    );

    const prepared = {
      kind: 'player_owned_instruction',
      authority: 'authority',
      feePayer: 'authority',
      serializedMessageBase64: bytesToBase64(versionedTransaction.message.serialize()),
      serializedTransactionBase64: bytesToBase64(versionedTransaction.serialize()),
      messageSha256Hex: 'abc',
      requiresPlayerSignature: true,
      serverBroadcast: true,
    } satisfies PreparedPlayerOwnedTransaction;

    const signature = new Uint8Array(64);
    signature[0] = 7;
    const signTransaction = jest.fn(async () => {
      const transaction = VersionedTransaction.deserialize(base64ToBytes(prepared.serializedTransactionBase64));
      transaction.signatures = [signature];
      return transaction;
    });

    const result = await signPreparedPlayerOwnedTransaction(
      {
        isPhantom: true,
        publicKey: { toBase58: () => 'wallet' },
        connect: async () => ({ publicKey: { toBase58: () => 'wallet' } }),
        disconnect: async () => undefined,
        signMessage: async () => ({ publicKey: { toBase58: () => 'wallet' }, signature }),
        signTransaction,
      },
      prepared,
    );

    expect(signTransaction).toHaveBeenCalledTimes(1);
    expect(result.signedMessageBase64).toBe(prepared.serializedMessageBase64);
    expect(result.signedTransactionBase64).not.toBe(prepared.serializedTransactionBase64);
  });
});
