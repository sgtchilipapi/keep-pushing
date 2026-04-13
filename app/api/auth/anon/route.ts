import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      error:
        'ERR_ANON_REMOVED: anonymous accounts have been removed. Sign in with a wallet-backed session instead.',
    },
    { status: 410 },
  );
}
