import { describe, expect, it } from 'vitest';
import { fakeProvider } from './fake';
import { getProvider, isFakeProviderAllowed } from './provider';

describe('provider registry', () => {
	it('exposes the fake provider only when the environment allows it', () => {
		expect(isFakeProviderAllowed({ ALLOW_FAKE_PROVIDER: '1' })).toBe(true);
		expect(isFakeProviderAllowed({})).toBe(false);
		expect(getProvider('fake', { ALLOW_FAKE_PROVIDER: '1' })).toBe(fakeProvider);
		expect(() => getProvider('fake', {})).toThrow(/Unknown provider/);
		expect(() => getProvider('nope', { ALLOW_FAKE_PROVIDER: '1' })).toThrow(/Unknown provider/);
	});
});

describe('fakeProvider', () => {
	it('lists one model and returns a deterministic object', async () => {
		const models = await fakeProvider.listModels('any-key');
		expect(models).toEqual([{ id: 'fake-fast', label: 'Fake (deterministic)' }]);
		const out = await fakeProvider.completeJson({
			key: 'any-key',
			model: 'fake-fast',
			system: 's',
			user: 'u',
			schemaName: 'anonymize',
			schema: { type: 'object' },
			maxTokens: 100
		});
		expect(out).toEqual({ schemaName: 'anonymize', model: 'fake-fast', fake: true });
	});
});
