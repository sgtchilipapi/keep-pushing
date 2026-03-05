import { XorShift32 } from '../engine/rng/xorshift32';

describe('XorShift32', () => {
  it('produces the same sequence for the same seed', () => {
    const a = new XorShift32(123456);
    const b = new XorShift32(123456);

    const seqA = Array.from({ length: 10 }, () => a.nextU32());
    const seqB = Array.from({ length: 10 }, () => b.nextU32());

    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = new XorShift32(123456);
    const b = new XorShift32(654321);

    const seqA = Array.from({ length: 10 }, () => a.nextU32());
    const seqB = Array.from({ length: 10 }, () => b.nextU32());

    expect(seqA).not.toEqual(seqB);
  });

  it('respects inclusive bounds in nextInt', () => {
    const rng = new XorShift32(42);

    for (let i = 0; i < 1000; i += 1) {
      const n = rng.nextInt(1, 10000);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(10000);
    }
  });

  it('coerces seed 0 to 1 deterministically', () => {
    const zeroSeed = new XorShift32(0);
    const oneSeed = new XorShift32(1);

    expect(zeroSeed.nextU32()).toBe(oneSeed.nextU32());
  });
});
