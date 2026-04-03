import { type AccountInfo, type Commitment, type Connection, PublicKey } from '@solana/web3.js';

import { computeAnchorAccountDiscriminator } from './runanaProgram';

export interface SolanaAccountReader {
  getAccountInfo(
    pubkey: PublicKey,
    commitment?: Commitment,
  ): Promise<AccountInfo<Buffer> | null>;
  getMultipleAccountsInfo(
    pubkeys: PublicKey[],
    commitment?: Commitment,
  ): Promise<Array<AccountInfo<Buffer> | null>>;
}

export interface DecodedRunanaAccountBase {
  pubkey: PublicKey;
  owner: PublicKey;
  lamports: number;
}

export interface ProgramConfigAccountState extends DecodedRunanaAccountBase {
  version: number;
  bump: number;
  adminAuthority: PublicKey;
  trustedServerSigner: PublicKey;
  settlementPaused: boolean;
  maxBattlesPerBatch: number;
  maxHistogramEntriesPerBatch: number;
  updatedAtSlot: bigint;
}

export interface CharacterRootAccountState extends DecodedRunanaAccountBase {
  version: number;
  bump: number;
  authority: PublicKey;
  characterId: Buffer;
  characterCreationTs: bigint;
}

export interface CharacterStatsAccountState extends DecodedRunanaAccountBase {
  version: number;
  bump: number;
  characterRoot: PublicKey;
  level: number;
  totalExp: bigint;
}

export interface CharacterWorldProgressAccountState extends DecodedRunanaAccountBase {
  version: number;
  bump: number;
  characterRoot: PublicKey;
  highestUnlockedZoneId: number;
  highestClearedZoneId: number;
}

export interface CharacterZoneProgressPageAccountState extends DecodedRunanaAccountBase {
  version: number;
  bump: number;
  characterRoot: PublicKey;
  pageIndex: number;
  zoneStates: number[];
}

export interface SeasonPolicyAccountState extends DecodedRunanaAccountBase {
  version: number;
  bump: number;
  seasonId: number;
  seasonStartTs: bigint;
  seasonEndTs: bigint;
  commitGraceEndTs: bigint;
  updatedAtSlot: bigint;
}

export interface CharacterSettlementBatchCursorAccountState extends DecodedRunanaAccountBase {
  version: number;
  bump: number;
  characterRoot: PublicKey;
  lastCommittedEndNonce: bigint;
  lastCommittedStateHash: Buffer;
  lastCommittedBatchId: bigint;
  lastCommittedBattleTs: bigint;
  lastCommittedSeasonId: number;
  updatedAtSlot: bigint;
}

export interface ZoneRegistryAccountState extends DecodedRunanaAccountBase {
  version: number;
  bump: number;
  zoneId: number;
  expMultiplierNum: number;
  expMultiplierDen: number;
}

export interface ZoneEnemySetAccountState extends DecodedRunanaAccountBase {
  version: number;
  bump: number;
  zoneId: number;
  allowedEnemyArchetypeIds: number[];
}

export interface EnemyArchetypeRegistryAccountState extends DecodedRunanaAccountBase {
  version: number;
  bump: number;
  enemyArchetypeId: number;
  expRewardBase: number;
}

type AnyRunanaDecodedAccount =
  | ProgramConfigAccountState
  | CharacterRootAccountState
  | CharacterStatsAccountState
  | CharacterWorldProgressAccountState
  | CharacterZoneProgressPageAccountState
  | SeasonPolicyAccountState
  | CharacterSettlementBatchCursorAccountState
  | ZoneRegistryAccountState
  | ZoneEnemySetAccountState
  | EnemyArchetypeRegistryAccountState;

class AccountDataReader {
  private readonly data: Buffer;
  private offset = 0;

  constructor(data: Buffer) {
    this.data = data;
  }

  readDiscriminator(accountName: string): void {
    const expected = computeAnchorAccountDiscriminator(accountName);
    const actual = this.readBytes(8);
    if (!actual.equals(expected)) {
      throw new Error(`ERR_ACCOUNT_DISCRIMINATOR_MISMATCH: ${accountName} discriminator mismatch`);
    }
  }

