import { describe, expect, it } from 'vitest';
import { ProviderError } from './contract';
import { withRetry } from './retry';

describe('withRetry', () => {
	it('retries retryable errors with growing delays and returns the first success', async () => {
		let calls = 0;
		const delays: number[] = [];
		const result = await withRetry(
			async () => {
				calls++;
				if (calls < 3) throw new ProviderError('rate limited', true);
				return 'ok';
			},
			{ attempts: 3, baseDelayMs: 10, sleep: async (ms) => void delays.push(ms) }
		);
		expect(result).toBe('ok');
		expect(calls).toBe(3);
		expect(delays).toEqual([10, 40]);
	});

	it('gives up after the last attempt and rethrows', async () => {
		let calls = 0;
		await expect(
			withRetry(
				async () => {
					calls++;
					throw new ProviderError('down', true);
				},
				{ attempts: 3, baseDelayMs: 1, sleep: async () => undefined }
			)
		).rejects.toThrow('down');
		expect(calls).toBe(3);
	});

	it('does not retry non-retryable errors or plain errors', async () => {
		let calls = 0;
		await expect(
			withRetry(
				async () => {
					calls++;
					throw new ProviderError('bad key', false);
				},
				{ attempts: 3, baseDelayMs: 1, sleep: async () => undefined }
			)
		).rejects.toThrow('bad key');
		expect(calls).toBe(1);
		await expect(
			withRetry(
				async () => {
					calls++;
					throw new Error('boom');
				},
				{ attempts: 3, baseDelayMs: 1, sleep: async () => undefined }
			)
		).rejects.toThrow('boom');
		expect(calls).toBe(2);
	});

	it('stops when the signal is aborted', async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			withRetry(async () => 'never', {
				attempts: 3,
				baseDelayMs: 1,
				signal: controller.signal,
				sleep: async () => undefined
			})
		).rejects.toThrow(/stopped/);
	});
});
