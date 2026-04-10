import { NextResponse } from "next/server";

import { continueZoneRunAfterBattle } from "../../../../lib/combat/zoneRunService";
import { readRequiredIdempotencyKey, statusForZoneRunError } from "../routeSupport";

export async function POST(request: Request) {
  const requestKey = readRequiredIdempotencyKey(request);
  if (requestKey === null) {
    return NextResponse.json(
      { error: "Missing Idempotency-Key header." },
      { status: 400 },
    );
  }

  let body: Partial<{ characterId: string }>;

  try {
    body = (await request.json()) as Partial<{ characterId: string }>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.characterId !== "string" || body.characterId.length === 0) {
    return NextResponse.json({ error: "Invalid payload: expected characterId." }, { status: 400 });
  }

  try {
    const result = await continueZoneRunAfterBattle({
      characterId: body.characterId,
      requestKey,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to continue zone run.";
    return NextResponse.json({ error: message }, { status: statusForZoneRunError(message) });
  }
}