  readU8(): number {
    const value = this.data.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  readBool(): boolean {
    return this.readU8() !== 0;
  }

  readU16(): number {
    const value = this.data.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  readU32(): number {
    const value = this.data.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  readU64(): bigint {
    const value = this.data.readBigUInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  readPubkey(): PublicKey {
    return new PublicKey(this.readBytes(32));
  }

  readBytes(length: number): Buffer {
    const value = this.data.subarray(this.offset, this.offset + length);
    if (value.length !== length) {
      throw new Error('ERR_ACCOUNT_DATA_TRUNCATED: account data was shorter than expected');
    }
    this.offset += length;
    return value;
  }

  readVecU16(): number[] {
    const length = this.readU32();
    const values: number[] = [];
    for (let index = 0; index < length; index += 1) {
      values.push(this.readU16());
    }
    return values;
  }

  assertFullyRead(accountName: string): void {
    if (this.offset !== this.data.length) {
      throw new Error(`ERR_ACCOUNT_DATA_REMAINDER: ${accountName} decoder left unread bytes`);
    }
  }
}

function decodeAccountBase(pubkey: PublicKey, accountInfo: AccountInfo<Buffer>): DecodedRunanaAccountBase {
  return {
    pubkey,
    owner: accountInfo.owner,
    lamports: accountInfo.lamports,
  };
}

export function decodeProgramConfigAccount(
  pubkey: PublicKey,
  accountInfo: AccountInfo<Buffer>,
): ProgramConfigAccountState {
  const reader = new AccountDataReader(accountInfo.data);
  reader.readDiscriminator('ProgramConfigAccount');

  const decoded: ProgramConfigAccountState = {
    ...decodeAccountBase(pubkey, accountInfo),
    version: reader.readU8(),
    bump: reader.readU8(),
    adminAuthority: reader.readPubkey(),
    trustedServerSigner: reader.readPubkey(),
    settlementPaused: reader.readBool(),
    maxBattlesPerBatch: reader.readU16(),
    maxHistogramEntriesPerBatch: reader.readU16(),
    updatedAtSlot: reader.readU64(),
  };

  reader.assertFullyRead('ProgramConfigAccount');
  return decoded;
}

export function decodeCharacterRootAccount(
  pubkey: PublicKey,
  accountInfo: AccountInfo<Buffer>,
): CharacterRootAccountState {
  const reader = new AccountDataReader(accountInfo.data);
  reader.readDiscriminator('CharacterRootAccount');

  const decoded: CharacterRootAccountState = {
    ...decodeAccountBase(pubkey, accountInfo),
    version: reader.readU8(),
    bump: reader.readU8(),
    authority: reader.readPubkey(),
    characterId: reader.readBytes(16),
    characterCreationTs: reader.readU64(),
  };

  reader.assertFullyRead('CharacterRootAccount');
  return decoded;
}

export function decodeCharacterStatsAccount(
  pubkey: PublicKey,
  accountInfo: AccountInfo<Buffer>,
): CharacterStatsAccountState {
  const reader = new AccountDataReader(accountInfo.data);
  reader.readDiscriminator('CharacterStatsAccount');

  const decoded: CharacterStatsAccountState = {
    ...decodeAccountBase(pubkey, accountInfo),
    version: reader.readU8(),
    bump: reader.readU8(),
    characterRoot: reader.readPubkey(),
    level: reader.readU16(),
    totalExp: reader.readU64(),
  };

  reader.assertFullyRead('CharacterStatsAccount');
  return decoded;
}

export function decodeCharacterWorldProgressAccount(
  pubkey: PublicKey,
  accountInfo: AccountInfo<Buffer>,
): CharacterWorldProgressAccountState {
  const reader = new AccountDataReader(accountInfo.data);
  reader.readDiscriminator('CharacterWorldProgressAccount');

  const decoded: CharacterWorldProgressAccountState = {
    ...decodeAccountBase(pubkey, accountInfo),
    version: reader.readU8(),
    bump: reader.readU8(),
    characterRoot: reader.readPubkey(),
    highestUnlockedZoneId: reader.readU16(),
    highestClearedZoneId: reader.readU16(),
  };

  reader.assertFullyRead('CharacterWorldProgressAccount');
  return decoded;
}

export function decodeCharacterZoneProgressPageAccount(
  pubkey: PublicKey,
  accountInfo: AccountInfo<Buffer>,
): CharacterZoneProgressPageAccountState {
  const reader = new AccountDataReader(accountInfo.data);
  reader.readDiscriminator('CharacterZoneProgressPageAccount');

  const decoded: CharacterZoneProgressPageAccountState = {
    ...decodeAccountBase(pubkey, accountInfo),
    version: reader.readU8(),
    bump: reader.readU8(),
    characterRoot: reader.readPubkey(),
    pageIndex: reader.readU16(),
    zoneStates: [...reader.readBytes(256)],
  };

  reader.assertFullyRead('CharacterZoneProgressPageAccount');
  return decoded;
}

export function decodeSeasonPolicyAccount(
  pubkey: PublicKey,
  accountInfo: AccountInfo<Buffer>,
): SeasonPolicyAccountState {
  const reader = new AccountDataReader(accountInfo.data);
  reader.readDiscriminator('SeasonPolicyAccount');

  const decoded: SeasonPolicyAccountState = {
    ...decodeAccountBase(pubkey, accountInfo),
    version: reader.readU8(),
    bump: reader.readU8(),
    seasonId: reader.readU32(),
    seasonStartTs: reader.readU64(),
    seasonEndTs: reader.readU64(),
    commitGraceEndTs: reader.readU64(),
    updatedAtSlot: reader.readU64(),
  };

  reader.assertFullyRead('SeasonPolicyAccount');
  return decoded;
}

export function decodeCharacterSettlementBatchCursorAccount(
  pubkey: PublicKey,
  accountInfo: AccountInfo<Buffer>,
): CharacterSettlementBatchCursorAccountState {
  const reader = new AccountDataReader(accountInfo.data);
  reader.readDiscriminator('CharacterSettlementBatchCursorAccount');

  const decoded: CharacterSettlementBatchCursorAccountState = {
    ...decodeAccountBase(pubkey, accountInfo),
    version: reader.readU8(),
    bump: reader.readU8(),
    characterRoot: reader.readPubkey(),
    lastCommittedEndNonce: reader.readU64(),
    lastCommittedStateHash: reader.readBytes(32),
    lastCommittedBatchId: reader.readU64(),
    lastCommittedBattleTs: reader.readU64(),
    lastCommittedSeasonId: reader.readU32(),
    updatedAtSlot: reader.readU64(),
  };

  reader.assertFullyRead('CharacterSettlementBatchCursorAccount');
  return decoded;
}

export function decodeZoneRegistryAccount(
  pubkey: PublicKey,
  accountInfo: AccountInfo<Buffer>,
): ZoneRegistryAccountState {
  const reader = new AccountDataReader(accountInfo.data);
  reader.readDiscriminator('ZoneRegistryAccount');

  const decoded: ZoneRegistryAccountState = {
    ...decodeAccountBase(pubkey, accountInfo),
    version: reader.readU8(),
    bump: reader.readU8(),
    zoneId: reader.readU16(),
    expMultiplierNum: reader.readU16(),
    expMultiplierDen: reader.readU16(),
  };

  reader.assertFullyRead('ZoneRegistryAccount');
  return decoded;
}

export function decodeZoneEnemySetAccount(
  pubkey: PublicKey,
  accountInfo: AccountInfo<Buffer>,
): ZoneEnemySetAccountState {
  const reader = new AccountDataReader(accountInfo.data);
  reader.readDiscriminator('ZoneEnemySetAccount');

  const decoded: ZoneEnemySetAccountState = {
    ...decodeAccountBase(pubkey, accountInfo),
    version: reader.readU8(),
    bump: reader.readU8(),
    zoneId: reader.readU16(),
    allowedEnemyArchetypeIds: reader.readVecU16(),
  };

  reader.assertFullyRead('ZoneEnemySetAccount');
  return decoded;
}

export function decodeEnemyArchetypeRegistryAccount(
  pubkey: PublicKey,
  accountInfo: AccountInfo<Buffer>,
): EnemyArchetypeRegistryAccountState {
  const reader = new AccountDataReader(accountInfo.data);
  reader.readDiscriminator('EnemyArchetypeRegistryAccount');

  const decoded: EnemyArchetypeRegistryAccountState = {
    ...decodeAccountBase(pubkey, accountInfo),
    version: reader.readU8(),
    bump: reader.readU8(),
    enemyArchetypeId: reader.readU16(),
    expRewardBase: reader.readU32(),
  };

  reader.assertFullyRead('EnemyArchetypeRegistryAccount');
  return decoded;
}

type Decoder<TAccount extends AnyRunanaDecodedAccount> = (
  pubkey: PublicKey,
  accountInfo: AccountInfo<Buffer>,
) => TAccount;

async function fetchRequiredDecodedAccount<TAccount extends AnyRunanaDecodedAccount>(
  reader: SolanaAccountReader | Connection,
  pubkey: PublicKey,
  accountName: string,
  decoder: Decoder<TAccount>,
  commitment?: Commitment,
): Promise<TAccount> {
  const accountInfo = await reader.getAccountInfo(pubkey, commitment);
  if (accountInfo === null) {
    throw new Error(`ERR_MISSING_${accountName.toUpperCase()}: required account ${pubkey.toBase58()} was not found`);
  }

  return decoder(pubkey, accountInfo);
}

export async function fetchProgramConfigAccount(
  reader: SolanaAccountReader | Connection,
  pubkey: PublicKey,
  commitment?: Commitment,
): Promise<ProgramConfigAccountState> {
  return fetchRequiredDecodedAccount(reader, pubkey, 'ProgramConfigAccount', decodeProgramConfigAccount, commitment);
}

export async function fetchCharacterRootAccount(
  reader: SolanaAccountReader | Connection,
  pubkey: PublicKey,
  commitment?: Commitment,
): Promise<CharacterRootAccountState> {
  return fetchRequiredDecodedAccount(reader, pubkey, 'CharacterRootAccount', decodeCharacterRootAccount, commitment);
}

export async function fetchCharacterStatsAccount(
  reader: SolanaAccountReader | Connection,
  pubkey: PublicKey,
  commitment?: Commitment,
): Promise<CharacterStatsAccountState> {
  return fetchRequiredDecodedAccount(reader, pubkey, 'CharacterStatsAccount', decodeCharacterStatsAccount, commitment);
}

export async function fetchCharacterWorldProgressAccount(
  reader: SolanaAccountReader | Connection,
  pubkey: PublicKey,
  commitment?: Commitment,
): Promise<CharacterWorldProgressAccountState> {
  return fetchRequiredDecodedAccount(
    reader,
    pubkey,
    'CharacterWorldProgressAccount',
    decodeCharacterWorldProgressAccount,
    commitment,
  );
}

export async function fetchCharacterZoneProgressPageAccount(
  reader: SolanaAccountReader | Connection,
  pubkey: PublicKey,
  commitment?: Commitment,
): Promise<CharacterZoneProgressPageAccountState> {
  return fetchRequiredDecodedAccount(
    reader,
    pubkey,
    'CharacterZoneProgressPageAccount',
    decodeCharacterZoneProgressPageAccount,
    commitment,
  );
}

export async function fetchSeasonPolicyAccount(
  reader: SolanaAccountReader | Connection,
  pubkey: PublicKey,
  commitment?: Commitment,
): Promise<SeasonPolicyAccountState> {
  return fetchRequiredDecodedAccount(reader, pubkey, 'SeasonPolicyAccount', decodeSeasonPolicyAccount, commitment);
}

export async function fetchCharacterSettlementBatchCursorAccount(
  reader: SolanaAccountReader | Connection,
  pubkey: PublicKey,
  commitment?: Commitment,
): Promise<CharacterSettlementBatchCursorAccountState> {
  return fetchRequiredDecodedAccount(
    reader,
    pubkey,
    'CharacterSettlementBatchCursorAccount',
    decodeCharacterSettlementBatchCursorAccount,
    commitment,
  );
}

export async function fetchZoneRegistryAccount(
  reader: SolanaAccountReader | Connection,
  pubkey: PublicKey,
  commitment?: Commitment,
): Promise<ZoneRegistryAccountState> {
  return fetchRequiredDecodedAccount(reader, pubkey, 'ZoneRegistryAccount', decodeZoneRegistryAccount, commitment);
}

export async function fetchZoneEnemySetAccount(
  reader: SolanaAccountReader | Connection,
  pubkey: PublicKey,
  commitment?: Commitment,
): Promise<ZoneEnemySetAccountState> {
  return fetchRequiredDecodedAccount(reader, pubkey, 'ZoneEnemySetAccount', decodeZoneEnemySetAccount, commitment);
}

export async function fetchEnemyArchetypeRegistryAccount(
  reader: SolanaAccountReader | Connection,
  pubkey: PublicKey,
  commitment?: Commitment,
): Promise<EnemyArchetypeRegistryAccountState> {
  return fetchRequiredDecodedAccount(
    reader,
    pubkey,
    'EnemyArchetypeRegistryAccount',
    decodeEnemyArchetypeRegistryAccount,
    commitment,
  );
}

export async function fetchDecodedAccounts(
  reader: SolanaAccountReader | Connection,
  requests: Array<{
    pubkey: PublicKey;
    accountName: string;
    decoder: Decoder<AnyRunanaDecodedAccount>;
  }>,
  commitment?: Commitment,
): Promise<AnyRunanaDecodedAccount[]> {
  const accountInfos = await reader.getMultipleAccountsInfo(
    requests.map((request) => request.pubkey),
    commitment,
  );

  return requests.map((request, index) => {
    const accountInfo = accountInfos[index];
    if (accountInfo === null) {
      throw new Error(
        `ERR_MISSING_${request.accountName.toUpperCase()}: required account ${request.pubkey.toBase58()} was not found`,
      );
    }

    return request.decoder(request.pubkey, accountInfo);
  });
}

export function accountStateHashHex(stateHash: Buffer): string {
  return stateHash.toString('hex');
}

export function accountCharacterIdHex(characterId: Buffer): string {
  return characterId.toString('hex');
}
