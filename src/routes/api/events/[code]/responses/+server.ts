import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sha256Hex } from '$lib/server/crypto';
import { getDb } from '$lib/server/db';
import { badRequest, forbidden } from '$lib/server/errors';
import { listOptions } from '$lib/server/events';
import { raise, readJson } from '$lib/server/http';
import { submitResponse, updateResponse } from '$lib/server/participants';
import { enforce } from '$lib/server/ratelimit';
import { isHost, participantFromRequest, tokenFromHeader } from '$lib/server/roles';
import { loadEventOr404 } from '$lib/server/views';
import { editResponseInput, responseInput } from '$lib/shared/validation';

export const POST: RequestHandler = async ({ params, request, getClientAddress }) => {
	try {
		enforce(`submit:${params.code}:${getClientAddress()}`, 10, 60_000);
		const db = getDb();
		const event = loadEventOr404(db, params.code);
		const participantToken = tokenFromHeader(request, 'x-participant-token');
		if (!participantToken) throw badRequest('Missing participant token');
		const input = await readJson(request, responseInput);
		const ids = listOptions(db, event.id).map((o) => o.id);
		const participant = submitResponse(db, event, ids, sha256Hex(participantToken), input, {
			autoApprove: isHost(event, request)
		});
		return json({ participantId: participant.id }, { status: 201 });
	} catch (e) {
		raise(e);
	}
};

export const PUT: RequestHandler = async ({ params, request }) => {
	try {
		const db = getDb();
		const event = loadEventOr404(db, params.code);
		const participant = participantFromRequest(db, event, request);
		if (!participant) throw forbidden('No submission from this device');
		const input = await readJson(request, editResponseInput);
		const ids = listOptions(db, event.id).map((o) => o.id);
		updateResponse(db, event, ids, participant, input);
		return json({ ok: true });
	} catch (e) {
		raise(e);
	}
};
