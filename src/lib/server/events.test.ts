import { describe, expect, it } from 'vitest';
import { EVENT_CODE_ALPHABET } from '$lib/shared/constants';
import { openDatabase } from './db';
import {
	closeDueEvents,
	createEvent,
	findEventByCode,
	listOptions,
	refreshState,
	setClosesAt,
	stopSubmissions,
	toEventView
} from './events';

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
		const event = createEvent(db, input, hash, now);
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
		const due = createEvent(db, { ...input, closesAt: '2026-09-17T09:59:00.000Z' }, hash, now);
		const later = createEvent(db, { ...input, closesAt: '2026-09-17T10:01:00.000Z' }, hash, now);
		const never = createEvent(db, input, hash, now);
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
