import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';

/** The commit baked into the image at build time, so one request settles what is live. */
const commit = process.env.APP_COMMIT || 'unknown';
/** The public origin the server was configured with, which sign-in links are built from. */
const origin = process.env.ORIGIN ?? null;

export const GET: RequestHandler = () => {
	getDb().get(sql`select 1`);
	return json({ ok: true, commit, origin });
};
