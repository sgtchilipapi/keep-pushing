import { NextResponse } from "next/server";

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
    const result = await acknowledgeSolanaSettlement({
      settlementBatchId: typeof body.settlementBatchId === "string" ? body.settlementBatchId : "",
      prepared: body.prepared as AcknowledgeSettlementRouteRequest["prepared"],
      transactionSignature:
        typeof body.transactionSignature === "string" ? body.transactionSignature : "",
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to acknowledge Solana settlement.";
    return NextResponse.json({ error: message }, { status: statusForError(message) });
  }
}
