import { describe, expect, it } from 'vitest';
import { ProviderError, type JsonRequest } from '../contract';
import { createOpenAiProvider } from './openai';

type Recorded = {
	url: string;
	method: string;
	headers: Headers;
	body: Record<string, unknown> | null;
};

function fakeFetch(handler: (req: Recorded) => { status: number; body: unknown }) {
	const calls: Recorded[] = [];
	const fetchImpl = async (
		input: string | URL | Request,
		init?: RequestInit
	): Promise<Response> => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		const req: Recorded = {
			url,
			method: init?.method ?? 'GET',
			headers: new Headers(init?.headers),
			body: init?.body ? JSON.parse(String(init.body)) : null
		};
		calls.push(req);
		const { status, body } = handler(req);
		return new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json' }
		});
	};
	return { calls, fetch: fetchImpl as typeof fetch };
}

const request = (over: Partial<JsonRequest> = {}): JsonRequest => ({
	key: 'sk-test-key-12345678',
	model: 'gpt-5.6',
	effort: 'max',
	system: 'sys',
	user: 'usr',
	schemaName: 'anonymize',
	schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
	maxTokens: 4000,
	payload: {
		stage: 'anonymize',
		input: { options: [], currency: 'EUR', ranking: [], vetoes: [], opinion: '', suggestion: '' }
	},
	...over
});

const completion = (content: string | null, finish = 'stop', refusal: string | null = null) => ({
	id: 'chatcmpl_1',
	object: 'chat.completion',
	created: 0,
	model: 'gpt-5.6',
	choices: [
		{
			index: 0,
			message: { role: 'assistant', content, refusal },
			finish_reason: finish,
			logprobs: null
		}
	],
	usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
});

describe('openaiProvider.listModels', () => {
	it('keeps chat models, drops the rest, and puts the flagship first', async () => {
		const { fetch, calls } = fakeFetch(() => ({
			status: 200,
			body: {
				object: 'list',
				data: [
					{ id: 'text-embedding-3-small', object: 'model', created: 0, owned_by: 'openai' },
					{ id: 'gpt-4.1', object: 'model', created: 0, owned_by: 'openai' },
					{ id: 'gpt-5.6', object: 'model', created: 0, owned_by: 'openai' },
					{ id: 'gpt-4o-realtime-preview', object: 'model', created: 0, owned_by: 'openai' },
					{ id: 'whisper-1', object: 'model', created: 0, owned_by: 'openai' }
				]
			}
		}));
		const models = await createOpenAiProvider({ fetch }).listModels('sk-test-key-12345678');
		expect(models.map((m) => m.id)).toEqual(['gpt-5.6', 'gpt-4.1']);
		expect(calls[0].headers.get('authorization')).toBe('Bearer sk-test-key-12345678');
	});
});

describe('openaiProvider.completeJson', () => {
	it('sends a strict json_schema response_format and reasoning_effort, and parses the content', async () => {
		const { fetch, calls } = fakeFetch(() => ({ status: 200, body: completion('{"points":[]}') }));
		const out = await createOpenAiProvider({ fetch }).completeJson(request());
		expect(out).toEqual({ points: [] });
		const body = calls[0].body!;
		expect(calls[0].url).toContain('/chat/completions');
		expect(body.model).toBe('gpt-5.6');
		expect(body.messages).toEqual([
			{ role: 'system', content: 'sys' },
			{ role: 'user', content: 'usr' }
		]);
		expect(body.max_completion_tokens).toBe(4000);
		expect(body.reasoning_effort).toBe('high');
		expect(body.response_format).toEqual({
			type: 'json_schema',
			json_schema: { name: 'anonymize', strict: true, schema: request().schema }
		});
	});

	it('passes lower efforts through and retries once without effort when rejected', async () => {
		const { fetch, calls } = fakeFetch((req) => {
			if (req.body?.reasoning_effort) {
				return {
					status: 400,
					body: {
						error: {
							message: 'Unsupported parameter: reasoning_effort',
							type: 'invalid_request_error'
						}
					}
				};
			}
			return { status: 200, body: completion('{"ok":1}') };
		});
		const out = await createOpenAiProvider({ fetch }).completeJson(
			request({ effort: 'low', model: 'gpt-4.1' })
		);
		expect(out).toEqual({ ok: 1 });
		expect(calls[0].body?.reasoning_effort).toBe('low');
		expect(calls).toHaveLength(2);
		expect(calls[1].body?.reasoning_effort).toBeUndefined();
	});

	it('maps refusals, truncation, bad keys, rate limits, and outages', async () => {
		const p = (h: Parameters<typeof fakeFetch>[0]) =>
			createOpenAiProvider({ fetch: fakeFetch(h).fetch })
				.completeJson(request())
				.catch((e) => e);
		const refused = (await p(() => ({
			status: 200,
			body: completion(null, 'stop', 'I cannot help with that')
		}))) as ProviderError;
		expect(refused).toBeInstanceOf(ProviderError);
		expect(refused.message).toMatch(/declined/);
		const cut = (await p(() => ({
			status: 200,
			body: completion('{"points":[', 'length')
		}))) as ProviderError;
		expect(cut.message).toMatch(/ran out of room/);
		const badKey = (await p(() => ({
			status: 401,
			body: {
				error: {
					message: 'Incorrect API key provided: sk-test-key-12345678',
					type: 'invalid_request_error'
				}
			}
		}))) as ProviderError;
		expect(badKey.message).toMatch(/rejected the key/);
		expect(badKey.message).not.toContain('sk-test-key-12345678');
		expect(badKey.retryable).toBe(false);
		const limited = (await p(() => ({
			status: 429,
			body: { error: { message: 'Rate limit', type: 'rate_limit_error' } }
		}))) as ProviderError;
		expect(limited.retryable).toBe(true);
		const down = (await p(() => ({
			status: 503,
			body: { error: { message: 'down', type: 'server_error' } }
		}))) as ProviderError;
		expect(down.retryable).toBe(true);
	});
});
