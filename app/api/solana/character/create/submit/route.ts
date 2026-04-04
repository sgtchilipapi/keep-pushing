import { NextResponse } from 'next/server';

import {
  submitSolanaCharacterCreation,
  type SubmitSolanaCharacterCreationInput,
} from '../../../../../../lib/solana/characterCreation';

function statusForError(message: string): number {
  if (
    message.startsWith('ERR_INVALID_') ||
    message.startsWith('ERR_EMPTY_') ||
    message.startsWith('ERR_SIGNED_') ||
    message.startsWith('ERR_CHARACTER_SUBMISSION_STATE')
  ) {
    return 400;
  }

  if (message.startsWith('ERR_CHARACTER_NOT_FOUND')) {
    return 404;
  }

  if (
    message.startsWith('ERR_CHARACTER_ALREADY_CONFIRMED') ||
    message.startsWith('ERR_CHARACTER_AUTHORITY_MISMATCH') ||
    message.startsWith('ERR_CHARACTER_CHAIN_ID_MISMATCH') ||
    message.startsWith('ERR_CHARACTER_ROOT_MISMATCH')
  ) {
    return 409;
  }

  return 500;
}

export async function POST(request: Request) {
  let body: Partial<SubmitSolanaCharacterCreationInput>;

  try {
    body = (await request.json()) as Partial<SubmitSolanaCharacterCreationInput>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (body.prepared === undefined || body.prepared === null) {
    return NextResponse.json({ error: 'prepared is required.' }, { status: 400 });
  }

  try {
    const result = await submitSolanaCharacterCreation({
      prepared: body.prepared as SubmitSolanaCharacterCreationInput['prepared'],
      signedMessageBase64: typeof body.signedMessageBase64 === 'string' ? body.signedMessageBase64 : '',
      signedTransactionBase64:
        typeof body.signedTransactionBase64 === 'string' ? body.signedTransactionBase64 : '',
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to submit Solana character creation.';
    return NextResponse.json({ error: message }, { status: statusForError(message) });
  }
}
