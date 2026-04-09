import { NextResponse } from "next/server";

import { startZoneRun } from "../../../../lib/combat/zoneRunService";
import { statusForZoneRunError } from "../routeSupport";

export async function POST(request: Request) {
  let body: Partial<{ characterId: string; zoneId: number }>;

  try {
    body = (await request.json()) as Partial<{ characterId: string; zoneId: number }>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (
    typeof body.characterId !== "string" ||
    body.characterId.length === 0 ||
    typeof body.zoneId !== "number"
  ) {
    return NextResponse.json(
      { error: "Invalid payload: expected characterId and zoneId." },
      { status: 400 },
    );
  }

  try {
    const result = await startZoneRun({
      characterId: body.characterId,
      zoneId: body.zoneId,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start zone run.";
    return NextResponse.json({ error: message }, { status: statusForZoneRunError(message) });
  }
}
