import { prisma } from '../prisma';

import {
  getActiveSessionByToken,
  parseSessionTokenFromCookieHeader,
  type ActiveSession,
} from './session';

export class SessionRequiredError extends Error {
  constructor(message = 'ERR_AUTH_SESSION_REQUIRED: an active session is required') {
    super(message);
    this.name = 'SessionRequiredError';
  }
}

export class SessionForbiddenError extends Error {
  constructor(message = 'ERR_AUTH_FORBIDDEN: session does not own the requested resource') {
    super(message);
    this.name = 'SessionForbiddenError';
  }
}

export interface SessionActor {
  session: ActiveSession;
  user: {
    id: string;
    primaryWalletAddress: string | null;
  };
}

export async function requireSession(request: Request): Promise<SessionActor> {
  const token = parseSessionTokenFromCookieHeader(request.headers.get('cookie'));
  if (!token) {
    throw new SessionRequiredError();
  }

  const session = await getActiveSessionByToken(token);
  if (!session) {
    throw new SessionRequiredError('ERR_AUTH_SESSION_INVALID: session is missing, expired, or revoked');
  }

  const user = await prisma.user.findUnique(session.userId);
  if (!user) {
    throw new SessionRequiredError('ERR_AUTH_SESSION_INVALID: session user no longer exists');
  }

  return {
    session,
    user: {
      id: user.id,
      primaryWalletAddress: session.walletAddress,
    },
  };
}

export async function requireSessionCharacterAccess(
  request: Request,
  characterId: string,
): Promise<SessionActor> {
  const actor = await requireSession(request);
  const character = await prisma.character.findById(characterId);
  if (!character || character.userId !== actor.user.id) {
    throw new SessionForbiddenError('ERR_AUTH_CHARACTER_FORBIDDEN: character does not belong to the active session');
  }
  return actor;
}
