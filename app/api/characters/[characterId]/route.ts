import { NextResponse } from "next/server";

import {
  SessionForbiddenError,
  SessionRequiredError,
  requireSessionCharacterAccess,
} from "../../../../lib/auth/requireSession";
import { getCharacterDetail } from "../../../../lib/characterAppService";

type Context = {
  params: Promise<{
    characterId: string;
  }>;
};

export async function GET(request: Request, context: Context) {
  const { characterId } = await context.params;

  if (!characterId) {
    return NextResponse.json({ error: "characterId is required." }, { status: 400 });
  }

  try {
    const actor = await requireSessionCharacterAccess(request, characterId);
    const detail = await getCharacterDetail(characterId, actor.user.id);
    return NextResponse.json(detail);
  } catch (error) {
    if (error instanceof SessionRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof SessionForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    const message =
      error instanceof Error ? error.message : "Failed to load character.";
    const status = message.startsWith("ERR_CHARACTER_NOT_FOUND") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
