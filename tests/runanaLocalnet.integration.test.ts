import { createPrivateKey, randomBytes, sign as signBytes } from "node:crypto";

import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  VersionedTransaction,
  sendAndConfirmTransaction,
  type Commitment,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";

import {
  getCompactClassId,
} from "../lib/catalog/classes";
import {
  getLatestZoneRunTopology,
} from "../lib/combat/zoneRunTopologies";
import {
  accountCharacterIdHex,
  accountStateHashHex,
  fetchCharacterRootAccount,
  fetchCharacterSettlementBatchCursorAccount,
  fetchCharacterStatsAccount,
  fetchCharacterWorldProgressAccount,
  fetchCharacterZoneProgressPageAccount,
  fetchClassRegistryAccount,
  fetchEnemyArchetypeRegistryAccount,
  fetchProgramConfigAccount,
  fetchSeasonPolicyAccount,
  fetchZoneEnemySetAccount,
  fetchZoneRegistryAccount,
} from "../lib/solana/runanaAccounts";
import {
  buildInitializeClassRegistryInstruction,
  buildInitializeEnemyArchetypeRegistryInstruction,
  buildInitializeProgramConfigInstruction,
  buildInitializeSeasonPolicyInstruction,
  buildInitializeZoneEnemySetInstruction,
  buildInitializeZoneRegistryInstruction,
  buildUpdateZoneEnemySetInstruction,
} from "../lib/solana/runanaAdminInstructions";
import { buildPreparedVersionedTransaction } from "../lib/solana/playerOwnedV0Transactions";
import { buildCreateCharacterInstruction } from "../lib/solana/runanaCharacterInstructions";
import { buildCanonicalSettlementMessages } from "../lib/solana/runanaSettlementInstructions";
import { buildPreparedSettlementVersionedTransaction } from "../lib/solana/settlementTransactionAssembly";
import { loadSettlementInstructionAccountEnvelope } from "../lib/solana/runanaSettlementEnvelope";
import {
  createRunanaConnection,
  loadRunanaBootstrapAuthorities,
  loadRunanaTrustedServerSigner,
  resolveRunanaCommitment,
  resolveRunanaProgramId,
} from "../lib/solana/runanaClient";
import {
  RUNANA_CLUSTER_ID_LOCALNET,
  deriveClassRegistryPda,
  deriveEnemyArchetypeRegistryPda,
  deriveProgramConfigPda,
  deriveSeasonPolicyPda,
  deriveZoneEnemySetPda,
  deriveZoneRegistryPda,
} from "../lib/solana/runanaProgram";
import {
  computeCanonicalEndStateHashHex,
  computeSettlementBatchHashHex,
} from "../lib/solana/settlementCanonical";
import type { SettlementBatchPayloadV2 } from "../types/settlement";

jest.setTimeout(120_000);

const describeLocalnet =
  process.env.RUNANA_ENABLE_LOCALNET_TESTS === "1" ? describe : describe.skip;

interface TestBootstrapContext {
  connection: Connection;
  commitment: Commitment;
  programId: PublicKey;
  admin: Keypair;
  payer: Keypair;
  serverSigner: Keypair;
  seasonId: number;
  zoneId: number;
  enemyArchetypeId: number;
  expRewardBase: number;
  seasonStartTs: number;
  seasonEndTs: number;
  commitGraceEndTs: number;
}

