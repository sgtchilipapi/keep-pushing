import { NextResponse } from "next/server";

import { getCharacterDetail } from "../../../../lib/characterAppService";

type Context = {
  params: {
    characterId: string;
  };
};

export async function GET(request: Request, context: Context) {
  const characterId = context.params.characterId;
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId") ?? undefined;

  if (!characterId) {
    return NextResponse.json({ error: "characterId is required." }, { status: 400 });
  }

  try {
    const detail = await getCharacterDetail(characterId, userId);
    return NextResponse.json(detail);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load character.";
    const status = message.startsWith("ERR_CHARACTER_NOT_FOUND") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
