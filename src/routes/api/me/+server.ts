import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { listAccountEvents } from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import { accounts } from '$lib/server/db/schema';
import { AppError } from '$lib/server/errors';
import { raise } from '$lib/server/http';

export const GET: RequestHandler = ({ locals }) => {
	try {
		if (!locals.accountId) throw new AppError(401, 'Not signed in');
		const db = getDb();
		const account = db.select().from(accounts).where(eq(accounts.id, locals.accountId)).get();
		if (!account) throw new AppError(401, 'Not signed in');
		return json({ email: account.email, events: listAccountEvents(db, account.id) });
	} catch (e) {
		raise(e);
	}
};
