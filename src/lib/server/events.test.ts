import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { EVENT_CODE_ALPHABET } from '$lib/shared/constants';
import { openDatabase } from './db';
import { accounts, options, participants, responses } from './db/schema';
import {
	closeDueEvents,
	createEvent,
	deleteEvent,
	deleteExpiredEvents,
	findEventByCode,
	listOptions,
	refreshState,
	setClosesAt,
	stopSubmissions,
	toEventView,
	updateEvent
} from './events';
import { submitResponse } from './participants';

const input = {
	title: 'Saturday night',
	context: 'Dinner',
	currency: 'EUR' as const,
	options: [
		{ label: 'Tapas', note: '', cost: 25 },
		{ label: 'Beach', note: 'towels', cost: null }
	],
	closesAt: null
};
const hash = 'a'.repeat(64);

describe('createEvent', () => {
	it('stores the event with a code, ordered options, and a 90-day expiry', () => {
		const db = openDatabase(':memory:');
		const now = new Date('2026-09-17T10:00:00.000Z');
		const event = createEvent(db, input, hash, null, now);
		expect(event.code).toHaveLength(10);
		for (const ch of event.code) expect(EVENT_CODE_ALPHABET).toContain(ch);
		expect(event.state).toBe('open');
		expect(event.rosterFinal).toBe(false);
		expect(event.hostTokenHash).toBe(hash);
		expect(event.expiresAt).toBe('2026-12-16T10:00:00.000Z');
		const opts = listOptions(db, event.id);
		expect(opts.map((o) => o.label)).toEqual(['Tapas', 'Beach']);
		expect(opts.map((o) => o.costPerPerson)).toEqual([25, null]);
		expect(findEventByCode(db, event.code)?.id).toBe(event.id);
	});

	it('normalizes closesAt to a UTC instant', () => {
		const db = openDatabase(':memory:');
		const event = createEvent(db, { ...input, closesAt: '2026-09-18T12:00:00+02:00' }, hash);
		expect(event.closesAt).toBe('2026-09-18T10:00:00.000Z');
	});
});

describe('setClosesAt', () => {
	it('updates while open and refuses once closed', () => {
		const db = openDatabase(':memory:');
		let event = createEvent(db, input, hash);
		event = setClosesAt(db, event, '2026-09-18T10:00:00.000Z');
		expect(event.closesAt).toBe('2026-09-18T10:00:00.000Z');
		event = setClosesAt(db, event, null);
		expect(event.closesAt).toBeNull();
		event = stopSubmissions(db, event);
		expect(() => setClosesAt(db, event, null)).toThrow(/already closed/);
	});
});

describe('auto-close', () => {
	it('closes only events whose deadline has passed and leaves the roster open', () => {
		const db = openDatabase(':memory:');
		const now = new Date('2026-09-17T10:00:00.000Z');
		const due = createEvent(
			db,
			{ ...input, closesAt: '2026-09-17T09:59:00.000Z' },
			hash,
			null,
			now
		);
		const later = createEvent(
			db,
			{ ...input, closesAt: '2026-09-17T10:01:00.000Z' },
			hash,
			null,
			now
		);
		const never = createEvent(db, input, hash, null, now);
		expect(closeDueEvents(db, now)).toBe(1);
		const closed = findEventByCode(db, due.code);
		expect(closed?.state).toBe('closed');
		expect(closed?.closedAt).toBe(now.toISOString());
		expect(closed?.rosterFinal).toBe(false);
		expect(findEventByCode(db, later.code)?.state).toBe('open');
		expect(findEventByCode(db, never.code)?.state).toBe('open');
		expect(closeDueEvents(db, now)).toBe(0);
	});

	it('refreshState closes lazily on read', () => {
		const db = openDatabase(':memory:');
		const event = createEvent(db, { ...input, closesAt: '2026-09-17T09:59:00.000Z' }, hash);
		expect(refreshState(db, event, new Date('2026-09-17T09:58:00.000Z')).state).toBe('open');
		expect(refreshState(db, event, new Date('2026-09-17T10:00:00.000Z')).state).toBe('closed');
	});
});

describe('toEventView', () => {
	it('exposes only public fields', () => {
		const db = openDatabase(':memory:');
		const event = createEvent(db, input, hash);
		const view = toEventView(event, listOptions(db, event.id));
		expect(Object.keys(view).sort()).toEqual([
			'closedAt',
			'closesAt',
			'code',
			'context',
			'currency',
			'options',
			'rosterFinal',
			'state',
			'title'
		]);
		expect(view.options[0]).toEqual({ id: expect.any(String), label: 'Tapas', note: '', cost: 25 });
	});
});

