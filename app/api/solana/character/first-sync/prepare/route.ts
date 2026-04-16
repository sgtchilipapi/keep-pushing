import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: 'ERR_LEGACY_FIRST_SYNC_ROUTE_REMOVED',
        message:
          'Legacy first-sync prepare route has been removed. Use /api/v1/characters/first-sync/prepare instead.',
      },
    },
    { status: 410 },
  );
}
