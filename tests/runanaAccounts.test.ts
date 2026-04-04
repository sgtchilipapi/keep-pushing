import { createHash } from 'node:crypto';

import { Keypair } from '@solana/web3.js';

import { decodeZoneEnemySetAccount } from '../lib/solana/runanaAccounts';
import { RUNANA_PROGRAM_ID } from '../lib/solana/runanaProgram';

function discriminator(accountName: string): Buffer {
  return createHash('sha256')
    .update(`account:${accountName}`)
    .digest()
    .subarray(0, 8);
}

function u8(value: number): Buffer {
  return Buffer.from([value]);
}

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

describe('runanaAccounts', () => {
  it('decodes zone enemy sets with zero-padded account capacity from localnet', () => {
    const pubkey = Keypair.generate().publicKey;
    const accountInfo = {
      data: Buffer.concat([
        discriminator('ZoneEnemySetAccount'),
        u8(1),
        u8(247),
        u16(7),
        u32(2),
        u16(11),
        u16(22),
        Buffer.alloc(8),
      ]),
      executable: false,
      lamports: 1,
      owner: RUNANA_PROGRAM_ID,
      rentEpoch: 0,
    };

    const decoded = decodeZoneEnemySetAccount(pubkey, accountInfo);

    expect(decoded.zoneId).toBe(7);
    expect(decoded.allowedEnemyArchetypeIds).toEqual([11, 22]);
  });
});
