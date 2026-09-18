import type { ModelProvider } from './provider';

/** Deterministic stand-in used by tests and demos. Phase 2 gives it canned stage outputs. */
export const fakeProvider: ModelProvider = {
	id: 'fake',
	async listModels() {
		return [{ id: 'fake-fast', label: 'Fake (deterministic)' }];
	},
	async completeJson(request) {
		return { schemaName: request.schemaName, model: request.model, fake: true };
	}
};
