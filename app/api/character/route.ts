import { NextResponse } from "next/server";

import { getFirstCharacterDetailForUser } from "../../../lib/characterAppService";
import {
  SessionRequiredError,
  requireSession,
} from "../../../lib/auth/requireSession";
import type { CharacterQueryResponse } from "../../../types/api/frontend";

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    const character = await getFirstCharacterDetailForUser(actor.user.id);
    const response: CharacterQueryResponse = { character };
    return NextResponse.json(response);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load character.";
    const status =
      error instanceof SessionRequiredError
        ? 401
        : message.startsWith("ERR_USER_NOT_FOUND")
          ? 404
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
