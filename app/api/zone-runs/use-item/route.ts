import { NextResponse } from "next/server";

import { useZoneRunConsumableItem } from "../../../../lib/combat/zoneRunService";
import { readRequiredIdempotencyKey, statusForZoneRunError } from "../routeSupport";

export async function POST(request: Request) {
  const requestKey = readRequiredIdempotencyKey(request);
  if (requestKey === null) {
    return NextResponse.json(
      { error: "Missing Idempotency-Key header." },
      { status: 400 },
    );
  }

  let body: Partial<{ characterId: string; itemId: string }>;

  try {
    body = (await request.json()) as Partial<{ characterId: string; itemId: string }>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (
    typeof body.characterId !== "string" ||
    body.characterId.length === 0 ||
    typeof body.itemId !== "string" ||
    body.itemId.length === 0
  ) {
    return NextResponse.json(
      { error: "Invalid payload: expected characterId and itemId." },
      { status: 400 },
    );
  }

  try {
    const result = await useZoneRunConsumableItem({
      characterId: body.characterId,
      itemId: body.itemId,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to use zone-run item.";
    return NextResponse.json({ error: message }, { status: statusForZoneRunError(message) });
  }
}
