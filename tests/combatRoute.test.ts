import { POST } from '../app/api/combat/route';

function buildPayload(overrides: Record<string, unknown> = {}) {
  return {
    seed: 123,
    playerInitial: {
      entityId: '101',
      hp: 2000,
      hpMax: 2000,
      atk: 160,
      def: 120,
      spd: 110,
      accuracyBP: 9000,
      evadeBP: 1000,
      activeSkillIds: ['1001', '1002']
    },
    enemyInitial: {
      entityId: '202',
      hp: 1900,
      hpMax: 1900,
      atk: 150,
      def: 115,
      spd: 105,
      accuracyBP: 8800,
      evadeBP: 1100,
      activeSkillIds: ['1001', '1002']
    },
    ...overrides
  };
}

async function postCombat(body: unknown): Promise<Response> {
  const request = new Request('http://localhost/api/combat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

  return POST(request);
}

describe('POST /api/combat', () => {
  it('accepts canonical payload and returns simulation output', async () => {
    const response = await postCombat(buildPayload());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.seed).toBe(123);
    expect(typeof json.battleId).toBe('string');
    expect(typeof json.winnerEntityId).toBe('string');
    expect(Array.isArray(json.events)).toBe(true);
  });

  it('rejects numeric entityId values', async () => {
    const response = await postCombat(
      buildPayload({
        playerInitial: {
          ...buildPayload().playerInitial,
          entityId: 101
        }
      })
    );

    expect(response.status).toBe(400);
  });

  it('rejects invalid non-numeric string entity IDs', async () => {
    const response = await postCombat(
      buildPayload({
        enemyInitial: {
          ...buildPayload().enemyInitial,
          entityId: 'enemy-202'
        }
      })
    );

    expect(response.status).toBe(400);
  });

  it('rejects payloads missing required canonical fields', async () => {
    const payload = buildPayload();
    delete (payload.playerInitial as Record<string, unknown>).activeSkillIds;

    const response = await postCombat(payload);
    expect(response.status).toBe(400);
  });


  it('rejects non-numeric string skill IDs in snapshots', async () => {
    const response = await postCombat(
      buildPayload({
        playerInitial: {
          ...buildPayload().playerInitial,
          activeSkillIds: ['1001', 'bad-skill']
        }
      })
    );

    expect(response.status).toBe(400);
  });

  it('rejects malformed skill tuple shapes', async () => {
    const response = await postCombat(
      buildPayload({
        playerInitial: {
          ...buildPayload().playerInitial,
          activeSkillIds: ['1001']
        }
      })
    );

    expect(response.status).toBe(400);
  });

  it('rejects client-supplied snapshot initiative because initiative is runtime-derived', async () => {
    const response = await postCombat(
      buildPayload({
        playerInitial: {
          ...buildPayload().playerInitial,
          initiative: 99
        }
      })
    );

    expect(response.status).toBe(400);
  });
});
