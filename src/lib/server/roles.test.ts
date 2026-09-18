import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './crypto';
import { accounts, events } from './db/schema';
import { listOptions } from './events';
import { submitResponse } from './participants';
import { isHost, participantFromRequest, requireHost, tokenFromHeader } from './roles';
import { makeDb, makeEvent, response } from './test-utils';

const hostToken = 'b'.repeat(64);
const deviceToken = 'c'.repeat(64);

const req = (headers: Record<string, string>) =>
	new Request('http://localhost/api/events/x', { headers });

describe('tokenFromHeader', () => {
	it('returns well-formed tokens only', () => {
		expect(tokenFromHeader(req({ 'x-host-token': hostToken }), 'x-host-token')).toBe(hostToken);
		expect(tokenFromHeader(req({ 'x-host-token': 'short' }), 'x-host-token')).toBeNull();
		expect(tokenFromHeader(req({}), 'x-host-token')).toBeNull();
	});
});

describe('isHost', () => {
	it('matches the hash of the host token and nothing else', () => {
		const db = makeDb();
		const event = { ...makeEvent(db), hostTokenHash: sha256Hex(hostToken) };
		expect(isHost(event, req({ 'x-host-token': hostToken }))).toBe(true);
		expect(isHost(event, req({ 'x-host-token': 'd'.repeat(64) }))).toBe(false);
		expect(isHost(event, req({}))).toBe(false);
		expect(() => requireHost(event, req({}))).toThrow(/Host only/);
	});
});

describe('isHost with an account session', () => {
	it('accepts the owning account without a token and rejects other accounts', () => {
		const db = makeDb();
		const event = makeEvent(db);
		// events.accountId has a foreign key to accounts.id, so the row must exist first.
		db.insert(accounts)
			.values({ id: 'acc-1', email: 'acc-1@example.test', createdAt: new Date().toISOString() })
			.run();
		db.update(events).set({ accountId: 'acc-1' }).where(eq(events.id, event.id)).run();
		const owned = { ...event, accountId: 'acc-1' };
		const bare = new Request('http://x.test/');
		expect(isHost(owned, bare, 'acc-1')).toBe(true);
		expect(isHost(owned, bare, 'acc-2')).toBe(false);
		expect(isHost(owned, bare, null)).toBe(false);
		expect(isHost({ ...event, accountId: null }, bare, 'acc-1')).toBe(false);
	});
});

describe('participantFromRequest', () => {
	it('finds the participant by the hashed device token', () => {
		const db = makeDb();
		const event = makeEvent(db);
		const ids = listOptions(db, event.id).map((o) => o.id);
		const p = submitResponse(db, event, ids, sha256Hex(deviceToken), response('Alex', [ids[0]]), {
			autoApprove: false
		});
		expect(participantFromRequest(db, event, req({ 'x-participant-token': deviceToken }))?.id).toBe(
			p.id
		);
		expect(
			participantFromRequest(db, event, req({ 'x-participant-token': 'e'.repeat(64) }))
		).toBeUndefined();
		expect(participantFromRequest(db, event, req({}))).toBeUndefined();
	});
});