function dedupeKeypairs(signers: Keypair[]): Keypair[] {
  const unique = new Map<string, Keypair>();
  signers.forEach((signer) => {
    unique.set(signer.publicKey.toBase58(), signer);
  });
  return [...unique.values()];
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signDetachedEd25519(message: Uint8Array, signer: Keypair): Uint8Array {
  const jwk: import("node:crypto").JsonWebKey = {
    kty: "OKP",
    crv: "Ed25519",
    d: base64Url(signer.secretKey.subarray(0, 32)),
    x: base64Url(signer.publicKey.toBytes()),
  };

  return new Uint8Array(
    signBytes(
      null,
      Buffer.from(message),
      createPrivateKey({ key: jwk, format: "jwk" }),
    ),
  );
}

function resolveOptionalBootstrapAuthorities(): {
  admin: Keypair;
  payer: Keypair;
} | null {
  try {
    const authorities = loadRunanaBootstrapAuthorities();
    return {
      admin: authorities.admin,
      payer: authorities.payer,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("ERR_MISSING_ADMIN_KEYPAIR_PATH")
    ) {
      return null;
    }
    throw error;
  }
}

function resolveOptionalServerSigner(): Keypair | null {
  try {
    return loadRunanaTrustedServerSigner().signer;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("ERR_MISSING_SERVER_SIGNER_KEYPAIR_PATH")
    ) {
      return null;
    }
    throw error;
  }
}

function randomFixtureIds() {
  const seed = randomBytes(4).readUInt32LE(0);
  return {
    seasonId: 1000 + (seed % 100_000),
    zoneId: 1 + ((seed >>> 8) % 200),
    enemyArchetypeId: 1 + ((seed >>> 16) % 60_000),
  };
}

async function airdropIfNeeded(
  connection: Connection,
  commitment: Commitment,
  recipient: PublicKey,
  minimumLamports = LAMPORTS_PER_SOL,
): Promise<void> {
  const balance = await connection.getBalance(recipient, commitment);
  if (balance >= minimumLamports) {
    return;
  }

  const signature = await connection.requestAirdrop(
    recipient,
    minimumLamports * 2,
  );
  const latestBlockhash = await connection.getLatestBlockhash(commitment);
  const confirmation = await connection.confirmTransaction(
    {
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    },
    commitment,
  );

  if (confirmation.value.err !== null) {
    throw new Error(
      `ERR_AIRDROP_FAILED: ${JSON.stringify(confirmation.value.err)}`,
    );
  }
}

async function sendAdminInstruction(args: {
  connection: Connection;
  commitment: Commitment;
  payer: Keypair;
  signers: Keypair[];
  instruction: TransactionInstruction;
}): Promise<string> {
  const transaction = new Transaction().add(args.instruction);
  transaction.feePayer = args.payer.publicKey;

  return sendAndConfirmTransaction(
    args.connection,
    transaction,
    dedupeKeypairs([args.payer, ...args.signers]),
    {
      commitment: args.commitment,
      preflightCommitment: args.commitment,
    },
  );
}

async function sendPreparedVersionedTransaction(args: {
  connection: Connection;
  commitment: Commitment;
  transaction: VersionedTransaction;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}): Promise<string> {
  const signature = await args.connection.sendRawTransaction(
    Buffer.from(args.transaction.serialize()),
    {
      preflightCommitment: args.commitment,
      skipPreflight: false,
      maxRetries: 3,
    },
  );

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const statuses = await args.connection.getSignatureStatuses([signature]);
    const status = statuses.value[0];

    if (status?.err !== null && status?.err !== undefined) {
      throw new Error(
        `ERR_TRANSACTION_CONFIRMATION_FAILED: ${JSON.stringify(status.err)}`,
      );
    }

    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    ) {
      return signature;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `ERR_TRANSACTION_CONFIRMATION_TIMEOUT: ${signature} was not confirmed`,
  );
}

async function waitForSlotAdvance(
  connection: Connection,
  priorSlot: number,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const currentSlot = await connection.getSlot("processed");
    if (currentSlot > priorSlot) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    "ERR_LOOKUP_TABLE_NOT_WARMED: address lookup table did not warm up on localnet",
  );
}

