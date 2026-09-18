import Anthropic from '@anthropic-ai/sdk';
import { ANALYSIS } from '$lib/shared/constants';
import {
	ProviderError,
	parseJsonText,
	preferFirst,
	redact,
	type JsonRequest,
	type ModelInfo,
	type ModelProvider
} from '../contract';

const PREFERRED = ['claude-opus-5'];
/** Above this the SDK insists on streaming; the stages fit comfortably below it. */
const MAX_NON_STREAMING_TOKENS = 16_000;

type Deps = { fetch?: typeof fetch };

function client(
	key: string,
	deps: Deps,
	timeout: number = ANALYSIS.stageTimeoutMs.anonymize
): Anthropic {
	return new Anthropic({
		apiKey: key,
		maxRetries: 0,
		timeout,
		fetch: deps.fetch
	});
}

/** Maps SDK failures to a host-safe ProviderError with the key redacted. */
function mapError(e: unknown, key: string): ProviderError {
	if (e instanceof ProviderError) return e;
	if (e instanceof Anthropic.AuthenticationError)
		return new ProviderError('Anthropic rejected the key', false);
	if (e instanceof Anthropic.RateLimitError)
		return new ProviderError('Anthropic is rate limiting this key', true);
	if (e instanceof Anthropic.NotFoundError)
		return new ProviderError('Anthropic does not know that model', false);
	if (e instanceof Anthropic.APIConnectionTimeoutError)
		return new ProviderError('Anthropic did not answer in time', true);
	if (e instanceof Anthropic.APIConnectionError)
		return new ProviderError('Could not reach Anthropic', true);
	if (e instanceof Anthropic.APIError) {
		const status = e.status ?? 0;
		return new ProviderError(redact(`Anthropic error ${status}: ${e.message}`, key), status >= 500);
	}
	return new ProviderError(
		redact(e instanceof Error ? e.message : 'Unknown provider error', key),
		false
	);
}

const mentionsEffort = (e: unknown) =>
	e instanceof Anthropic.BadRequestError && /effort/i.test(e.message);

export function createAnthropicProvider(deps: Deps = {}): ModelProvider {
	return {
		id: 'anthropic',

		async listModels(key) {
			try {
				const models: ModelInfo[] = [];
				for await (const m of client(key, deps).models.list()) {
					if (m.capabilities?.structured_outputs?.supported === false) continue;
					models.push({ id: m.id, label: m.display_name });
				}
				return preferFirst(models, PREFERRED);
			} catch (e) {
				throw mapError(e, key);
			}
		},

		async completeJson(req: JsonRequest) {
			const params = (withEffort: boolean): Anthropic.MessageCreateParamsNonStreaming => ({
				model: req.model,
				max_tokens: Math.min(req.maxTokens, MAX_NON_STREAMING_TOKENS),
				system: req.system,
				messages: [{ role: 'user', content: req.user }],
				output_config: {
					...(withEffort ? { effort: req.effort } : {}),
					format: { type: 'json_schema', schema: req.schema }
				}
			});
			const anthropic = client(req.key, deps, ANALYSIS.stageTimeoutMs[req.payload.stage]);
			let response: Anthropic.Message;
			try {
				try {
					response = await anthropic.messages.create(params(true), { signal: req.signal });
				} catch (e) {
					if (!mentionsEffort(e)) throw e;
					response = await anthropic.messages.create(params(false), { signal: req.signal });
				}
			} catch (e) {
				throw mapError(e, req.key);
			}
			if (response.stop_reason === 'refusal')
				throw new ProviderError('The model declined this request', false);
			if (response.stop_reason === 'max_tokens')
				throw new ProviderError('The model ran out of room', false);
			const text = response.content
				.filter((b): b is Anthropic.TextBlock => b.type === 'text')
				.map((b) => b.text)
				.join('');
			return parseJsonText(text);
		}
	};
}

export const anthropicProvider = createAnthropicProvider();
