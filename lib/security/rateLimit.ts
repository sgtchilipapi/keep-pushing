type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateLimitBucket>();

export class RateLimitExceededError extends Error {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = 'RateLimitExceededError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function nowMs(): number {
  return Date.now();
}

function bucketKey(namespace: string, parts: readonly (string | number | null | undefined)[]): string {
  return `${namespace}:${parts.map((part) => String(part ?? 'null')).join(':')}`;
}

export function getClientIpAddress(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || 'unknown-ip';
  }
  return request.headers.get('x-real-ip') ?? 'unknown-ip';
}

export function assertRateLimit(args: {
  namespace: string;
  keyParts: readonly (string | number | null | undefined)[];
  limit: number;
  windowMs: number;
  errorCode: string;
}) {
  const key = bucketKey(args.namespace, args.keyParts);
  const currentNow = nowMs();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= currentNow) {
    buckets.set(key, {
      count: 1,
      resetAt: currentNow + args.windowMs,
    });
    return;
  }

  if (existing.count >= args.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - currentNow) / 1000));
    throw new RateLimitExceededError(
      `${args.errorCode}: rate limit exceeded`,
      retryAfterSeconds,
    );
  }

  existing.count += 1;
  buckets.set(key, existing);
}

export function resetRateLimitBuckets() {
  buckets.clear();
}