async function createSettlementLookupTable(args: {
  connection: Connection;
  payer: Keypair;
  authority: Keypair;
  addresses: PublicKey[];
}): Promise<AddressLookupTableAccount> {
  const currentSlot = await args.connection.getSlot("processed");
  const recentSlot = Math.max(currentSlot - 1, 0);
  const [createInstruction, lookupTableAddress] =
    AddressLookupTableProgram.createLookupTable({
      authority: args.authority.publicKey,
      payer: args.payer.publicKey,
      recentSlot,
    });

  await sendAdminInstruction({
    connection: args.connection,
    commitment: "processed",
    payer: args.payer,
    signers: [args.authority],
    instruction: createInstruction,
  });
  await sendAdminInstruction({
    connection: args.connection,
    commitment: "processed",
    payer: args.payer,
    signers: [args.authority],
    instruction: AddressLookupTableProgram.extendLookupTable({
      payer: args.payer.publicKey,
      authority: args.authority.publicKey,
      lookupTable: lookupTableAddress,
      addresses: args.addresses,
    }),
  });
  const extendSlot = await args.connection.getSlot("processed");
  await waitForSlotAdvance(args.connection, extendSlot);

  const lookupTable =
    await args.connection.getAddressLookupTable(lookupTableAddress);
  if (lookupTable.value === null) {
    throw new Error(
      `ERR_LOOKUP_TABLE_NOT_FOUND: lookup table ${lookupTableAddress.toBase58()} was not found after creation`,
    );
  }

  return lookupTable.value;
}

