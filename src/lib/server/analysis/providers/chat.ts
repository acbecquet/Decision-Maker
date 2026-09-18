import OpenAI from 'openai';
import { ANALYSIS } from '$lib/shared/constants';
import type { ThinkingEffort } from '$lib/shared/report';
import {
	ProviderError,
	parseJsonText,
	redact,
	type JsonRequest,
	type ModelInfo,
	type ModelProvider
} from '../contract';

export type ChatProviderConfig = {
	id: 'openai' | 'openrouter';
	name: string;
	baseURL?: string;
	defaultHeaders?: Record<string, string>;
	tokensField: 'max_completion_tokens' | 'max_tokens';
	fetch?: typeof fetch;
	/** Lists the models this key can use, default first. */
	listModels(client: OpenAI, key: string): Promise<ModelInfo[]>;
	/** Provider-specific fields for thinking effort, or {} when the model cannot take them. */
	effortFields(model: string, effort: ThinkingEffort): Promise<Record<string, unknown>>;
	/** Whether the model honours a strict json_schema response format. */
	supportsSchema(model: string): Promise<boolean>;
};

function mapError(e: unknown, key: string, name: string): ProviderError {
	if (e instanceof ProviderError) return e;
	if (e instanceof OpenAI.AuthenticationError)
		return new ProviderError(`${name} rejected the key`, false);
	if (e instanceof OpenAI.RateLimitError)
		return new ProviderError(`${name} is rate limiting this key`, true);
	if (e instanceof OpenAI.NotFoundError)
		return new ProviderError(`${name} does not know that model`, false);
	if (e instanceof OpenAI.APIConnectionTimeoutError)
		return new ProviderError(`${name} did not answer in time`, true);
	if (e instanceof OpenAI.APIConnectionError)
		return new ProviderError(`Could not reach ${name}`, true);
	if (e instanceof OpenAI.APIError) {
		const status = e.status ?? 0;
		if (status === 402) return new ProviderError(`${name} reports insufficient credits`, false);
		return new ProviderError(redact(`${name} error ${status}: ${e.message}`, key), status >= 500);
	}
	return new ProviderError(
		redact(e instanceof Error ? e.message : 'Unknown provider error', key),
		false
	);
}

const mentionsEffort = (e: unknown) =>
	e instanceof OpenAI.BadRequestError && /reasoning|effort/i.test(e.message);

export function createChatProvider(config: ChatProviderConfig): ModelProvider {
	const client = (key: string) =>
		new OpenAI({
			apiKey: key,
			baseURL: config.baseURL,
			defaultHeaders: config.defaultHeaders,
			maxRetries: 0,
			timeout: ANALYSIS.callTimeoutMs,
			fetch: config.fetch
		});

	return {
		id: config.id,

		async listModels(key) {
			try {
				return await config.listModels(client(key), key);
			} catch (e) {
				throw mapError(e, key, config.name);
			}
		},

		async completeJson(req: JsonRequest) {
			const strict = await config.supportsSchema(req.model);
			const system = strict
				? req.system
				: `${req.system}\n\nRespond with only a JSON object that matches this JSON schema, with no prose before or after it:\n${JSON.stringify(req.schema)}`;
			const effort = await config.effortFields(req.model, req.effort);
			const body = (withEffort: boolean): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming => {
				const params: Record<string, unknown> = {
					model: req.model,
					messages: [
						{ role: 'system', content: system },
						{ role: 'user', content: req.user }
					],
					[config.tokensField]: req.maxTokens,
					...(strict
						? {
								response_format: {
									type: 'json_schema',
									json_schema: { name: req.schemaName, strict: true, schema: req.schema }
								}
							}
						: {}),
					...(withEffort ? effort : {})
				};
				return params as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
			};
			const openai = client(req.key);
			let completion: OpenAI.Chat.ChatCompletion;
			try {
				try {
					completion = await openai.chat.completions.create(body(true), { signal: req.signal });
				} catch (e) {
					if (!mentionsEffort(e) || Object.keys(effort).length === 0) throw e;
					completion = await openai.chat.completions.create(body(false), { signal: req.signal });
				}
			} catch (e) {
				throw mapError(e, req.key, config.name);
			}
			const choice = completion.choices[0];
			if (!choice) throw new ProviderError(`${config.name} returned no answer`, true);
			if (choice.message.refusal) throw new ProviderError('The model declined this request', false);
			if (choice.finish_reason === 'length')
				throw new ProviderError('The model ran out of room', false);
			return parseJsonText(choice.message.content ?? '');
		}
	};
}
