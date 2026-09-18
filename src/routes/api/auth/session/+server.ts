import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	claimEvents,
	redeemMagicLink,
	SESSION_COOKIE,
	SESSION_TTL_DAYS,
	SIGNIN_COOKIE
} from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import { raise, readJson } from '$lib/server/http';
import { sessionInput } from '$lib/shared/validation';

/** Turns a magic-link token into a session cookie and attaches the events this device hosts. */
export const POST: RequestHandler = async ({ request, cookies, url }) => {
	try {
		const db = getDb();
		const input = await readJson(request, sessionInput);
		const session = redeemMagicLink(db, input.token, cookies.get(SIGNIN_COOKIE));
		cookies.set(SESSION_COOKIE, session.sessionToken, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: url.protocol === 'https:',
			maxAge: SESSION_TTL_DAYS * 86_400
		});
		cookies.delete(SIGNIN_COOKIE, { path: '/' });
		const claimed = claimEvents(db, session.accountId, input.hostTokens);
		return json({ email: session.email, claimed });
	} catch (e) {
		raise(e);
	}
};
