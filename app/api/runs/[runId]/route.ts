import { NextResponse } from "next/server";

import { getRunResult } from "../../../../lib/runResultService";

type Context = {
  params: Promise<{
    runId: string;
  }>;
};

export async function GET(_: Request, context: Context) {
  const { runId } = await context.params;
  if (!runId) {
    return NextResponse.json({ error: "runId is required." }, { status: 400 });
  }

  try {
    const run = await getRunResult(runId);
    return NextResponse.json({ run });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load run result.";
    const status = message.startsWith("ERR_RUN_NOT_FOUND") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
