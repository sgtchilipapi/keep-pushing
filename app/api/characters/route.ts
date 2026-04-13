import { NextResponse } from "next/server";

import {
  createPlayableCharacter,
  getCharacterRoster,
} from "../../../lib/characterAppService";
import {
  SessionForbiddenError,
  SessionRequiredError,
  requireSession,
} from "../../../lib/auth/requireSession";

type CreateCharacterPayload = {
  name?: string;
  classId?: string;
  slotIndex?: number;
};

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    const roster = await getCharacterRoster(actor.user.id);
    return NextResponse.json(roster);
  } catch (error) {
    if (error instanceof SessionRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof SessionForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    const message =
      error instanceof Error ? error.message : "Failed to load roster.";
    const status = message.startsWith("ERR_USER_NOT_FOUND") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  let body: CreateCharacterPayload;

  try {
    body = (await request.json()) as CreateCharacterPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }

  try {
    const actor = await requireSession(request);
    const created = await createPlayableCharacter({
      userId: actor.user.id,
      name: body.name,
      classId: body.classId,
      slotIndex: body.slotIndex,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof SessionRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof SessionForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    const message =
      error instanceof Error ? error.message : "Failed to create character.";
    const status =
      message.startsWith("ERR_USER_NOT_FOUND")
        ? 404
        : message.startsWith("ERR_CHARACTER_")
          ? 409
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
