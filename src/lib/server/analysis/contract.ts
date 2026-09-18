import type { ProviderId, ThinkingEffort } from '$lib/shared/report';
import type { AnonymizeInput, SynthesizeInput } from './prompts';
import type { JsonSchema } from './schemas';

export type ModelInfo = { id: string; label: string };

export type StagePayload =
	{ stage: 'anonymize'; input: AnonymizeInput } | { stage: 'synthesize'; input: SynthesizeInput };

export type JsonRequest = {
	key: string;
	model: string;
	effort: ThinkingEffort;
	system: string;
	user: string;
	schemaName: string;
	schema: JsonSchema;
	maxTokens: number;
	/** The structured stage input. Real providers ignore it; the fake provider answers from it. */
	payload: StagePayload;
	signal?: AbortSignal;
};

/** One model provider. Keys are passed per call and never stored by an implementation. */
export interface ModelProvider {
	readonly id: ProviderId;
	/** The models this key can use, default first. */
	listModels(key: string): Promise<ModelInfo[]>;
	/** One structured JSON completion, parsed but not yet validated. Throws ProviderError. */
	completeJson(request: JsonRequest): Promise<unknown>;
}

/** A provider failure with a message safe to show the host. Retryable marks rate limits, timeouts, and 5xx. */
export class ProviderError extends Error {
	constructor(
		message: string,
		public readonly retryable: boolean
	) {
		super(message);
		this.name = 'ProviderError';
	}
}

/** Extracts the first JSON object from model text and parses it. */
export function parseJsonText(text: string): unknown {
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start < 0 || end < start) throw new ProviderError('The model did not return JSON', false);
	try {
		return JSON.parse(text.slice(start, end + 1));
	} catch {
		throw new ProviderError('The model returned malformed JSON', false);
	}
}

/** Replaces every occurrence of the key in a message, so a key can never leak through an error. */
export function redact(message: string, key: string): string {
	return key.length >= 8 ? message.split(key).join('[key]') : message;
}

/** Flattens whitespace and caps an upstream provider message before it is shown to a host. */
export function capUpstreamMessage(message: string, max = 200): string {
	return message.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Moves the first preferred id that exists to the front; everything else keeps its order. */
export function preferFirst(models: ModelInfo[], preferred: string[]): ModelInfo[] {
	const hit = preferred.map((id) => models.find((m) => m.id === id)).find(Boolean);
	if (!hit) return models;
	return [hit, ...models.filter((m) => m !== hit)];
}
