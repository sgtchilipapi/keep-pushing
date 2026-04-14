import { NextResponse } from 'next/server';

import { clearSessionCookie, parseSessionTokenFromCookieHeader, revokeSessionByToken } from '../../../../../lib/auth/session';
import { createAuditRequestId, writeAuditLogSafe } from '../../../../../lib/observability/audit';

export async function POST(request: Request) {
  const requestId = createAuditRequestId();
  const token = parseSessionTokenFromCookieHeader(request.headers.get('cookie'));
  if (token) {
    await revokeSessionByToken(token);
  }
  await writeAuditLogSafe({
    requestId,
    actionType: 'AUTH_LOGOUT',
    phase: 'REQUEST',
    status: 'SUCCESS',
    httpStatus: 200,
    metadataJson: {
      hadSessionToken: token !== null,
    },
  });

  const response = NextResponse.json({ ok: true }, { status: 200 });
  response.headers.set('Set-Cookie', clearSessionCookie());
  return response;
}
