import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { raise, readJson } from '$lib/server/http';
import { setParticipantStatus } from '$lib/server/participants';
import { requireHost } from '$lib/server/roles';
import { buildEventPageView, loadEventOr404 } from '$lib/server/views';
import { participantStatusInput } from '$lib/shared/validation';

export const PATCH: RequestHandler = async ({ params, request }) => {
	try {
		const db = getDb();
		const event = loadEventOr404(db, params.code);
		requireHost(event, request);
		const input = await readJson(request, participantStatusInput);
		setParticipantStatus(db, event, params.id, input.status);
		return json(buildEventPageView(db, event, request));
	} catch (e) {
		raise(e);
	}
};
