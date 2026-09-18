import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { isTokenShape, newId, sha256Hex } from './crypto';
import type { DbLike } from './db';
import { accounts, events, magicLinks, participants, sessions } from './db/schema';
import { badRequest } from './errors';
import { addDays } from './events';
import { normalizeEmail } from './mail';
import type { EventState } from '$lib/shared/types';
import { randomBytes } from 'node:crypto';

export const MAGIC_LINK_TTL_MS = 15 * 60_000;
export const SESSION_TTL_DAYS = 90;
export const SESSION_COOKIE = 'dm_session';

export type AccountEvent = {
	code: string;
	title: string;
	state: EventState;
	submittedCount: number;
	createdAt: string;
};

const newSecret = () => randomBytes(32).toString('hex');

/** Stores the hash of a fresh single-use token for the address and returns the token for the mailer. */
export function createMagicLink(
	db: DbLike,
	rawEmail: string,
	now = new Date()
): { token: string; email: string } {
	const email = normalizeEmail(rawEmail);
	const token = newSecret();
	db.insert(magicLinks)
		.values({
			tokenHash: sha256Hex(token),
			email,
			expiresAt: new Date(now.getTime() + MAGIC_LINK_TTL_MS).toISOString()
		})
		.run();
	return { token, email };
}

/** Marks the link used, creates the account on first sign-in, and opens a ninety-day session. */
export function redeemMagicLink(
	db: DbLike,
	token: string,
	now = new Date()
): { sessionToken: string; accountId: string; email: string } {
	if (!isTokenShape(token)) throw badRequest('This sign-in link is not valid');
	const hash = sha256Hex(token);
	const nowIso = now.toISOString();
	return db.transaction((tx) => {
		const link = tx.select().from(magicLinks).where(eq(magicLinks.tokenHash, hash)).get();
		if (!link) throw badRequest('This sign-in link is not valid');
		if (link.usedAt) throw badRequest('This sign-in link has already been used');
		if (link.expiresAt <= nowIso) throw badRequest('This sign-in link has expired');
		// The single-use guard lives in the write itself, so two redemptions can never both succeed.
		const claimed = tx
			.update(magicLinks)
			.set({ usedAt: nowIso })
			.where(and(eq(magicLinks.tokenHash, hash), isNull(magicLinks.usedAt)))
			.run();
		if (claimed.changes === 0) throw badRequest('This sign-in link has already been used');
		tx.insert(accounts)
			.values({ id: newId(), email: link.email, createdAt: nowIso })
			.onConflictDoNothing({ target: accounts.email })
			.run();
		const account = tx.select().from(accounts).where(eq(accounts.email, link.email)).get()!;
		const sessionToken = newSecret();
		tx.insert(sessions)
			.values({
				tokenHash: sha256Hex(sessionToken),
				accountId: account.id,
				expiresAt: addDays(now, SESSION_TTL_DAYS).toISOString()
			})
			.run();
		return { sessionToken, accountId: account.id, email: account.email };
	});
}

/** The account behind a session cookie value, or null when missing, malformed, unknown, or expired. */
export function accountIdForSession(
	db: DbLike,
	sessionToken: string | undefined,
	now = new Date()
): string | null {
	if (!isTokenShape(sessionToken)) return null;
	const row = db
		.select()
		.from(sessions)
		.where(eq(sessions.tokenHash, sha256Hex(sessionToken)))
		.get();
	if (!row || row.expiresAt <= now.toISOString()) return null;
	return row.accountId;
}

export function endSession(db: DbLike, sessionToken: string | undefined): void {
	if (!isTokenShape(sessionToken)) return;
	db.delete(sessions)
		.where(eq(sessions.tokenHash, sha256Hex(sessionToken)))
		.run();
}

/** Attaches every unowned event whose host token is among the given ones. Returns how many moved. */
export function claimEvents(db: DbLike, accountId: string, hostTokens: string[]): number {
	let claimed = 0;
	for (const token of hostTokens) {
		if (!isTokenShape(token)) continue;
		claimed += db
			.update(events)
			.set({ accountId })
			.where(and(eq(events.hostTokenHash, sha256Hex(token)), isNull(events.accountId)))
			.run().changes;
	}
	return claimed;
}

/** The account's events, newest first, with how many people have submitted. */
export function listAccountEvents(db: DbLike, accountId: string): AccountEvent[] {
	return db
		.select({
			code: events.code,
			title: events.title,
			state: events.state,
			submittedCount: sql<number>`(${db.select({ n: count() }).from(participants).where(eq(participants.eventId, events.id))})`,
			createdAt: events.createdAt
		})
		.from(events)
		.where(eq(events.accountId, accountId))
		.orderBy(desc(events.createdAt))
		.all();
}
