export class XorShift32 {
  private state: number;

  constructor(seed: number) {
    const normalizedSeed = seed | 0;
    this.state = normalizedSeed === 0 ? 1 : normalizedSeed;
  }

  nextU32(): number {
    let x = this.state | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x | 0;
    return this.state >>> 0;
  }

  nextInt(minInclusive: number, maxInclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxInclusive)) {
      throw new Error('nextInt bounds must be integers');
    }

    if (maxInclusive < minInclusive) {
      throw new Error('maxInclusive must be >= minInclusive');
    }

    const span = maxInclusive - minInclusive + 1;
    if (span <= 0) {
      throw new Error('Range size must be positive');
    }

    const value = this.nextU32() % span;
    return minInclusive + value;
  }
}
