import { POST as ackPOST } from '../app/api/solana/settlement/ack/route';
import { POST as preparePOST } from '../app/api/solana/settlement/prepare/route';
import { POST as submitPOST } from '../app/api/solana/settlement/submit/route';

describe('legacy settlement routes', () => {
  it('returns a breaking-change error for legacy settlement prepare', async () => {
    const response = await preparePOST();
    const json = await response.json();

    expect(response.status).toBe(410);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('ERR_LEGACY_SETTLEMENT_ROUTE_REMOVED');
  });

  it('returns a breaking-change error for legacy settlement submit', async () => {
    const response = await submitPOST();
    const json = await response.json();

    expect(response.status).toBe(410);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('ERR_LEGACY_SETTLEMENT_ROUTE_REMOVED');
  });

  it('returns a breaking-change error for legacy settlement ack', async () => {
    const response = await ackPOST();
    const json = await response.json();

    expect(response.status).toBe(410);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('ERR_LEGACY_SETTLEMENT_ROUTE_REMOVED');
  });
});
