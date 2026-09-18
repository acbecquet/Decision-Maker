import { badRequest } from '../errors';
import { ProviderError, type ModelProvider } from './contract';
import { fakeProvider } from './fake';
import { anthropicProvider } from './providers/anthropic';
import type { ProviderId, ProviderInfo } from '$lib/shared/report';

export type { JsonRequest, ModelInfo, ModelProvider } from './contract';

const placeholder = (id: ProviderId): ModelProvider => ({
	id,
	async listModels() {
		throw new ProviderError('Not implemented yet', false);
	},
	async completeJson() {
		throw new ProviderError('Not implemented yet', false);
	}
});

const registry: Record<ProviderId, ModelProvider> = {
	anthropic: anthropicProvider,
	openai: placeholder('openai'),
	openrouter: placeholder('openrouter'),
	fake: fakeProvider
};

const INFO: ProviderInfo[] = [
	{ id: 'anthropic', label: 'Anthropic', auth: 'key' },
	{ id: 'openai', label: 'OpenAI', auth: 'key' },
	{ id: 'openrouter', label: 'OpenRouter', auth: 'connect' },
	{ id: 'fake', label: 'Fake (demo)', auth: 'none' }
];

export function isFakeProviderAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.ALLOW_FAKE_PROVIDER === '1';
}

export function listProviders(env: NodeJS.ProcessEnv = process.env): ProviderInfo[] {
	return INFO.filter((p) => p.id !== 'fake' || isFakeProviderAllowed(env));
}

export function getProvider(id: string, env: NodeJS.ProcessEnv = process.env): ModelProvider {
	if (id === 'fake' && !isFakeProviderAllowed(env)) throw badRequest('Unknown provider');
	const provider = registry[id as ProviderId];
	if (!provider) throw badRequest('Unknown provider');
	return provider;
}
