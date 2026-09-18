import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { finalizeRoster } from '$lib/server/close';
import { getDb } from '$lib/server/db';
import { stopSubmissions } from '$lib/server/events';
import { raise, readJson } from '$lib/server/http';
import { requireHost } from '$lib/server/roles';
import { buildEventPageView, loadEventOr404 } from '$lib/server/views';
import { closeInput } from '$lib/shared/validation';

/** Closing is a one-way door: stop submissions if still open, then finalize the roster. */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	try {
		const db = getDb();
		const event = loadEventOr404(db, params.code);
		requireHost(event, request, locals.accountId);
		const input = await readJson(request, closeInput);
		const stopped = stopSubmissions(db, event);
		const closed = finalizeRoster(db, stopped, input.pending);
		return json(buildEventPageView(db, closed, request, locals.accountId));
	} catch (e) {
		raise(e);
	}
};
