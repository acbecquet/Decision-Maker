import { and, asc, count, eq, lte } from 'drizzle-orm';
import type { Db, DbLike } from './db';
import { events, options, participants, type EventRow, type OptionRow } from './db/schema';
import { newEventCode, newId } from './crypto';
import { conflict, notFound } from './errors';
import { EVENT_TTL_DAYS } from '$lib/shared/constants';
import type { EventView } from '$lib/shared/types';
import type { CreateEventInput } from '$lib/shared/validation';

export function addDays(date: Date, days: number): Date {
	return new Date(date.getTime() + days * 86_400_000);
}

/** Normalizes any parseable date string to a UTC ISO instant so string comparison is chronological. */
export function toIso(value: string): string {
	return new Date(value).toISOString();
}

export function createEvent(
	db: Db,
	input: CreateEventInput,
	hostTokenHash: string,
	now = new Date()
): EventRow {
	const id = newId();
	const code = newEventCode();
	db.transaction((tx) => {
		tx.insert(events)
			.values({
				id,
				code,
				title: input.title,
				context: input.context,
				currency: input.currency,
				hostTokenHash,
				closesAt: input.closesAt ? toIso(input.closesAt) : null,
				expiresAt: addDays(now, EVENT_TTL_DAYS).toISOString(),
				createdAt: now.toISOString()
			})
			.run();
		tx.insert(options)
			.values(
				input.options.map((o, position) => ({
					id: newId(),
					eventId: id,
					position,
					label: o.label,
					note: o.note,
					costPerPerson: o.cost
				}))
			)
			.run();
	});
	return getEventById(db, id);
}

/**
 * Replaces the event's details and options and rotates its code, so the old link stops working.
 * Allowed only while the event is open and nobody has submitted.
 * The guard reads the live row inside the transaction, so a submission that lands during body
 * parsing is honoured, and the host token hash is untouched so the creating device stays the host.
 */
export function updateEvent(db: Db, event: EventRow, input: CreateEventInput): EventRow {
	return db.transaction((tx) => {
		const current = getEventById(tx, event.id);
		if (current.state !== 'open') throw conflict('Submissions are closed');
		const submitted =
			tx.select({ n: count() }).from(participants).where(eq(participants.eventId, current.id)).get()
				?.n ?? 0;
		if (submitted > 0) throw conflict('Someone has already submitted, so the event cannot change');
		tx.delete(options).where(eq(options.eventId, current.id)).run();
		tx.insert(options)
			.values(
				input.options.map((o, position) => ({
					id: newId(),
					eventId: current.id,
					position,
					label: o.label,
					note: o.note,
					costPerPerson: o.cost
				}))
			)
			.run();
		tx.update(events)
			.set({
				code: newEventCode(),
				title: input.title,
				context: input.context,
				currency: input.currency,
				closesAt: input.closesAt ? toIso(input.closesAt) : null
			})
			.where(eq(events.id, current.id))
			.run();
		return getEventById(tx, current.id);
	});
}

export function getEventById(db: DbLike, id: string): EventRow {
	const row = db.select().from(events).where(eq(events.id, id)).get();
	if (!row) throw notFound('Event not found');
	return row;
}

export function findEventByCode(db: DbLike, code: string): EventRow | undefined {
	return db.select().from(events).where(eq(events.code, code)).get();
}

export function listOptions(db: DbLike, eventId: string): OptionRow[] {
	return db
		.select()
		.from(options)
		.where(eq(options.eventId, eventId))
		.orderBy(asc(options.position))
		.all();
}

export function setClosesAt(db: DbLike, event: EventRow, closesAt: string | null): EventRow {
	if (event.state !== 'open') throw conflict('Submissions are already closed');
	db.update(events)
		.set({ closesAt: closesAt ? toIso(closesAt) : null })
		.where(eq(events.id, event.id))
		.run();
	return getEventById(db, event.id);
}

/** Stops accepting submissions without finalizing the roster. Used by auto-close and by the close endpoint. */
export function stopSubmissions(db: DbLike, event: EventRow, now = new Date()): EventRow {
	if (event.state !== 'open') return event;
	db.update(events)
		.set({ state: 'closed', closedAt: now.toISOString() })
		.where(and(eq(events.id, event.id), eq(events.state, 'open')))
		.run();
	return getEventById(db, event.id);
}

/** Closes every open event whose auto-close time has passed. Returns how many it closed. */
export function closeDueEvents(db: DbLike, now = new Date()): number {
	const due = db
		.select()
		.from(events)
		.where(and(eq(events.state, 'open'), lte(events.closesAt, now.toISOString())))
		.all();
	for (const event of due) stopSubmissions(db, event, now);
	return due.length;
}

/** Applies a passed auto-close deadline on read, so it is honoured even between timer ticks. */
export function refreshState(db: DbLike, event: EventRow, now = new Date()): EventRow {
	if (event.state === 'open' && event.closesAt && event.closesAt <= now.toISOString()) {
		return stopSubmissions(db, event, now);
	}
	return event;
}

export function toEventView(event: EventRow, opts: OptionRow[]): EventView {
	return {
		code: event.code,
		title: event.title,
		context: event.context,
		currency: event.currency,
		state: event.state,
		rosterFinal: event.rosterFinal,
		closesAt: event.closesAt,
		closedAt: event.closedAt,
		options: opts.map((o) => ({ id: o.id, label: o.label, note: o.note, cost: o.costPerPerson }))
	};
}
