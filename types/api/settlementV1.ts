import type { PreparedPlayerOwnedTransaction } from './solana';
import type { SettlementBatchPayloadV2 } from '../settlement';

export interface SettlementV1PrepareRequest {
  characterId: string;
  zoneRunId: string;
  idempotencyKey: string;
}

export interface SettlementV1PrepareData {
  prepareRequestId: string;
  zoneRunId: string;
  settlementBatchId: string;
  payload: SettlementBatchPayloadV2;
  preparedTransaction: PreparedPlayerOwnedTransaction;
  presignToken: string;
  expiresAt: string | null;
}

export interface SettlementV1PresignRequest {
  prepareRequestId: string;
  presignToken: string;
  transactionBase64: string;
}

export interface SettlementV1PresignData {
  prepareRequestId: string;
  transactionBase64: string;
  messageSha256Hex: string;
}

export interface SettlementV1FinalizeRequest {
  prepareRequestId: string;
  transactionSignature: string;
}

export interface SettlementV1FinalizeData {
  phase: 'submitted' | 'confirmed';
  settlementBatchId: string;
  transactionSignature: string;
}

export type SettlementV1ResponseEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message?: string; retryable?: boolean; details?: unknown } };
