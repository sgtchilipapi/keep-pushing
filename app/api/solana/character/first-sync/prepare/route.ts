import { NextResponse } from "next/server";

import {
  SessionForbiddenError,
  SessionRequiredError,
  requireSessionCharacterAccess,
} from "../../../../../../lib/auth/requireSession";
import {
  prepareSolanaFirstSync,
} from "../../../../../../lib/solana/firstSyncRelay";
import type { PrepareFirstSyncRouteRequest } from "../../../../../../types/api/solana";

function statusForError(message: string): number {
  if (
    message.startsWith("ERR_INVALID_") ||
    message.startsWith("ERR_EMPTY_") ||
    message.startsWith("ERR_PLAYER_MUST_PAY")
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
    message.startsWith("ERR_CHARACTER_CHAIN_IDENTITY_MISSING") ||
    message.startsWith("ERR_CHARACTER_AUTHORITY_MISMATCH") ||
    message.startsWith("ERR_CHARACTER_CURSOR_UNAVAILABLE") ||
    message.startsWith("ERR_NO_FIRST_SYNC_BATCH")
  ) {
    return 409;
  }

  return 500;
}

export async function POST(request: Request) {
  let body: Partial<PrepareFirstSyncRouteRequest>;

  try {
    body = (await request.json()) as Partial<PrepareFirstSyncRouteRequest>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const actor = await requireSessionCharacterAccess(
      request,
      typeof body.characterId === "string" ? body.characterId : "",
    );
    const result = await prepareSolanaFirstSync({
      characterId: typeof body.characterId === "string" ? body.characterId : "",
      authority: actor.session.walletAddress,
      feePayer: undefined,
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
      error instanceof Error ? error.message : "Failed to prepare Solana first sync.";
    return NextResponse.json({ error: message }, { status: statusForError(message) });
  }
}
