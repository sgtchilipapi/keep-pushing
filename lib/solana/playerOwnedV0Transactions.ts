import {
  AddressLookupTableAccount,
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

function toBase64(value: Uint8Array): string {
  return Buffer.from(value).toString('base64');
}

export async function buildPreparedVersionedTransaction(args: {
  connection: Connection;
  feePayer: PublicKey;
  instructions: TransactionInstruction[];
  addressLookupTableAccounts?: AddressLookupTableAccount[];
  commitment?: Commitment;
}): Promise<PreparedVersionedTransaction> {
  const latestBlockhash = await args.connection.getLatestBlockhash(args.commitment);
  const message = new TransactionMessage({
    payerKey: args.feePayer,
    recentBlockhash: latestBlockhash.blockhash,
    instructions: args.instructions,
  }).compileToV0Message(args.addressLookupTableAccounts);
  const transaction = new VersionedTransaction(message);

  return {
    serializedMessageBase64: toBase64(message.serialize()),
    serializedTransactionBase64: toBase64(transaction.serialize()),
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
