import { NextResponse } from 'next/server';

import { prisma } from '../../../../lib/prisma';

export async function POST() {
  const user = await prisma.user.create();
  return NextResponse.json({ userId: user.id }, { status: 201 });
}
