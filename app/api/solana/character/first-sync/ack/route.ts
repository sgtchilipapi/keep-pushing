import { NextResponse } from "next/server";

import { acknowledgeSolanaFirstSync } from "../../../../../../lib/solana/firstSyncRelay";
import type { AcknowledgeFirstSyncRouteRequest } from "../../../../../../types/api/solana";

function statusForError(message: string): number {
  if (
    message.startsWith("ERR_INVALID_") ||
    message.startsWith("ERR_EMPTY_")
  ) {
    return 400;
  }

  if (message.startsWith("ERR_CHARACTER_NOT_FOUND")) {
    return 404;
  }

  if (
    message.startsWith("ERR_CHARACTER_AUTHORITY_MISMATCH") ||
    message.startsWith("ERR_CHARACTER_CHAIN_ID_MISMATCH") ||
    message.startsWith("ERR_CHARACTER_ROOT_MISMATCH") ||
    message.startsWith("ERR_CHARACTER_SUBMISSION_STATE") ||
    message.startsWith("ERR_FIRST_SYNC_BATCH_RELAY_MISMATCH")
  ) {
    return 409;
  }

  return 500;
}

export async function POST(request: Request) {
  let body: Partial<AcknowledgeFirstSyncRouteRequest>;

  try {
    body = (await request.json()) as Partial<AcknowledgeFirstSyncRouteRequest>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.prepared === undefined || body.prepared === null) {
    return NextResponse.json({ error: "prepared is required." }, { status: 400 });
  }

  try {
    const result = await acknowledgeSolanaFirstSync({
      prepared: body.prepared as AcknowledgeFirstSyncRouteRequest["prepared"],
      transactionSignature:
        typeof body.transactionSignature === "string" ? body.transactionSignature : "",
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to acknowledge Solana first sync.";
    return NextResponse.json({ error: message }, { status: statusForError(message) });
  }
}
