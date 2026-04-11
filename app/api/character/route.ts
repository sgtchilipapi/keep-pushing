import { NextResponse } from "next/server";

import { getFirstCharacterDetailForUser } from "../../../lib/characterAppService";
import type { CharacterQueryResponse } from "../../../types/api/frontend";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  if (userId === null || userId.length === 0) {
    return NextResponse.json({ error: "userId query parameter is required." }, { status: 400 });
  }

  try {
    const character = await getFirstCharacterDetailForUser(userId);
    const response: CharacterQueryResponse = { character };
    return NextResponse.json(response);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load character.";
    const status = message.startsWith("ERR_USER_NOT_FOUND") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
