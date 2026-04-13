import { NextResponse } from "next/server";

import {
  SessionForbiddenError,
  SessionRequiredError,
  requireSessionCharacterAccess,
} from "../../../../lib/auth/requireSession";
import { chooseZoneRunBranch } from "../../../../lib/combat/zoneRunService";
import { readRequiredIdempotencyKey, statusForZoneRunError } from "../routeSupport";

export async function POST(request: Request) {
  const requestKey = readRequiredIdempotencyKey(request);
  if (requestKey === null) {
    return NextResponse.json(
      { error: "Missing Idempotency-Key header." },
      { status: 400 },
    );
  }

  let body: Partial<{ characterId: string; nextNodeId: string }>;

  try {
    body = (await request.json()) as Partial<{ characterId: string; nextNodeId: string }>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (
    typeof body.characterId !== "string" ||
    body.characterId.length === 0 ||
    typeof body.nextNodeId !== "string" ||
    body.nextNodeId.length === 0
  ) {
    return NextResponse.json(
      { error: "Invalid payload: expected characterId and nextNodeId." },
      { status: 400 },
    );
  }

  try {
    await requireSessionCharacterAccess(request, body.characterId);
    const result = await chooseZoneRunBranch({
      characterId: body.characterId,
      nextNodeId: body.nextNodeId,
      requestKey,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof SessionRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof SessionForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    const message = error instanceof Error ? error.message : "Failed to choose branch.";
    return NextResponse.json({ error: message }, { status: statusForZoneRunError(message) });
  }
}
