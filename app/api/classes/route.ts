import { NextResponse } from "next/server";

import { listEnabledCharacterClasses } from "../../../lib/catalog/classes";

export async function GET() {
  return NextResponse.json({ classes: listEnabledCharacterClasses() });
}
