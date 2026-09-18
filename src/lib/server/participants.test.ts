import { describe, expect, it } from 'vitest';
import { listOptions, stopSubmissions } from './events';
import {
	approveAllPending,
	countByStatus,
	countSubmitted,
	findParticipantByDevice,
	getMine,
	listRoster,
	setParticipantStatus,
	submitResponse,
	updateResponse
} from './participants';
import { readApprovedResponses } from './analysis/responses';
import { makeDb, makeEvent, response } from './test-utils';
import { eq } from 'drizzle-orm';
import { events, responses } from './db/schema';

const device = (n: number) => n.toString(16).padStart(64, '0');

function setup() {
	const db = makeDb();
	const event = makeEvent(db);
	const ids = listOptions(db, event.id).map((o) => o.id);
	return { db, event, ids };
}

describe('submitResponse', () => {
	it('creates a pending participant with the response', () => {
		const { db, event, ids } = setup();
		const p = submitResponse(
			db,
			event,
			ids,
			device(1),
			response('Alex', [ids[0], ids[1]], {
				vetoes: [ids[3]],
				budget: { kind: 'limit', amount: 30 },
				opinion: 'Tapas is central',
				suggestion: 'Flamenco'
			}),
			{ autoApprove: false }
		);
		expect(p.status).toBe('pending');
		expect(p.displayName).toBe('Alex');
		expect(findParticipantByDevice(db, event.id, device(1))?.id).toBe(p.id);
		expect(getMine(db, p)).toEqual({
			name: 'Alex',
			ranking: [ids[0], ids[1]],
			vetoes: [ids[3]],
			budget: { kind: 'limit', amount: 30 },
			opinion: 'Tapas is central',
			suggestion: 'Flamenco'
		});
	});

	it('auto-approves when asked', () => {
		const { db, event, ids } = setup();
		const p = submitResponse(db, event, ids, device(1), response('Host', [ids[0]]), {
			autoApprove: true
		});
		expect(p.status).toBe('approved');
	});

	it('refuses a second submission from the same device', () => {
		const { db, event, ids } = setup();
		submitResponse(db, event, ids, device(1), response('Alex', [ids[0]]), { autoApprove: false });
		expect(() =>
			submitResponse(db, event, ids, device(1), response('Alex again', [ids[0]]), {
				autoApprove: false
			})
		).toThrow(/already submitted/);
	});

	it('refuses unknown or repeated option ids', () => {
		const { db, event, ids } = setup();
		expect(() =>
			submitResponse(db, event, ids, device(1), response('Alex', ['nope']), { autoApprove: false })
		).toThrow(/unknown option/);
		expect(() =>
			submitResponse(db, event, ids, device(2), response('Sam', [ids[0], ids[0]]), {
				autoApprove: false
			})
		).toThrow(/repeats/);
	});

	it('refuses once submissions are closed', () => {
		const { db, ids } = setup();
		const event = stopSubmissions(db, makeEvent(db));
		expect(() =>
			submitResponse(db, event, ids, device(1), response('Alex', [ids[0]]), { autoApprove: false })
		).toThrow(/closed/);
	});

	it('refuses a submission or edit once the row is closed, even from a stale snapshot', () => {
		const { db, event, ids } = setup();
		const p = submitResponse(db, event, ids, device(1), response('Alex', [ids[0]]), {
			autoApprove: false
		});
		stopSubmissions(db, event);
		expect(() =>
			submitResponse(db, event, ids, device(2), response('Sam', [ids[0]]), { autoApprove: false })
		).toThrow(/closed/);
		expect(() =>
			updateResponse(db, event, ids, p, {
				ranking: [ids[1]],
				vetoes: [],
				budget: null,
				opinion: '',
				suggestion: ''
			})
		).toThrow(/closed/);
		expect(countSubmitted(db, event.id)).toBe(1);
	});
});

