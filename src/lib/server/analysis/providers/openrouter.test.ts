import { describe, expect, it } from 'vitest';
import { ProviderError, type JsonRequest } from '../contract';
import { createOpenRouterProvider } from './openrouter';

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

const model = (id: string, name: string, params: string[], outputs = ['text']) => ({
	id,
	name,
	context_length: 100000,
	architecture: { modality: 'text->text', input_modalities: ['text'], output_modalities: outputs },
	supported_parameters: params,
	pricing: { prompt: '0', completion: '0' }
});

const catalogue = {
	data: [
		model('openai/gpt-5.6', 'OpenAI: GPT-5.6', [
			'response_format',
			'structured_outputs',
			'reasoning'
		]),
		model('~deepseek/deepseek-pro-latest', 'DeepSeek: DeepSeek Pro Latest', [
			'response_format',
			'structured_outputs',
			'reasoning'
		]),
		model('meta-llama/llama-3-8b', 'Meta: Llama 3 8B', ['temperature']),
		model('mistral/old-chat', 'Mistral: Old', ['response_format']),
		model('deepseek/deepseek-v4-pro-0813:batch', 'DeepSeek: V4 Pro (batch)', [
			'response_format',
			'structured_outputs'
		]),
		model('openai/gpt-image', 'OpenAI: Image', ['response_format'], ['image'])
	]
};

const request = (over: Partial<JsonRequest> = {}): JsonRequest => ({
	key: 'sk-or-v1-testkey-12345678',
	model: '~deepseek/deepseek-pro-latest',
	effort: 'max',
	system: 'sys',
	user: 'usr',
	schemaName: 'synthesize',
	schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
	maxTokens: 32000,
	payload: {
		stage: 'anonymize',
		input: { options: [], currency: 'EUR', ranking: [], vetoes: [], opinion: '', suggestion: '' }
	},
	...over
});

const completion = (content: string) => ({
	id: 'gen_1',
	object: 'chat.completion',
	created: 0,
	model: 'deepseek/deepseek-v4-pro-0813',
	choices: [
		{ index: 0, message: { role: 'assistant', content, refusal: null }, finish_reason: 'stop' }
	],
	usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
});

describe('openrouterProvider.listModels', () => {
	it('keeps text models that accept a response format, drops batch endpoints, default first', async () => {
		const { fetch, calls } = fakeFetch(() => ({ status: 200, body: catalogue }));
		const models = await createOpenRouterProvider({ fetch }).listModels(
			'sk-or-v1-testkey-12345678'
		);
		expect(models.map((m) => m.id)).toEqual([
			'~deepseek/deepseek-pro-latest',
			'mistral/old-chat',
			'openai/gpt-5.6'
		]);
		expect(models[0].label).toBe('DeepSeek: DeepSeek Pro Latest');
		expect(calls[0].url).toBe('https://openrouter.ai/api/v1/models');
		expect(calls[0].headers.get('authorization')).toBe('Bearer sk-or-v1-testkey-12345678');
	});
});

describe('openrouterProvider.completeJson', () => {
	it('uses the OpenRouter base URL, attribution headers, reasoning with exclude, and strict json_schema', async () => {
		const { fetch, calls } = fakeFetch((req) =>
			req.url.endsWith('/models')
				? { status: 200, body: catalogue }
				: { status: 200, body: completion('{"a":1}') }
		);
		const out = await createOpenRouterProvider({
			fetch,
			origin: 'https://example.test'
		}).completeJson(request());
		expect(out).toEqual({ a: 1 });
		const call = calls.find((c) => c.url.endsWith('/chat/completions'))!;
		expect(call.url).toBe('https://openrouter.ai/api/v1/chat/completions');
		expect(call.headers.get('http-referer')).toBe('https://example.test');
		expect(call.headers.get('x-openrouter-title')).toBe('DecisionMaker');
		expect(call.body?.max_tokens).toBe(32000);
		expect(call.body?.reasoning).toEqual({ effort: 'max', exclude: true });
		expect(call.body?.response_format).toEqual({
			type: 'json_schema',
			json_schema: { name: 'synthesize', strict: true, schema: request().schema }
		});
	});

	it('falls back to JSON in text for a model without structured outputs, and omits reasoning it cannot take', async () => {
		const { fetch, calls } = fakeFetch((req) =>
			req.url.endsWith('/models')
				? { status: 200, body: catalogue }
				: { status: 200, body: completion('Sure:\n{"a":2}') }
		);
		const out = await createOpenRouterProvider({ fetch }).completeJson(
			request({ model: 'mistral/old-chat' })
		);
		expect(out).toEqual({ a: 2 });
		const call = calls.find((c) => c.url.endsWith('/chat/completions'))!;
		expect(call.body?.response_format).toBeUndefined();
		expect(call.body?.reasoning).toBeUndefined();
		const system = (call.body?.messages as { role: string; content: string }[])[0].content;
		expect(system).toContain('sys');
		expect(system).toContain('"additionalProperties":false');
	});

	it('reports missing credits plainly and rate limits as retryable', async () => {
		const p = (status: number, message: string) =>
			createOpenRouterProvider({
				fetch: fakeFetch((req) =>
					req.url.endsWith('/models')
						? { status: 200, body: catalogue }
						: { status, body: { error: { message, code: status } } }
				).fetch
			})
				.completeJson(request())
				.catch((e) => e);
		const broke = (await p(402, 'Insufficient credits')) as ProviderError;
		expect(broke).toBeInstanceOf(ProviderError);
		expect(broke.retryable).toBe(false);
		expect(broke.message).toMatch(/credits/);
		const limited = (await p(429, 'Rate limited')) as ProviderError;
		expect(limited.retryable).toBe(true);
		const badKey = (await p(401, 'No auth credentials found')) as ProviderError;
		expect(badKey.message).toMatch(/rejected the key/);
	});
});
