import { NextResponse } from "next/server";

import { getActiveZoneRun } from "../../../../lib/combat/zoneRunService";
import { statusForZoneRunError } from "../routeSupport";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const characterId = searchParams.get("characterId");

  if (characterId === null || characterId.length === 0) {
    return NextResponse.json({ error: "characterId query parameter is required." }, { status: 400 });
  }

  try {
    const result = await getActiveZoneRun({ characterId });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load active zone run.";
    return NextResponse.json({ error: message }, { status: statusForZoneRunError(message) });
  }
}