async function ensureProgramBootstrap(
  context: TestBootstrapContext,
): Promise<void> {
  const {
    connection,
    commitment,
    programId,
    admin,
    payer,
    serverSigner,
    seasonId,
    zoneId,
    enemyArchetypeId,
    expRewardBase,
    seasonStartTs,
    seasonEndTs,
    commitGraceEndTs,
  } = context;
  const topology = getLatestZoneRunTopology(zoneId);
  const compactSoldierClassId = getCompactClassId("soldier");

  const programConfigPubkey = deriveProgramConfigPda(programId);
  const existingProgramConfig = await connection.getAccountInfo(
    programConfigPubkey,
    commitment,
  );

  if (existingProgramConfig === null) {
    await sendAdminInstruction({
      connection,
      commitment,
      payer,
      signers: [admin],
      instruction: buildInitializeProgramConfigInstruction({
        payer: payer.publicKey,
        adminAuthority: admin.publicKey,
        trustedServerSigner: serverSigner.publicKey,
        settlementPaused: false,
        maxBattlesPerBatch: 8,
        maxHistogramEntriesPerBatch: 8,
        maxRunsPerBatch: 4,
        programId,
      }),
    });
  } else {
    const decoded = await fetchProgramConfigAccount(
      connection,
      programConfigPubkey,
      commitment,
    );
    if (!decoded.adminAuthority.equals(admin.publicKey)) {
      throw new Error(
        `ERR_PROGRAM_CONFIG_ADMIN_MISMATCH: localnet program config admin ${decoded.adminAuthority.toBase58()} does not match the test admin ${admin.publicKey.toBase58()}`,
      );
    }
    if (!decoded.trustedServerSigner.equals(serverSigner.publicKey)) {
      throw new Error(
        `ERR_PROGRAM_CONFIG_SERVER_SIGNER_MISMATCH: localnet trusted server signer ${decoded.trustedServerSigner.toBase58()} does not match the test signer ${serverSigner.publicKey.toBase58()}`,
      );
    }
    if (decoded.settlementPaused) {
      throw new Error(
        "ERR_PROGRAM_CONFIG_SETTLEMENT_PAUSED: localnet settlement must be unpaused for integration coverage",
      );
    }
  }

  const seasonPolicyPubkey = deriveSeasonPolicyPda(seasonId, programId);
  if (
    (await connection.getAccountInfo(seasonPolicyPubkey, commitment)) === null
  ) {
    await sendAdminInstruction({
      connection,
      commitment,
      payer,
      signers: [admin],
      instruction: buildInitializeSeasonPolicyInstruction({
        payer: payer.publicKey,
        adminAuthority: admin.publicKey,
        seasonId,
        seasonStartTs,
        seasonEndTs,
        commitGraceEndTs,
        programId,
      }),
    });
  }

  const zoneRegistryPubkey = deriveZoneRegistryPda(
    zoneId,
    topology.topologyVersion,
    programId,
  );
  if (
    (await connection.getAccountInfo(zoneRegistryPubkey, commitment)) === null
  ) {
    await sendAdminInstruction({
      connection,
      commitment,
      payer,
      signers: [admin],
      instruction: buildInitializeZoneRegistryInstruction({
        payer: payer.publicKey,
        adminAuthority: admin.publicKey,
        zoneId,
        topologyVersion: topology.topologyVersion,
        totalSubnodeCount: topology.totalSubnodeCount,
        topologyHash: topology.topologyHash,
        expMultiplierNum: 1,
        expMultiplierDen: 1,
        programId,
      }),
    });
  }

  const enemyArchetypePubkey = deriveEnemyArchetypeRegistryPda(
    enemyArchetypeId,
    programId,
  );
  if (
    (await connection.getAccountInfo(enemyArchetypePubkey, commitment)) === null
  ) {
    await sendAdminInstruction({
      connection,
      commitment,
      payer,
      signers: [admin],
      instruction: buildInitializeEnemyArchetypeRegistryInstruction({
        payer: payer.publicKey,
        adminAuthority: admin.publicKey,
        enemyArchetypeId,
        expRewardBase,
        programId,
      }),
    });
  }

  const classRegistryPubkey = deriveClassRegistryPda(
    compactSoldierClassId,
    programId,
  );
  if (
    (await connection.getAccountInfo(classRegistryPubkey, commitment)) === null
  ) {
    await sendAdminInstruction({
      connection,
      commitment,
      payer,
      signers: [admin],
      instruction: buildInitializeClassRegistryInstruction({
        payer: payer.publicKey,
        adminAuthority: admin.publicKey,
        classId: compactSoldierClassId,
        enabled: true,
        programId,
      }),
    });
  }

  const zoneEnemySetPubkey = deriveZoneEnemySetPda(
    zoneId,
    topology.topologyVersion,
    programId,
  );
  const zoneEnemySetInfo = await connection.getAccountInfo(
    zoneEnemySetPubkey,
    commitment,
  );
  if (zoneEnemySetInfo === null) {
    await sendAdminInstruction({
      connection,
      commitment,
      payer,
      signers: [admin],
      instruction: buildInitializeZoneEnemySetInstruction({
        payer: payer.publicKey,
        adminAuthority: admin.publicKey,
        zoneId,
        topologyVersion: topology.topologyVersion,
        enemyRules: [{ enemyArchetypeId, maxPerRun: topology.totalSubnodeCount }],
        programId,
      }),
    });
  } else {
    const decoded = await fetchZoneEnemySetAccount(
      connection,
      zoneEnemySetPubkey,
      commitment,
    );
    if (
      decoded.enemyRules.length !== 1 ||
      decoded.enemyRules[0]?.enemyArchetypeId !== enemyArchetypeId ||
      decoded.enemyRules[0]?.maxPerRun !== topology.totalSubnodeCount
    ) {
      await sendAdminInstruction({
        connection,
        commitment,
        payer,
        signers: [admin],
        instruction: buildUpdateZoneEnemySetInstruction({
          adminAuthority: admin.publicKey,
          zoneId,
          topologyVersion: topology.topologyVersion,
          enemyRules: [{ enemyArchetypeId, maxPerRun: topology.totalSubnodeCount }],
          programId,
        }),
      });
    }
  }
}

