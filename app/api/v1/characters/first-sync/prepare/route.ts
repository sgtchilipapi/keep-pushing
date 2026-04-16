import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: 'ERR_V1_FIRST_SYNC_ROUTE_REMOVED',
        message:
          'Dedicated first-sync prepare has been removed. Use character create and normal settlement instead.',
      },
    },
    { status: 410 },
  );
}
