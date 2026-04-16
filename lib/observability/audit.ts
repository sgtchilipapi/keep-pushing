import { randomUUID } from 'node:crypto';

import { prisma } from '../prisma';

export interface AuditLogInput {
  requestId?: string | null;
  sessionId?: string | null;
  userId?: string | null;
  walletAddress?: string | null;
  actionType: string;
  phase: string;
  status: 'SUCCESS' | 'ERROR';
  errorCode?: string | null;
  httpStatus?: number | null;
  chainSignature?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadataJson?: unknown;
}

export function createAuditRequestId(): string {
  return randomUUID();
}

export async function writeAuditLog(input: AuditLogInput) {
  return prisma.txAuditLog.create(input);
}

export async function writeAuditLogSafe(input: AuditLogInput) {
  try {
    await writeAuditLog(input);
  } catch (error) {
    console.error('[audit] failed to persist audit row', error);
  }
}
