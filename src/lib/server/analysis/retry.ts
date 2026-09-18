import { ProviderError } from './contract';

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(done, ms);
		function done() {
			signal?.removeEventListener('abort', done);
			clearTimeout(timer);
			resolve();
		}
		signal?.addEventListener('abort', done, { once: true });
	});
}

export type RetryOptions = {
	attempts: number;
	baseDelayMs: number;
	signal?: AbortSignal;
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

/** Runs fn up to `attempts` times, backing off by four times per attempt, for retryable ProviderErrors only. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
	const wait = opts.sleep ?? sleep;
	for (let attempt = 1; ; attempt++) {
		if (opts.signal?.aborted) throw new ProviderError('The analysis was stopped', false);
		try {
			return await fn();
		} catch (e) {
			const retryable = e instanceof ProviderError && e.retryable && attempt < opts.attempts;
			if (!retryable) throw e;
			await wait(opts.baseDelayMs * 4 ** (attempt - 1), opts.signal);
		}
	}
}
