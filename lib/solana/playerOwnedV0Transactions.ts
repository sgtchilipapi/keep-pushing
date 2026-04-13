import {
  AddressLookupTableAccount,
  Keypair,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  type Commitment,
  type Connection,
  type TransactionInstruction,
  PublicKey,
} from '@solana/web3.js';

export interface PreparedVersionedTransaction {
  serializedMessageBase64: string;
  serializedTransactionBase64: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}

export type PreparedLegacyOrVersionedTransaction = PreparedVersionedTransaction;

function toBase64(value: Uint8Array): string {
  return Buffer.from(value).toString('base64');
}

export async function buildPreparedVersionedTransaction(args: {
  connection: Connection;
  feePayer: PublicKey;
  instructions: TransactionInstruction[];
  addressLookupTableAccounts?: AddressLookupTableAccount[];
  commitment?: Commitment;
  partialSigners?: Keypair[];
}): Promise<PreparedVersionedTransaction> {
  const latestBlockhash = await args.connection.getLatestBlockhash(args.commitment);
  const message = new TransactionMessage({
    payerKey: args.feePayer,
    recentBlockhash: latestBlockhash.blockhash,
    instructions: args.instructions,
  }).compileToV0Message(args.addressLookupTableAccounts);
  const transaction = new VersionedTransaction(message);
  if (args.partialSigners && args.partialSigners.length > 0) {
    transaction.sign(args.partialSigners);
  }

  return {
    serializedMessageBase64: toBase64(message.serialize()),
    serializedTransactionBase64: toBase64(transaction.serialize()),
    recentBlockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  };
}

export async function buildPreparedLegacyTransaction(args: {
  connection: Connection;
  feePayer: PublicKey;
  instructions: TransactionInstruction[];
  commitment?: Commitment;
  partialSigners?: Keypair[];
}): Promise<PreparedLegacyOrVersionedTransaction> {
  const latestBlockhash = await args.connection.getLatestBlockhash(args.commitment);
  const transaction = new Transaction({
    feePayer: args.feePayer,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  });

  for (const instruction of args.instructions) {
    transaction.add(instruction);
  }
  if (args.partialSigners && args.partialSigners.length > 0) {
    transaction.partialSign(...args.partialSigners);
  }

  return {
    serializedMessageBase64: toBase64(transaction.serializeMessage()),
    serializedTransactionBase64: toBase64(
      transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }),
    ),
    recentBlockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  };
}

export function deserializeVersionedTransactionBase64(base64Value: string): VersionedTransaction {
  return VersionedTransaction.deserialize(Buffer.from(base64Value, 'base64'));
}

export function serializeVersionedTransactionMessageBase64(transaction: VersionedTransaction): string {
  return toBase64(transaction.message.serialize());
}

export function deserializeLegacyOrVersionedTransactionBase64(
  base64Value: string,
): Transaction | VersionedTransaction {
  const bytes = Buffer.from(base64Value, 'base64');

  try {
    return VersionedTransaction.deserialize(bytes);
  } catch {
    return Transaction.from(bytes);
  }
}

export function serializeLegacyOrVersionedTransactionMessageBase64(
  transaction: Transaction | VersionedTransaction,
): string {
  const maybeLegacy = transaction as Transaction & { serializeMessage?: unknown };
  if (typeof maybeLegacy.serializeMessage === 'function') {
    return toBase64(maybeLegacy.serializeMessage());
  }

  const maybeVersioned = transaction as VersionedTransaction & {
    message?: { serialize?: unknown };
  };
  if (
    maybeVersioned.message !== undefined &&
    maybeVersioned.message !== null &&
    typeof maybeVersioned.message.serialize === 'function'
  ) {
    return toBase64(maybeVersioned.message.serialize());
  }

  throw new Error(
    'ERR_INVALID_SIGNED_TRANSACTION: transaction did not expose recognizable legacy or versioned message bytes',
  );
}
