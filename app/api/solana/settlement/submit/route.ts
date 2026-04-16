import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: 'ERR_LEGACY_SETTLEMENT_ROUTE_REMOVED',
        message:
          'Legacy settlement submit route has been removed. Use /api/v1/settlement/presign and /api/v1/settlement/finalize instead.',
      },
    },
    { status: 410 },
  );
}
