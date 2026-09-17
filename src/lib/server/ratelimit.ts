import { tooMany } from './errors';

/** In-memory sliding-window limiter. One process, so one map is the whole state. */
export class RateLimiter {
	private hits = new Map<string, number[]>();

	allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
		const recent = (this.hits.get(key) ?? []).filter((t) => t > now - windowMs);
		if (recent.length >= limit) {
			this.hits.set(key, recent);
			return false;
		}
		recent.push(now);
		this.hits.set(key, recent);
		return true;
	}

	prune(now = Date.now(), maxAgeMs = 3_600_000): void {
		for (const [key, times] of this.hits) {
			if (times.every((t) => t <= now - maxAgeMs)) this.hits.delete(key);
		}
	}

	get size(): number {
		return this.hits.size;
	}
}

export const limiter = new RateLimiter();

/** Throws a 429 AppError when the key has exceeded its limit. */
export function enforce(key: string, limit: number, windowMs: number): void {
	if (!limiter.allow(key, limit, windowMs)) {
		throw tooMany('Too many requests, try again in a moment');
	}
}
