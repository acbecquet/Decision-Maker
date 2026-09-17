import { describe, expect, it } from 'vitest';
import { sha256Hex } from './crypto';
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
