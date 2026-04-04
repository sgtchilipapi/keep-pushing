import {
  AddressLookupTableAccount,
  type Commitment,
  type Connection,
  Keypair,
  PublicKey,
} from '@solana/web3.js';

import type { SettlementBatchPayloadV2 } from '../../types/settlement';
import {
  type PreparedVersionedTransaction,
  buildPreparedVersionedTransaction,
} from './playerOwnedV0Transactions';
import type { SettlementInstructionAccountEnvelope } from './runanaSettlementEnvelope';
import { buildSettlementTransactionInstructions } from './runanaSettlementInstructions';

export interface PrepareSettlementVersionedTransactionArgs {
  connection: Connection;
  envelope: SettlementInstructionAccountEnvelope;
  payload: SettlementBatchPayloadV2;
  feePayer?: PublicKey;
  playerAuthorizationSignature: Uint8Array;
  serverSigner: Keypair;
  addressLookupTableAccounts?: AddressLookupTableAccount[];
  commitment?: Commitment;
  clusterId?: number;
}

export interface PreparedSettlementVersionedTransaction extends PreparedVersionedTransaction {
  serverSignerPubkey: string;
  serverAttestationMessageBase64: string;
  playerAuthorizationMessageBase64: string;
}

function toBase64(value: Uint8Array): string {
  return Buffer.from(value).toString('base64');
}

export async function buildPreparedSettlementVersionedTransaction(
  args: PrepareSettlementVersionedTransactionArgs,
): Promise<PreparedSettlementVersionedTransaction> {
  const feePayer = args.feePayer ?? args.envelope.playerAuthority;
  if (!feePayer.equals(args.envelope.playerAuthority)) {
    throw new Error('ERR_PLAYER_MUST_PAY: battle_settlement requires feePayer to match authority');
  }

  const instructionBundle = buildSettlementTransactionInstructions({
    payload: args.payload,
    envelope: args.envelope,
    playerAuthorizationSignature: args.playerAuthorizationSignature,
    serverSigner: args.serverSigner,
    clusterId: args.clusterId,
  });
  const prepared = await buildPreparedVersionedTransaction({
    connection: args.connection,
    feePayer,
    instructions: instructionBundle.instructions,
    addressLookupTableAccounts: args.addressLookupTableAccounts,
    commitment: args.commitment,
  });

  return {
    ...prepared,
    serverSignerPubkey: args.serverSigner.publicKey.toBase58(),
    serverAttestationMessageBase64: toBase64(instructionBundle.messages.serverAttestationMessage),
    playerAuthorizationMessageBase64: toBase64(
      instructionBundle.messages.playerAuthorizationMessage,
    ),
  };
}
