import { badRequest } from '../errors';
import { fakeProvider } from './fake';

export type ProviderId = 'anthropic' | 'openai' | 'openrouter' | 'fake';

export type ModelInfo = { id: string; label: string };

export type JsonRequest = {
	key: string;
	model: string;
	system: string;
	user: string;
	schemaName: string;
	schema: Record<string, unknown>;
	maxTokens: number;
};

/** One model provider. Keys are passed per call and never stored by an implementation. */
export interface ModelProvider {
	readonly id: ProviderId;
	listModels(key: string): Promise<ModelInfo[]>;
	completeJson(request: JsonRequest): Promise<unknown>;
}

export function isFakeProviderAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.ALLOW_FAKE_PROVIDER === '1';
}

const registry: Partial<Record<ProviderId, ModelProvider>> = { fake: fakeProvider };

export function getProvider(id: string, env: NodeJS.ProcessEnv = process.env): ModelProvider {
	if (id === 'fake' && !isFakeProviderAllowed(env)) throw badRequest('Unknown provider');
	const provider = registry[id as ProviderId];
	if (!provider) throw badRequest('Unknown provider');
	return provider;
}
