import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { endSession, SESSION_COOKIE } from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import { raise } from '$lib/server/http';

/** Clears the cookie first, so the browser forgets the session even if the row delete fails. */
export const POST: RequestHandler = ({ cookies }) => {
	try {
		const token = cookies.get(SESSION_COOKIE);
		cookies.delete(SESSION_COOKIE, { path: '/' });
		endSession(getDb(), token);
		return json({ ok: true });
	} catch (e) {
		raise(e);
	}
};
