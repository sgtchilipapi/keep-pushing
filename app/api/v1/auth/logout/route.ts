import { NextResponse } from 'next/server';

import { clearSessionCookie, parseSessionTokenFromCookieHeader, revokeSessionByToken } from '../../../../../lib/auth/session';

export async function POST(request: Request) {
  const token = parseSessionTokenFromCookieHeader(request.headers.get('cookie'));
  if (token) {
    await revokeSessionByToken(token);
  }

  const response = NextResponse.json({ ok: true }, { status: 200 });
  response.headers.set('Set-Cookie', clearSessionCookie());
  return response;
}
