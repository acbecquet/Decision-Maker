import type { Handle, ServerInit } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { closeDueEvents } from '$lib/server/events';
import { limiter } from '$lib/server/ratelimit';

/** Runs once at startup: opens the database (applying migrations) and starts the auto-close tick. */
export const init: ServerInit = async () => {
	const db = getDb();
	const tick = () => {
		try {
			closeDueEvents(db);
			limiter.prune();
		} catch (e) {
			console.error('auto-close tick failed', e instanceof Error ? e.message : e);
		}
	};
	tick();
	setInterval(tick, 60_000).unref();
};

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	response.headers.set('x-content-type-options', 'nosniff');
	response.headers.set('referrer-policy', 'no-referrer');
	response.headers.set('x-frame-options', 'DENY');
	return response;
};
