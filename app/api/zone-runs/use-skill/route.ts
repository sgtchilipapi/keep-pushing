import { NextResponse } from "next/server";

import { useZoneRunPauseSkill } from "../../../../lib/combat/zoneRunService";
import { statusForZoneRunError } from "../routeSupport";

export async function POST(request: Request) {
  let body: Partial<{ characterId: string; skillId: string }>;

  try {
    body = (await request.json()) as Partial<{ characterId: string; skillId: string }>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (
    typeof body.characterId !== "string" ||
    body.characterId.length === 0 ||
    typeof body.skillId !== "string" ||
    body.skillId.length === 0
  ) {
    return NextResponse.json(
      { error: "Invalid payload: expected characterId and skillId." },
      { status: 400 },
    );
  }

  try {
    const result = await useZoneRunPauseSkill({
      characterId: body.characterId,
      skillId: body.skillId,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to use pause skill.";
    return NextResponse.json({ error: message }, { status: statusForZoneRunError(message) });
  }
}