describeLocalnet("runana localnet integration", () => {
  let context: TestBootstrapContext;

  beforeAll(async () => {
    const connection = createRunanaConnection();
    const commitment = resolveRunanaCommitment();
    const programId = resolveRunanaProgramId();
    const configuredAuthorities = resolveOptionalBootstrapAuthorities();
    const configuredServerSigner = resolveOptionalServerSigner();
    const ids = randomFixtureIds();
    const now = Math.floor(Date.now() / 1000);

    const admin = configuredAuthorities?.admin ?? Keypair.generate();
    const payer = configuredAuthorities?.payer ?? admin;
    const serverSigner = configuredServerSigner ?? Keypair.generate();

    const programInfo = await connection.getAccountInfo(programId, commitment);
    if (programInfo === null || !programInfo.executable) {
      throw new Error(
        `ERR_PROGRAM_NOT_DEPLOYED: program ${programId.toBase58()} is not deployed on ${connection.rpcEndpoint}`,
      );
    }

    await airdropIfNeeded(connection, commitment, payer.publicKey);

    context = {
      connection,
      commitment,
      programId,
      admin,
      payer,
      serverSigner,
      seasonId: ids.seasonId,
      zoneId: ids.zoneId,
      enemyArchetypeId: ids.enemyArchetypeId,
      expRewardBase: 25,
      seasonStartTs: now - 120,
      seasonEndTs: now + 3_600,
      commitGraceEndTs: now + 7_200,
    };

    await ensureProgramBootstrap(context);
  });

  afterAll(async () => {
    const maybeRpcWebSocket = (
      context.connection as Connection & {
        _rpcWebSocket?: { close: () => void };
      }
    )._rpcWebSocket;
    maybeRpcWebSocket?.close();
  });

  it("bootstraps admin state with backend instructions on localnet", async () => {
    const topology = getLatestZoneRunTopology(context.zoneId);
    const programConfig = await fetchProgramConfigAccount(
      context.connection,
      deriveProgramConfigPda(context.programId),
      context.commitment,
    );
    const seasonPolicy = await fetchSeasonPolicyAccount(
      context.connection,
      deriveSeasonPolicyPda(context.seasonId, context.programId),
      context.commitment,
    );
    const zoneRegistry = await fetchZoneRegistryAccount(
      context.connection,
      deriveZoneRegistryPda(
        context.zoneId,
        topology.topologyVersion,
        context.programId,
      ),
      context.commitment,
    );
    const zoneEnemySet = await fetchZoneEnemySetAccount(
      context.connection,
      deriveZoneEnemySetPda(
        context.zoneId,
        topology.topologyVersion,
        context.programId,
      ),
      context.commitment,
    );
    const classRegistry = await fetchClassRegistryAccount(
      context.connection,
      deriveClassRegistryPda(getCompactClassId("soldier"), context.programId),
      context.commitment,
    );
    const enemyArchetype = await fetchEnemyArchetypeRegistryAccount(
      context.connection,
      deriveEnemyArchetypeRegistryPda(
        context.enemyArchetypeId,
        context.programId,
      ),
      context.commitment,
    );

    expect(programConfig.adminAuthority.toBase58()).toBe(
      context.admin.publicKey.toBase58(),
    );
    expect(programConfig.trustedServerSigner.toBase58()).toBe(
      context.serverSigner.publicKey.toBase58(),
    );
    expect(programConfig.settlementPaused).toBe(false);
    expect(programConfig.maxRunsPerBatch).toBe(4);
    expect(seasonPolicy.seasonId).toBe(context.seasonId);
    expect(Number(seasonPolicy.seasonStartTs)).toBe(context.seasonStartTs);
    expect(Number(seasonPolicy.seasonEndTs)).toBe(context.seasonEndTs);
    expect(Number(seasonPolicy.commitGraceEndTs)).toBe(
      context.commitGraceEndTs,
    );
    expect(zoneRegistry.zoneId).toBe(context.zoneId);
    expect(zoneRegistry.topologyVersion).toBe(topology.topologyVersion);
    expect(zoneRegistry.totalSubnodeCount).toBe(topology.totalSubnodeCount);
    expect(zoneRegistry.topologyHash).toBe(topology.topologyHash);
    expect(zoneRegistry.expMultiplierNum).toBe(1);
    expect(zoneRegistry.expMultiplierDen).toBe(1);
    expect(zoneEnemySet.enemyRules).toEqual([
      {
        enemyArchetypeId: context.enemyArchetypeId,
        maxPerRun: topology.totalSubnodeCount,
      },
    ]);
    expect(classRegistry.classId).toBe(getCompactClassId("soldier"));
    expect(classRegistry.enabled).toBe(true);
    expect(enemyArchetype.expRewardBase).toBe(context.expRewardBase);
  });

  it("creates a character and simulates a settlement batch with backend transaction assembly on localnet", async () => {
    const player = Keypair.generate();
    await airdropIfNeeded(
      context.connection,
      context.commitment,
      player.publicKey,
    );

    const characterIdHex = randomBytes(16).toString("hex");
    const createCharacter = buildCreateCharacterInstruction({
      payer: player.publicKey,
      authority: player.publicKey,
      seasonId: context.seasonId,
      characterIdHex,
      initialUnlockedZoneId: context.zoneId,
      classId: "soldier",
      name: "Local Runner",
      programId: context.programId,
    });
    const preparedCreate = await buildPreparedVersionedTransaction({
      connection: context.connection,
      feePayer: player.publicKey,
      instructions: [createCharacter.instruction],
      commitment: context.commitment,
    });
    const createTransaction = VersionedTransaction.deserialize(
      Buffer.from(preparedCreate.serializedTransactionBase64, "base64"),
    );
    createTransaction.sign([player]);

    await sendPreparedVersionedTransaction({
      connection: context.connection,
      commitment: context.commitment,
      transaction: createTransaction,
      recentBlockhash: preparedCreate.recentBlockhash,
      lastValidBlockHeight: preparedCreate.lastValidBlockHeight,
    });

    const characterRoot = await fetchCharacterRootAccount(
      context.connection,
      createCharacter.characterRoot,
      context.commitment,
    );
    const characterStats = await fetchCharacterStatsAccount(
      context.connection,
      createCharacter.characterStats,
      context.commitment,
    );
    const characterWorldProgress = await fetchCharacterWorldProgressAccount(
      context.connection,
      createCharacter.characterWorldProgress,
      context.commitment,
    );
    const characterZoneProgressPage =
      await fetchCharacterZoneProgressPageAccount(
        context.connection,
        createCharacter.characterZoneProgressPage,
        context.commitment,
      );
    const initialCursor = await fetchCharacterSettlementBatchCursorAccount(
      context.connection,
      createCharacter.characterBatchCursor,
      context.commitment,
    );

    expect(characterRoot.authority.toBase58()).toBe(
      player.publicKey.toBase58(),
    );
    expect(accountCharacterIdHex(characterRoot.characterId)).toBe(
      characterIdHex,
    );
    expect(characterStats.level).toBe(1);
    expect(Number(characterStats.totalExp)).toBe(0);
    expect(characterWorldProgress.highestUnlockedZoneId).toBe(context.zoneId);
    expect(characterWorldProgress.highestClearedZoneId).toBe(0);
    expect(characterZoneProgressPage.pageIndex).toBe(
      Math.floor(context.zoneId / 256),
    );
    expect(characterZoneProgressPage.zoneStates[context.zoneId % 256]).toBe(1);
    expect(Number(initialCursor.lastCommittedEndNonce)).toBe(0);
    expect(Number(initialCursor.lastCommittedBatchId)).toBe(0);
    expect(Number(characterRoot.characterCreationTs)).toBeGreaterThanOrEqual(
      context.seasonStartTs,
    );
    expect(Number(characterRoot.characterCreationTs)).toBeLessThanOrEqual(
      context.seasonEndTs,
    );
    expect(Number(initialCursor.lastCommittedBattleTs)).toBe(
      context.seasonStartTs,
    );
    expect(initialCursor.lastCommittedSeasonId).toBe(context.seasonId);
    expect(
      accountStateHashHex(initialCursor.lastCommittedStateHash),
    ).toHaveLength(64);

    const onChainCreationTs = Number(characterRoot.characterCreationTs);
    const settlementStartStateHash = accountStateHashHex(
      initialCursor.lastCommittedStateHash,
    );
    const settlementPreimage = {
      characterId: characterIdHex,
      batchId: 1,
      startNonce: 1,
      endNonce: 1,
      battleCount: 1,
      startStateHash: settlementStartStateHash,
      zoneProgressDelta: [],
      encounterHistogram: [
        {
          zoneId: context.zoneId,
          enemyArchetypeId: context.enemyArchetypeId,
          count: 1,
        },
      ],
      firstBattleTs: onChainCreationTs + 1,
      lastBattleTs: onChainCreationTs + 1,
      seasonId: context.seasonId,
      schemaVersion: 2 as const,
      signatureScheme: 0 as const,
    };
    const settlementPayload: SettlementBatchPayloadV2 = {
      ...settlementPreimage,
      endStateHash: computeCanonicalEndStateHashHex({
        ...settlementPreimage,
        characterId: Buffer.from(settlementPreimage.characterId, "hex"),
        startStateHash: Buffer.from(settlementPreimage.startStateHash, "hex"),
      }),
      batchHash: "",
    };
    settlementPayload.batchHash = computeSettlementBatchHashHex({
      ...settlementPreimage,
      characterId: Buffer.from(settlementPreimage.characterId, "hex"),
      startStateHash: Buffer.from(settlementPreimage.startStateHash, "hex"),
      endStateHash: Buffer.from(settlementPayload.endStateHash, "hex"),
    });

    const settlementEnvelope = await loadSettlementInstructionAccountEnvelope({
      reader: context.connection,
      payload: settlementPayload,
      playerAuthority: player.publicKey,
      characterRootPubkey: createCharacter.characterRoot,
      commitment: context.commitment,
      programId: context.programId,
    });
    const settlementMessages = buildCanonicalSettlementMessages({
      payload: settlementPayload,
      playerAuthority: player.publicKey,
      characterRoot: createCharacter.characterRoot,
      programId: context.programId,
      clusterId: RUNANA_CLUSTER_ID_LOCALNET,
    });
    const playerAuthorizationSignature = signDetachedEd25519(
      settlementMessages.playerAuthorizationMessage,
      player,
    );
    const lookupTable = await createSettlementLookupTable({
      connection: context.connection,
      payer: player,
      authority: player,
      addresses: settlementEnvelope.instructionAccounts
        .slice(1)
        .map((account) => account.pubkey),
    });
    const preparedSettlement =
      await buildPreparedSettlementVersionedTransaction({
        connection: context.connection,
        envelope: settlementEnvelope,
        payload: settlementPayload,
        feePayer: player.publicKey,
        playerAuthorizationSignature,
        serverSigner: context.serverSigner,
        addressLookupTableAccounts: [lookupTable],
        commitment: context.commitment,
        clusterId: RUNANA_CLUSTER_ID_LOCALNET,
      });
    const settlementTransaction = VersionedTransaction.deserialize(
      Buffer.from(preparedSettlement.serializedTransactionBase64, "base64"),
    );
    settlementTransaction.sign([player]);
    const settlementSimulation = await context.connection.simulateTransaction(
      settlementTransaction,
      {
        commitment: context.commitment,
      },
    );

    expect(preparedSettlement.serverSignerPubkey).toBe(
      context.serverSigner.publicKey.toBase58(),
    );
    expect(settlementSimulation.value.err).toBeNull();
    expect(settlementSimulation.value.logs?.join("\n")).toContain(
      "Program FeZgz7XaSXg9uEpC4Lh3fPSYpFmYWdUQ1GNyWX8Heskg success",
    );
  });
});
