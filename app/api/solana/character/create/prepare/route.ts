import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: 'ERR_LEGACY_CHARACTER_CREATE_ROUTE_REMOVED',
        message:
          'Legacy Solana character-create prepare route has been removed. Use /api/v1/characters/create/prepare instead.',
      },
    },
    { status: 410 },
  );
}
