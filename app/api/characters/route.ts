import { NextResponse } from "next/server";

import {
  createPlayableCharacter,
  getCharacterRoster,
} from "../../../lib/characterAppService";

type CreateCharacterPayload = {
  userId?: string;
  name?: string;
  classId?: string;
  slotIndex?: number;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  if (userId === null || userId.length === 0) {
    return NextResponse.json({ error: "userId query parameter is required." }, { status: 400 });
  }

  try {
    const roster = await getCharacterRoster(userId);
    return NextResponse.json(roster);
  } catch (error) {
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

  if (typeof body.userId !== "string" || body.userId.length === 0) {
    return NextResponse.json({ error: "userId is required." }, { status: 400 });
  }
  if (typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }

  try {
    const created = await createPlayableCharacter({
      userId: body.userId,
      name: body.name,
      classId: body.classId,
      slotIndex: body.slotIndex,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
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
