'use client';

import { base64urlDecode, base64urlEncode, type AddressType, type ISolanaChain, type WalletAddress } from '@phantom/react-sdk';
import type { Transaction, VersionedTransaction } from '@solana/web3.js';

import type { PhantomPublicKeyLike, PhantomSolanaProvider } from './phantomBrowser';
import {
  deserializeLegacyOrVersionedTransactionBase64,
  serializeLegacyOrVersionedTransactionBase64,
} from './playerOwnedV0Transactions';

function createPublicKey(publicKey: string): PhantomPublicKeyLike {
  return { toBase58: () => publicKey };
}

export function getReactSdkSolanaAddress(
  addresses: WalletAddress[] | null | undefined,
  solanaAddressType: AddressType,
): string | null {
  if (!addresses) {
    return null;
  }

  const entry = addresses.find((address) => address.addressType === solanaAddressType);
  return entry?.address ?? null;
}

export function createReactSdkSolanaProvider(
  solana: ISolanaChain,
): PhantomSolanaProvider | null {
  if (!solana.publicKey) {
    return null;
  }

  return {
    isPhantom: true,
    publicKey: createPublicKey(solana.publicKey),
    async connect() {
      if (!solana.publicKey) {
        throw new Error('Phantom Connect did not return a public key.');
      }
      return { publicKey: createPublicKey(solana.publicKey) };
    },
    async disconnect() {
      await solana.disconnect();
    },
    async signMessage(message: Uint8Array) {
      const signed = await solana.signMessage(message);
      return {
        publicKey: createPublicKey(signed.publicKey),
        signature: signed.signature,
      };
    },
    async signTransaction(transaction: Transaction | VersionedTransaction) {
      return solana.signTransaction(transaction);
    },
    async signAndSendTransaction(
      transaction: Transaction | VersionedTransaction,
      options?: {
        presignTransaction?: (
          transaction: Transaction | VersionedTransaction,
        ) => Promise<Transaction | VersionedTransaction>;
      },
    ) {
      return solana.signAndSendTransaction(transaction, options?.presignTransaction
        ? {
            presignTransaction: async (encodedTransaction) => {
              const transactionBytes = base64urlDecode(encodedTransaction);
              const transactionBase64 = Buffer.from(transactionBytes).toString('base64');
              const deserialized =
                deserializeLegacyOrVersionedTransactionBase64(transactionBase64);
              const presigned = await options.presignTransaction?.(deserialized);
              if (!presigned) {
                throw new Error('Presign callback did not return a transaction.');
              }
              const presignedBase64 =
                serializeLegacyOrVersionedTransactionBase64(presigned);
              return base64urlEncode(Buffer.from(presignedBase64, 'base64'));
            },
          }
        : undefined);
    },
  };
}
