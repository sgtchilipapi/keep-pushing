import { NextResponse } from "next/server";

import {
  SessionForbiddenError,
  SessionRequiredError,
  requireSession,
} from "../../../../../lib/auth/requireSession";
import { acknowledgeSolanaSettlement } from "../../../../../lib/solana/settlementRelay";
import type { AcknowledgeSettlementRouteRequest } from "../../../../../types/api/solana";

function statusForError(message: string): number {
  if (
    message.startsWith("ERR_INVALID_") ||
    message.startsWith("ERR_EMPTY_")
  ) {
    return 400;
  }

  if (
    message.startsWith("ERR_CHARACTER_NOT_FOUND") ||
    message.startsWith("ERR_SETTLEMENT_BATCH_NOT_FOUND")
  ) {
    return 404;
  }

  if (
    message.startsWith("ERR_INVALID_SETTLEMENT_SUBMISSION") ||
    message.startsWith("ERR_SETTLEMENT_BATCH_RELAY_MISMATCH") ||
    message.startsWith("ERR_SETTLEMENT_PAYLOAD_RELAY_MISMATCH") ||
    message.startsWith("ERR_SETTLEMENT_OUT_OF_ORDER")
  ) {
    return 409;
  }

  return 500;
}

export async function POST(request: Request) {
  let body: Partial<AcknowledgeSettlementRouteRequest>;

  try {
    body = (await request.json()) as Partial<AcknowledgeSettlementRouteRequest>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.prepared === undefined || body.prepared === null) {
    return NextResponse.json({ error: "prepared is required." }, { status: 400 });
  }

  try {
    const actor = await requireSession(request);
    const prepared = body.prepared as AcknowledgeSettlementRouteRequest["prepared"];
    if (prepared.authority !== actor.session.walletAddress) {
      throw new SessionForbiddenError(
        "ERR_AUTH_WALLET_FORBIDDEN: prepared authority does not match the active session wallet",
      );
    }
    const result = await acknowledgeSolanaSettlement({
      settlementBatchId: typeof body.settlementBatchId === "string" ? body.settlementBatchId : "",
      prepared,
      transactionSignature:
        typeof body.transactionSignature === "string" ? body.transactionSignature : "",
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof SessionRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof SessionForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    const message =
      error instanceof Error ? error.message : "Failed to acknowledge Solana settlement.";
    return NextResponse.json({ error: message }, { status: statusForError(message) });
  }
}