describe('updateEvent', () => {
	const edit = {
		title: 'Sunday brunch',
		context: 'Late start',
		currency: 'USD' as const,
		options: [
			{ label: 'Cafe', note: '', cost: 12 },
			{ label: 'Market', note: 'Outdoor', cost: null }
		],
		closesAt: null
	};

	it('replaces the details and options and rotates the code, keeping the id and host', () => {
		const db = openDatabase(':memory:');
		const event = createEvent(db, input, hash);
		const updated = updateEvent(db, event, edit);
		expect(updated.id).toBe(event.id);
		expect(updated.code).not.toBe(event.code);
		expect(updated.code).toMatch(/^[0-9a-hj-kmnp-tv-z]{10}$/);
		expect(updated.hostTokenHash).toBe(hash);
		expect(updated).toMatchObject({
			title: 'Sunday brunch',
			context: 'Late start',
			currency: 'USD',
			state: 'open',
			closesAt: null
		});
		expect(findEventByCode(db, event.code)).toBeUndefined();
		expect(findEventByCode(db, updated.code)?.id).toBe(event.id);
		expect(
			listOptions(db, event.id).map((o) => [o.position, o.label, o.note, o.costPerPerson])
		).toEqual([
			[0, 'Cafe', '', 12],
			[1, 'Market', 'Outdoor', null]
		]);
	});

	it('stores the auto-close time as a UTC instant', () => {
		const db = openDatabase(':memory:');
		const event = createEvent(db, input, hash);
		const updated = updateEvent(db, event, { ...edit, closesAt: '2030-01-01T10:00:00+02:00' });
		expect(updated.closesAt).toBe('2030-01-01T08:00:00.000Z');
	});

	it('refuses once anyone has submitted, even from a stale snapshot', () => {
		const db = openDatabase(':memory:');
		const event = createEvent(db, input, hash);
		const ids = listOptions(db, event.id).map((o) => o.id);
		submitResponse(
			db,
			event,
			ids,
			'b'.repeat(64),
			{ name: 'Ana', ranking: [ids[0]], vetoes: [], budget: null, opinion: '', suggestion: '' },
			{ autoApprove: false }
		);
		expect(() => updateEvent(db, event, edit)).toThrow(/already submitted/);
		expect(findEventByCode(db, event.code)?.title).toBe('Saturday night');
		expect(listOptions(db, event.id)).toHaveLength(2);
	});

	it('refuses after submissions have stopped', () => {
		const db = openDatabase(':memory:');
		const event = createEvent(db, input, hash);
		stopSubmissions(db, event);
		expect(() => updateEvent(db, event, edit)).toThrow(/closed/);
	});
});

describe('deleteEvent and deleteExpiredEvents', () => {
	it('removes the event with its options, participants, and responses', () => {
		const db = openDatabase(':memory:');
		const event = createEvent(db, input, hash);
		const ids = listOptions(db, event.id).map((o) => o.id);
		submitResponse(
			db,
			event,
			ids,
			'b'.repeat(64),
			{ name: 'Ana', ranking: [ids[0]], vetoes: [], budget: null, opinion: 'x', suggestion: '' },
			{ autoApprove: false }
		);
		deleteEvent(db, event);
		expect(findEventByCode(db, event.code)).toBeUndefined();
		expect(db.select().from(options).where(eq(options.eventId, event.id)).all()).toEqual([]);
		expect(db.select().from(participants).where(eq(participants.eventId, event.id)).all()).toEqual(
			[]
		);
		expect(db.select().from(responses).all()).toEqual([]);
	});

	it('sweeps expired events that no account owns and leaves the rest', () => {
		const db = openDatabase(':memory:');
		const now = new Date('2026-09-18T12:00:00.000Z');
		const stale = createEvent(db, input, hash, null, new Date('2026-06-01T00:00:00.000Z'));
		// events.accountId has a foreign key to accounts.id, so the row must exist first.
		db.insert(accounts)
			.values({ id: 'acc-1', email: 'acc-1@example.test', createdAt: now.toISOString() })
			.run();
		const owned = createEvent(db, input, hash, 'acc-1', new Date('2026-06-01T00:00:00.000Z'));
		const fresh = createEvent(db, input, hash, null, new Date('2026-09-01T00:00:00.000Z'));
		expect(deleteExpiredEvents(db, now)).toBe(1);
		expect(findEventByCode(db, stale.code)).toBeUndefined();
		expect(findEventByCode(db, owned.code)).toBeDefined();
		expect(findEventByCode(db, fresh.code)).toBeDefined();
		expect(deleteExpiredEvents(db, now)).toBe(0);
	});
});
