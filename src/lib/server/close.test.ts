import { describe, expect, it } from 'vitest';
import { finalizeRoster } from './close';
import { getEventById, listOptions, stopSubmissions } from './events';
import {
	approveAllPending,
	countByStatus,
	setParticipantStatus,
	submitResponse
} from './participants';
import { makeDb, makeEvent, response } from './test-utils';

const device = (n: number) => n.toString(16).padStart(64, '0');

function withThree() {
	const db = makeDb();
	const event = makeEvent(db);
	const ids = listOptions(db, event.id).map((o) => o.id);
	const people = [1, 2, 3].map((n) =>
		submitResponse(db, event, ids, device(n), response(`P${n}`, [ids[n % ids.length]]), {
			autoApprove: false
		})
	);
	return { db, event, ids, people };
}

describe('finalizeRoster', () => {
	it('approves pending names, freezes aggregates, and makes the close final', () => {
		const { db, event, people } = withThree();
		setParticipantStatus(db, event, people[0].id, 'rejected');
		const now = new Date('2026-09-17T12:00:00.000Z');
		const closed = finalizeRoster(db, event, 'approve', now);
		expect(closed.state).toBe('closed');
		expect(closed.rosterFinal).toBe(true);
		expect(closed.closedAt).toBe(now.toISOString());
		expect(countByStatus(db, event.id, 'approved')).toBe(2);
		expect(countByStatus(db, event.id, 'rejected')).toBe(1);
		expect(closed.aggregates?.approvedCount).toBe(2);
	});

	it('can reject the pending names instead', () => {
		const { db, event, people } = withThree();
		setParticipantStatus(db, event, people[0].id, 'approved');
		const closed = finalizeRoster(db, event, 'reject');
		expect(countByStatus(db, event.id, 'approved')).toBe(1);
		expect(countByStatus(db, event.id, 'rejected')).toBe(2);
		expect(closed.aggregates?.approvedCount).toBe(1);
	});

	it('keeps the auto-close time when finalizing an already stopped event', () => {
		const { db, event } = withThree();
		const stoppedAt = new Date('2026-09-17T11:00:00.000Z');
		const stopped = stopSubmissions(db, event, stoppedAt);
		const closed = finalizeRoster(db, stopped, 'approve', new Date('2026-09-17T12:00:00.000Z'));
		expect(closed.closedAt).toBe(stoppedAt.toISOString());
		expect(closed.rosterFinal).toBe(true);
	});

	it('is a one-way door', () => {
		const { db, event, people } = withThree();
		const closed = finalizeRoster(db, event, 'approve');
		expect(() => finalizeRoster(db, closed, 'approve')).toThrow(/already closed/);
		expect(() => setParticipantStatus(db, closed, people[0].id, 'rejected')).toThrow(/final/);
		expect(() => approveAllPending(db, closed)).toThrow(/final/);
	});

	it('refuses a finalize made from a stale snapshot and keeps the first closedAt', () => {
		const { db, event } = withThree();
		const first = finalizeRoster(db, event, 'approve', new Date('2026-09-17T12:00:00.000Z'));
		expect(() =>
			finalizeRoster(db, event, 'approve', new Date('2026-09-17T13:00:00.000Z'))
		).toThrow(/already closed/);
		expect(getEventById(db, event.id).closedAt).toBe(first.closedAt);
		expect(getEventById(db, event.id).rosterFinal).toBe(true);
	});
});
