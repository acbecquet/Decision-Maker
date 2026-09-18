import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { claimEvents } from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import { AppError } from '$lib/server/errors';
import { raise, readJson } from '$lib/server/http';
import { claimInput } from '$lib/shared/validation';

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		if (!locals.accountId) throw new AppError(401, 'Not signed in');
		const input = await readJson(request, claimInput);
		return json({ claimed: claimEvents(getDb(), locals.accountId, input.hostTokens) });
	} catch (e) {
		raise(e);
	}
};
