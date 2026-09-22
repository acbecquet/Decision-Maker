import { describe, expect, it } from 'vitest';
import { ProviderError, type JsonRequest } from '../contract';
import { createAnthropicProvider } from './anthropic';

type Recorded = { url: string; method: string; headers: Headers; body: unknown };

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
	key: 'sk-ant-test-key-1234',
	model: 'claude-opus-5',
	effort: 'max',
	system: 'sys',
	user: 'usr',
	schemaName: 'anonymize',
	schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
	maxTokens: 4000,
	payload: {
		stage: 'anonymize',
		input: {
			options: [],
			currency: 'EUR',
			mode: 'ranked',
			ranking: [],
			vetoes: [],
			opinion: '',
			suggestion: ''
		}
	},
	...over
});

const message = (text: string, stop = 'end_turn') => ({
	id: 'msg_1',
	type: 'message',
	role: 'assistant',
	model: 'claude-opus-5',
	content: [{ type: 'text', text }],
	stop_reason: stop,
	stop_sequence: null,
	usage: { input_tokens: 1, output_tokens: 1 }
});

describe('anthropicProvider.listModels', () => {
	it('lists models with structured output support, default first', async () => {
		const { fetch, calls } = fakeFetch(() => ({
			status: 200,
			body: {
				data: [
					{
						type: 'model',
						id: 'claude-sonnet-5',
						display_name: 'Claude Sonnet 5',
						created_at: 'x',
						capabilities: { structured_outputs: { supported: true } }
					},
					{
						type: 'model',
						id: 'claude-3-haiku-20240307',
						display_name: 'Claude Haiku 3',
						created_at: 'x',
						capabilities: { structured_outputs: { supported: false } }
					},
					{
						type: 'model',
						id: 'claude-opus-5',
						display_name: 'Claude Opus 5',
						created_at: 'x',
						capabilities: { structured_outputs: { supported: true } }
					}
				],
				has_more: false,
				first_id: 'claude-sonnet-5',
				last_id: 'claude-opus-5'
			}
		}));
		const models = await createAnthropicProvider({ fetch }).listModels('sk-ant-test-key-1234');
		expect(models).toEqual([
			{ id: 'claude-opus-5', label: 'Claude Opus 5' },
			{ id: 'claude-sonnet-5', label: 'Claude Sonnet 5' }
		]);
		expect(calls[0].url).toContain('/v1/models');
		expect(calls[0].headers.get('x-api-key')).toBe('sk-ant-test-key-1234');
	});

	it('maps a rejected key to a plain non-retryable error without the key in it', async () => {
		const { fetch } = fakeFetch(() => ({
			status: 401,
			body: {
				type: 'error',
				error: { type: 'authentication_error', message: 'invalid x-api-key sk-ant-test-key-1234' }
			}
		}));
		const err = await createAnthropicProvider({ fetch })
			.listModels('sk-ant-test-key-1234')
			.catch((e) => e);
		expect(err).toBeInstanceOf(ProviderError);
		expect(err.retryable).toBe(false);
		expect(err.message).toMatch(/rejected the key/);
		expect(err.message).not.toContain('sk-ant-test-key-1234');
	});
});

describe('anthropicProvider.completeJson', () => {
	it('sends system, user, effort, and the schema as output_config and parses the text block', async () => {
		const { fetch, calls } = fakeFetch(() => ({ status: 200, body: message('{"points":[]}') }));
		const out = await createAnthropicProvider({ fetch }).completeJson(request());
		expect(out).toEqual({ points: [] });
		const body = calls[0].body as Record<string, unknown>;
		expect(calls[0].url).toContain('/v1/messages');
		expect(body.model).toBe('claude-opus-5');
		expect(body.system).toBe('sys');
		expect(body.messages).toEqual([{ role: 'user', content: 'usr' }]);
		expect(body.max_tokens).toBe(4000);
		expect(body.output_config).toEqual({
			effort: 'max',
			format: { type: 'json_schema', schema: request().schema }
		});
	});

	it('caps max_tokens at 16000 for a non-streaming call', async () => {
		const { fetch, calls } = fakeFetch(() => ({ status: 200, body: message('{}') }));
		await createAnthropicProvider({ fetch }).completeJson(request({ maxTokens: 32000 }));
		expect((calls[0].body as { max_tokens: number }).max_tokens).toBe(16000);
	});

	it('retries once without effort when the model rejects the effort level', async () => {
		const { fetch, calls } = fakeFetch((req) => {
			const body = req.body as { output_config?: { effort?: string } };
			if (body.output_config?.effort) {
				return {
					status: 400,
					body: {
						type: 'error',
						error: {
							type: 'invalid_request_error',
							message: 'effort: max is not supported for this model'
						}
					}
				};
			}
			return { status: 200, body: message('{"ok":true}') };
		});
		const out = await createAnthropicProvider({ fetch }).completeJson(
			request({ model: 'claude-haiku-4-5' })
		);
		expect(out).toEqual({ ok: true });
		expect(calls).toHaveLength(2);
		expect((calls[1].body as { output_config: object }).output_config).toEqual({
			format: { type: 'json_schema', schema: request().schema }
		});
	});

	it('marks rate limits and server errors retryable and refusals not', async () => {
		const limited = fakeFetch(() => ({
			status: 429,
			body: { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }
		}));
		const e1 = (await createAnthropicProvider({ fetch: limited.fetch })
			.completeJson(request())
			.catch((e) => e)) as ProviderError;
		expect(e1).toBeInstanceOf(ProviderError);
		expect(e1.retryable).toBe(true);

		const down = fakeFetch(() => ({
			status: 529,
			body: { type: 'error', error: { type: 'overloaded_error', message: 'overloaded' } }
		}));
		const e2 = (await createAnthropicProvider({ fetch: down.fetch })
			.completeJson(request())
			.catch((e) => e)) as ProviderError;
		expect(e2.retryable).toBe(true);

		const refused = fakeFetch(() => ({ status: 200, body: message('', 'refusal') }));
		const e3 = (await createAnthropicProvider({ fetch: refused.fetch })
			.completeJson(request())
			.catch((e) => e)) as ProviderError;
		expect(e3).toBeInstanceOf(ProviderError);
		expect(e3.retryable).toBe(false);
		expect(e3.message).toMatch(/declined/);

		const cut = fakeFetch(() => ({ status: 200, body: message('{"points":[', 'max_tokens') }));
		const e4 = (await createAnthropicProvider({ fetch: cut.fetch })
			.completeJson(request())
			.catch((e) => e)) as ProviderError;
		expect(e4.message).toMatch(/ran out of room/);
	});
});
