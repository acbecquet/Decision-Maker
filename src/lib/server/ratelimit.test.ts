import { describe, expect, it } from 'vitest';
import { RateLimiter, rateLimitScale } from './ratelimit';

describe('RateLimiter', () => {
	it('allows up to the limit inside the window and refuses after', () => {
		const limiter = new RateLimiter();
		const t0 = 1_000_000;
		expect(limiter.allow('k', 3, 60_000, t0)).toBe(true);
		expect(limiter.allow('k', 3, 60_000, t0 + 1)).toBe(true);
		expect(limiter.allow('k', 3, 60_000, t0 + 2)).toBe(true);
		expect(limiter.allow('k', 3, 60_000, t0 + 3)).toBe(false);
		expect(limiter.allow('other', 3, 60_000, t0 + 3)).toBe(true);
	});

	it('frees slots as the window slides', () => {
		const limiter = new RateLimiter();
		const t0 = 1_000_000;
		limiter.allow('k', 1, 1_000, t0);
		expect(limiter.allow('k', 1, 1_000, t0 + 999)).toBe(false);
		expect(limiter.allow('k', 1, 1_000, t0 + 1_000)).toBe(true);
	});

	it('prunes stale keys', () => {
		const limiter = new RateLimiter();
		limiter.allow('k', 1, 1_000, 0);
		limiter.prune(10_000, 5_000);
		expect(limiter.size).toBe(0);
	});
});

describe('rateLimitScale', () => {
	it('defaults to 1 and only accepts a multiplier of at least 1', () => {
		expect(rateLimitScale({})).toBe(1);
		expect(rateLimitScale({ RATE_LIMIT_SCALE: '10' })).toBe(10);
		expect(rateLimitScale({ RATE_LIMIT_SCALE: '0' })).toBe(1);
		expect(rateLimitScale({ RATE_LIMIT_SCALE: 'abc' })).toBe(1);
	});
});
