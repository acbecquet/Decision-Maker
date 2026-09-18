import { and, eq, inArray } from 'drizzle-orm';
import { EVENT_TTL_DAYS } from '$lib/shared/constants';
import { isRunning } from './analysis/job';
import type { Db } from './db';
import { anonymizedPoints, events, participants, responses, type EventRow } from './db/schema';
import { conflict } from './errors';
import { addDays, getEventById } from './events';

/**
 * Publishes the draft: deletes every raw response and anonymized point of the event in the same
 * transaction that flips the state, so nothing raw survives a published event. Participants stay,
 * so approved devices keep opening the report. There is no unpublish.
 */
export function publishEvent(db: Db, event: EventRow, now = new Date()): EventRow {
	return db.transaction((tx) => {
		const current = getEventById(tx, event.id);
		if (current.state === 'published') throw conflict('The results are already published');
		if (!current.rosterFinal || !current.report)
			throw conflict('Run the analysis before publishing');
		if (isRunning(current.id)) throw conflict('An analysis is still running');
		const members = tx
			.select({ id: participants.id })
			.from(participants)
			.where(eq(participants.eventId, current.id));
		tx.delete(responses).where(inArray(responses.participantId, members)).run();
		tx.delete(anonymizedPoints).where(eq(anonymizedPoints.eventId, current.id)).run();
		const result = tx
			.update(events)
			.set({
				state: 'published',
				publishedAt: now.toISOString(),
				expiresAt: addDays(now, EVENT_TTL_DAYS).toISOString()
			})
			.where(and(eq(events.id, current.id), eq(events.state, 'closed')))
			.run();
		if (result.changes === 0) throw conflict('The results are already published');
		return getEventById(tx, current.id);
	});
}
