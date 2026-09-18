import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { raise } from '$lib/server/http';
import { buildReportView, loadEventOr404 } from '$lib/server/views';

export const GET: RequestHandler = ({ params, request, locals }) => {
	try {
		const db = getDb();
		const event = loadEventOr404(db, params.code);
		return json(buildReportView(db, event, request, locals.accountId));
	} catch (e) {
		raise(e);
	}
};
