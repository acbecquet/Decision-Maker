import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { badRequest } from '$lib/server/errors';
import { setClosesAt, updateEvent } from '$lib/server/events';
import { raise, readJson } from '$lib/server/http';
import { enforce } from '$lib/server/ratelimit';
import { requireHost } from '$lib/server/roles';
import { buildEventPageView, loadEventOr404 } from '$lib/server/views';
import { createEventInput, patchEventInput } from '$lib/shared/validation';

export const GET: RequestHandler = ({ params, request }) => {
	try {
		const db = getDb();
		const event = loadEventOr404(db, params.code);
		return json(buildEventPageView(db, event, request));
	} catch (e) {
		raise(e);
	}
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	try {
		const db = getDb();
		const event = loadEventOr404(db, params.code);
		requireHost(event, request);
		const input = await readJson(request, patchEventInput);
		if (input.closesAt && Date.parse(input.closesAt) <= Date.now()) {
			throw badRequest('The auto-close time has to be in the future');
		}
		const updated = setClosesAt(db, event, input.closesAt);
		return json(buildEventPageView(db, updated, request));
	} catch (e) {
		raise(e);
	}
};

/** Edits the whole event and rotates its code. Only while open and before the first submission. */
export const PUT: RequestHandler = async ({ params, request, getClientAddress }) => {
	try {
		enforce(`create:${getClientAddress()}`, 20, 3_600_000);
		const db = getDb();
		const event = loadEventOr404(db, params.code);
		requireHost(event, request);
		const input = await readJson(request, createEventInput);
		if (input.closesAt && Date.parse(input.closesAt) <= Date.now()) {
			throw badRequest('The auto-close time has to be in the future');
		}
		const updated = updateEvent(db, event, input);
		return json({ code: updated.code });
	} catch (e) {
		raise(e);
	}
};
