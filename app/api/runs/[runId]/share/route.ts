import { NextResponse } from "next/server";

import { createRunSharePayload } from "../../../../../lib/runResultService";

type Context = {
  params: {
    runId: string;
  };
};

export async function POST(request: Request, context: Context) {
  const runId = context.params.runId;
  if (!runId) {
    return NextResponse.json({ error: "runId is required." }, { status: 400 });
  }

  try {
    const origin = new URL(request.url).origin;
    const share = await createRunSharePayload(runId, origin);
    return NextResponse.json(share, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create share link.";
    const status = message.startsWith("ERR_RUN_NOT_FOUND") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