describe('updateResponse', () => {
	it('changes the response in place while open and refuses after close', () => {
		const { db, event, ids } = setup();
		const p = submitResponse(db, event, ids, device(1), response('Alex', [ids[0]]), {
			autoApprove: false
		});
		updateResponse(db, event, ids, p, {
			ranking: [ids[1], ids[0]],
			vetoes: [],
			budget: { kind: 'no_limit' },
			opinion: 'Changed my mind',
			suggestion: ''
		});
		expect(getMine(db, p)).toMatchObject({
			name: 'Alex',
			ranking: [ids[1], ids[0]],
			budget: { kind: 'no_limit' },
			opinion: 'Changed my mind'
		});
		const closed = stopSubmissions(db, event);
		expect(() =>
			updateResponse(db, closed, ids, p, {
				ranking: [ids[0]],
				vetoes: [],
				budget: null,
				opinion: '',
				suggestion: ''
			})
		).toThrow(/closed/);
	});
});

describe('roster', () => {
	it('lists names sorted case-insensitively with duplicate markers and no timestamps', () => {
		const { db, event, ids } = setup();
		submitResponse(db, event, ids, device(1), response('zoe', [ids[0]]), { autoApprove: false });
		submitResponse(db, event, ids, device(2), response('Alex', [ids[0]]), { autoApprove: false });
		submitResponse(db, event, ids, device(3), response('alex ', [ids[0]]), { autoApprove: false });
		const roster = listRoster(db, event.id);
		expect(roster.map((r) => r.name)).toEqual(['Alex', 'alex', 'zoe']);
		expect(roster.map((r) => r.duplicate)).toEqual([true, true, false]);
		expect(Object.keys(roster[0]).sort()).toEqual(['duplicate', 'id', 'name', 'status']);
	});

	it('approves and rejects individually and in bulk while the roster is open', () => {
		const { db, event, ids } = setup();
		const a = submitResponse(db, event, ids, device(1), response('A', [ids[0]]), {
			autoApprove: false
		});
		submitResponse(db, event, ids, device(2), response('B', [ids[0]]), { autoApprove: false });
		submitResponse(db, event, ids, device(3), response('C', [ids[0]]), { autoApprove: false });
		setParticipantStatus(db, event, a.id, 'rejected');
		expect(countByStatus(db, event.id, 'rejected')).toBe(1);
		expect(approveAllPending(db, event)).toBe(2);
		expect(countByStatus(db, event.id, 'approved')).toBe(2);
		expect(countByStatus(db, event.id, 'pending')).toBe(0);
		expect(countSubmitted(db, event.id)).toBe(3);
		expect(() => setParticipantStatus(db, event, 'missing', 'approved')).toThrow(/not found/);
	});

	it('refuses status changes once the roster is final, even from a stale snapshot', () => {
		const { db, event, ids } = setup();
		const a = submitResponse(db, event, ids, device(1), response('A', [ids[0]]), {
			autoApprove: false
		});
		db.update(events).set({ rosterFinal: true }).where(eq(events.id, event.id)).run();
		expect(() => setParticipantStatus(db, event, a.id, 'approved')).toThrow(/final/);
		expect(() => approveAllPending(db, event)).toThrow(/final/);
		expect(countByStatus(db, event.id, 'pending')).toBe(1);
	});
});

describe('readApprovedResponses', () => {
	it('returns approved responses only, with budgets mapped', () => {
		const { db, event, ids } = setup();
		const a = submitResponse(
			db,
			event,
			ids,
			device(1),
			response('A', [ids[0]], { budget: { kind: 'limit', amount: 20 }, opinion: 'cheap' }),
			{ autoApprove: false }
		);
		submitResponse(db, event, ids, device(2), response('B', [ids[1]]), { autoApprove: false });
		setParticipantStatus(db, event, a.id, 'approved');
		const rows = readApprovedResponses(db, event.id);
		expect(rows).toEqual([
			{
				participantId: a.id,
				ranking: [ids[0]],
				vetoes: [],
				budget: { kind: 'limit', amount: 20 },
				opinion: 'cheap',
				suggestion: ''
			}
		]);
	});
});

describe('getMine after the purge', () => {
	it('returns null instead of failing once the response row is gone', () => {
		const db = makeDb();
		const event = makeEvent(db);
		const ids = listOptions(db, event.id).map((o) => o.id);
		const p = submitResponse(db, event, ids, 'b'.repeat(64), response('Ana', [ids[0]]), {
			autoApprove: true
		});
		expect(getMine(db, p)).not.toBeNull();
		db.delete(responses).where(eq(responses.participantId, p.id)).run();
		expect(getMine(db, p)).toBeNull();
	});
});
