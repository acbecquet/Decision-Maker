import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ProviderError, redact } from '$lib/server/analysis/contract';
import { getProvider } from '$lib/server/analysis/provider';
import { getDb } from '$lib/server/db';
import { upstream } from '$lib/server/errors';
import { raise, readJson } from '$lib/server/http';
import { requireHost } from '$lib/server/roles';
import { loadEventOr404 } from '$lib/server/views';
import { modelsInput } from '$lib/shared/validation';

/** Lists the models a key can use. The key is in the body, used once, and dropped. */
export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const db = getDb();
		const event = loadEventOr404(db, params.code);
		requireHost(event, request);
		const input = await readJson(request, modelsInput);
		try {
			return json({ models: await getProvider(input.provider).listModels(input.key) });
		} catch (e) {
			if (e instanceof ProviderError) throw upstream(redact(e.message, input.key));
			throw e;
		}
	} catch (e) {
		raise(e);
	}
};
