import { NextResponse } from "next/server";

import { getCurrentSeasonSummary } from "../../../../lib/seasonSummary";

export async function GET() {
  return NextResponse.json(getCurrentSeasonSummary());
}
