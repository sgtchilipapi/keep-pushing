import { NextResponse } from 'next/server';

import {
  appendPhantomConnectDebugEvent,
  getPhantomConnectDebugLogFilePath,
  isPhantomConnectDebugEnabled,
  readRecentPhantomConnectDebugEvents,
  type PhantomConnectDebugEvent,
} from '../../../../lib/observability/phantomConnectDebug';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function disabledResponse() {
  return NextResponse.json(
    { ok: false, error: { code: 'PHANTOM_CONNECT_DEBUG_DISABLED' } },
    { status: 404 },
  );
}

export async function POST(request: Request) {
  if (!isPhantomConnectDebugEnabled()) {
    return disabledResponse();
  }

  let body: PhantomConnectDebugEvent;
  try {
    body = (await request.json()) as PhantomConnectDebugEvent;
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'PHANTOM_CONNECT_DEBUG_INVALID_JSON' } },
      { status: 400 },
    );
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    typeof body.area !== 'string' ||
    typeof body.stage !== 'string' ||
    typeof body.level !== 'string' ||
    typeof body.message !== 'string'
  ) {
    return NextResponse.json(
      { ok: false, error: { code: 'PHANTOM_CONNECT_DEBUG_INVALID_PAYLOAD' } },
      { status: 400 },
    );
  }

  const stored = await appendPhantomConnectDebugEvent(body);
  return NextResponse.json({
    ok: true,
    data: {
      eventId: stored.eventId,
      createdAt: stored.createdAt,
      logFilePath: getPhantomConnectDebugLogFilePath(),
    },
  });
}

export async function GET(request: Request) {
  if (!isPhantomConnectDebugEnabled()) {
    return disabledResponse();
  }

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get('limit') ?? '100');
  const entries = await readRecentPhantomConnectDebugEvents(limitParam);

  return NextResponse.json({
    ok: true,
    data: {
      entries,
      logFilePath: getPhantomConnectDebugLogFilePath(),
    },
  });
}
