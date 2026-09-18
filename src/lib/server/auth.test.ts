import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
	accountIdForSession,
	claimEvents,
	createMagicLink,
	endSession,
	listAccountEvents,
	redeemMagicLink
} from './auth';
import { sha256Hex } from './crypto';
import { accounts, events, magicLinks } from './db/schema';
import { getEventById, listOptions } from './events';
import { submitResponse } from './participants';
import { HOST_HASH, makeDb, makeEvent, response } from './test-utils';

const t0 = new Date('2026-09-18T10:00:00.000Z');
const later = (ms: number) => new Date(t0.getTime() + ms);

describe('magic links and sessions', () => {
	it('creates a hashed single-use link that signs in once and creates the account', () => {
		const db = makeDb();
		const { token, email } = createMagicLink(db, '  Charlie@Example.com ', t0);
		expect(token).toMatch(/^[0-9a-f]{64}$/);
		expect(email).toBe('charlie@example.com');
		const row = db.select().from(magicLinks).get()!;
		expect(row.tokenHash).toBe(sha256Hex(token));
		expect(row.expiresAt).toBe('2026-09-18T10:15:00.000Z');
		expect(row.usedAt).toBeNull();

		const session = redeemMagicLink(db, token, later(60_000));
		expect(session.sessionToken).toMatch(/^[0-9a-f]{64}$/);
		expect(session.email).toBe('charlie@example.com');
		expect(db.select().from(accounts).all()).toHaveLength(1);
		expect(accountIdForSession(db, session.sessionToken, later(120_000))).toBe(session.accountId);
		expect(() => redeemMagicLink(db, token, later(120_000))).toThrow(/already been used/);
	});

	it('rejects expired, unknown, and malformed links', () => {
		const db = makeDb();
		const { token } = createMagicLink(db, 'a@b.co', t0);
		expect(() => redeemMagicLink(db, token, later(15 * 60_000 + 1))).toThrow(/expired/);
		expect(() => redeemMagicLink(db, 'f'.repeat(64), t0)).toThrow(/not valid/);
		expect(() => redeemMagicLink(db, 'short', t0)).toThrow(/not valid/);
	});

	it('reuses the account for the same email and expires sessions after ninety days', () => {
		const db = makeDb();
		const first = redeemMagicLink(db, createMagicLink(db, 'a@b.co', t0).token, t0);
		const second = redeemMagicLink(db, createMagicLink(db, 'A@B.CO', t0).token, t0);
		expect(second.accountId).toBe(first.accountId);
		expect(accountIdForSession(db, first.sessionToken, later(89 * 86_400_000))).toBe(
			first.accountId
		);
		expect(accountIdForSession(db, first.sessionToken, later(90 * 86_400_000 + 1))).toBeNull();
		expect(accountIdForSession(db, 'not-a-token', t0)).toBeNull();
		endSession(db, second.sessionToken);
		expect(accountIdForSession(db, second.sessionToken, t0)).toBeNull();
		expect(accountIdForSession(db, first.sessionToken, t0)).toBe(first.accountId);
	});
});

describe('claiming and listing events', () => {
	it('attaches unowned events whose host token matches and lists them newest first', () => {
		const db = makeDb();
		const mine = makeEvent(db, { title: 'Mine' });
		const other = makeEvent(db, { title: 'Theirs' });
		const hostToken = 'c'.repeat(64);
		db.update(events)
			.set({ hostTokenHash: sha256Hex(hostToken), createdAt: '2026-09-18T11:00:00.000Z' })
			.where(eq(events.id, mine.id))
			.run();
		const { accountId } = redeemMagicLink(db, createMagicLink(db, 'a@b.co', t0).token, t0);
		expect(claimEvents(db, accountId, [hostToken, 'garbage', 'd'.repeat(64)])).toBe(1);
		expect(getEventById(db, mine.id).accountId).toBe(accountId);
		expect(getEventById(db, other.id).accountId).toBeNull();
		expect(claimEvents(db, accountId, [hostToken])).toBe(0);

		const ids = listOptions(db, mine.id).map((o) => o.id);
		submitResponse(db, mine, ids, 'e'.repeat(64), response('Ana', [ids[0]]), {
			autoApprove: false
		});
		const owned = makeEvent(db, { title: 'Owned' });
		db.update(events)
			.set({ accountId, createdAt: '2026-09-18T12:00:00.000Z' })
			.where(eq(events.id, owned.id))
			.run();
		expect(listAccountEvents(db, accountId)).toEqual([
			{
				code: owned.code,
				title: 'Owned',
				state: 'open',
				submittedCount: 0,
				createdAt: '2026-09-18T12:00:00.000Z'
			},
			{
				code: mine.code,
				title: 'Mine',
				state: 'open',
				submittedCount: 1,
				createdAt: '2026-09-18T11:00:00.000Z'
			}
		]);
		expect(HOST_HASH).toHaveLength(64);
	});

	it('does not move an event that another account already owns', () => {
		const db = makeDb();
		const event = makeEvent(db);
		const hostToken = 'c'.repeat(64);
		db.update(events)
			.set({ hostTokenHash: sha256Hex(hostToken) })
			.where(eq(events.id, event.id))
			.run();
		const a = redeemMagicLink(db, createMagicLink(db, 'a@b.co', t0).token, t0);
		const b = redeemMagicLink(db, createMagicLink(db, 'b@b.co', t0).token, t0);
		expect(claimEvents(db, a.accountId, [hostToken])).toBe(1);
		expect(claimEvents(db, b.accountId, [hostToken])).toBe(0);
		expect(getEventById(db, event.id).accountId).toBe(a.accountId);
	});
});
