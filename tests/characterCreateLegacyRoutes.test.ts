import { POST as preparePOST } from '../app/api/solana/character/create/prepare/route';
import { POST as finalizePOST } from '../app/api/solana/character/create/submit/route';

describe('legacy character create routes', () => {
  it('returns a breaking-change error for legacy character-create prepare', async () => {
    const response = await preparePOST();
    const json = await response.json();

    expect(response.status).toBe(410);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('ERR_LEGACY_CHARACTER_CREATE_ROUTE_REMOVED');
  });

  it('returns a breaking-change error for legacy character-create finalize', async () => {
    const response = await finalizePOST();
    const json = await response.json();

    expect(response.status).toBe(410);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('ERR_LEGACY_CHARACTER_CREATE_ROUTE_REMOVED');
  });
});
