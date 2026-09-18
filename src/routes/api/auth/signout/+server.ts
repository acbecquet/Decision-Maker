import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { endSession, SESSION_COOKIE } from '$lib/server/auth';
import { getDb } from '$lib/server/db';

export const POST: RequestHandler = ({ cookies }) => {
	endSession(getDb(), cookies.get(SESSION_COOKIE));
	cookies.delete(SESSION_COOKIE, { path: '/' });
	return json({ ok: true });
};
