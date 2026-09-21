import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';

/** The commit baked into the image at build time, so one request settles what is live. */
const commit = process.env.APP_COMMIT || 'unknown';

export const GET: RequestHandler = () => {
	getDb().get(sql`select 1`);
	return json({ ok: true, commit });
};
