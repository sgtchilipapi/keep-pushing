import { NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';

import { issueAuthNonce } from '../../../../../lib/auth/nonce';

export async function POST(request: Request) {
  let body: { walletAddress?: string; chain?: string };
  try {
    body = (await request.json()) as { walletAddress?: string; chain?: string };
  } catch {
    return NextResponse.json({ ok: false, error: { code: 'AUTH_NONCE_INVALID_JSON' } }, { status: 400 });
  }

  if (body.chain !== 'solana') {
    return NextResponse.json({ ok: false, error: { code: 'AUTH_NONCE_INVALID_CHAIN' } }, { status: 400 });
  }

  if (!body.walletAddress || body.walletAddress.trim().length === 0) {
    return NextResponse.json({ ok: false, error: { code: 'AUTH_NONCE_WALLET_REQUIRED' } }, { status: 400 });
  }

  try {
    void new PublicKey(body.walletAddress);
  } catch {
    return NextResponse.json({ ok: false, error: { code: 'AUTH_NONCE_WALLET_INVALID' } }, { status: 400 });
  }

  const origin = request.headers.get('origin') ?? 'unknown-origin';
  const data = await issueAuthNonce({
    walletAddress: body.walletAddress,
    origin,
  });

  return NextResponse.json({ ok: true, data }, { status: 201 });
}
