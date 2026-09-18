import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sha256Hex } from '$lib/server/crypto';
import { getDb } from '$lib/server/db';
import { badRequest } from '$lib/server/errors';
import { createEvent } from '$lib/server/events';
import { raise, readJson } from '$lib/server/http';
import { enforce } from '$lib/server/ratelimit';
import { tokenFromHeader } from '$lib/server/roles';
import { createEventInput } from '$lib/shared/validation';

export const POST: RequestHandler = async ({ request, getClientAddress, locals }) => {
	try {
		enforce(`create:${getClientAddress()}`, 20, 3_600_000);
		const hostToken = tokenFromHeader(request, 'x-host-token');
		if (!hostToken) throw badRequest('Missing host token');
		const input = await readJson(request, createEventInput);
		if (input.closesAt && Date.parse(input.closesAt) <= Date.now()) {
			throw badRequest('The auto-close time has to be in the future');
		}
		const event = createEvent(getDb(), input, sha256Hex(hostToken), locals.accountId);
		return json({ code: event.code }, { status: 201 });
	} catch (e) {
		raise(e);
	}
};
