import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { raise } from '$lib/server/http';
import { publishEvent } from '$lib/server/publish';
import { requireHost } from '$lib/server/roles';
import { buildEventPageView, loadEventOr404 } from '$lib/server/views';

export const POST: RequestHandler = ({ params, request }) => {
	try {
		const db = getDb();
		const event = loadEventOr404(db, params.code);
		requireHost(event, request);
		return json(buildEventPageView(db, publishEvent(db, event), request));
	} catch (e) {
		raise(e);
	}
};
