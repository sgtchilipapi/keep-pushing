import { NextResponse } from "next/server";

import {
  prepareSolanaCharacterCreation,
  type PrepareSolanaCharacterCreationInput,
} from "../../../../../../lib/solana/characterCreation";

function statusForError(message: string): number {
  if (
    message.startsWith("ERR_INVALID_") ||
    message.startsWith("ERR_EMPTY_") ||
    message.startsWith("ERR_PLAYER_MUST_PAY")
  ) {
    return 400;
  }

  if (message.startsWith("ERR_CHARACTER_NOT_FOUND")) {
    return 404;
  }

  if (
    message.startsWith("ERR_CHARACTER_ALREADY_CONFIRMED") ||
    message.startsWith("ERR_CHARACTER_AUTHORITY_MISMATCH") ||
    message.startsWith("ERR_CHARACTER_CHAIN_IDENTITY_CORRUPT")
  ) {
    return 409;
  }

  return 500;
}

export async function POST(request: Request) {
  let body: Partial<PrepareSolanaCharacterCreationInput>;

  try {
    body =
      (await request.json()) as Partial<PrepareSolanaCharacterCreationInput>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const result = await prepareSolanaCharacterCreation({
      characterId:
        typeof body.characterId === "string" ? body.characterId : "",
      authority: typeof body.authority === "string" ? body.authority : "",
      feePayer: typeof body.feePayer === "string" ? body.feePayer : undefined,
      initialUnlockedZoneId:
        typeof body.initialUnlockedZoneId === "number"
          ? body.initialUnlockedZoneId
          : Number.NaN,
    });

    return NextResponse.json(result, {
      status: result.phase === "sign_transaction" ? 201 : 200,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to prepare Solana character creation.";
    return NextResponse.json(
      { error: message },
      { status: statusForError(message) },
    );
  }
}
