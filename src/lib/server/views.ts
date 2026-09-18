import { presentTallies } from './analysis/aggregate';
import type { Db } from './db';
import type { EventRow } from './db/schema';
import { notFound } from './errors';
import { findEventByCode, listOptions, refreshState, toEventView } from './events';
import { countByStatus, countSubmitted, getMine, listRoster } from './participants';
import { isHost, participantFromRequest } from './roles';
import type { EventPageView } from '$lib/shared/types';

/** Loads the event by public code, applying a passed auto-close deadline on the way. */
export function loadEventOr404(db: Db, code: string | undefined, now = new Date()): EventRow {
	const event = code ? findEventByCode(db, code) : undefined;
	if (!event) throw notFound('Event not found');
	return refreshState(db, event, now);
}

/** The role-aware view of an event. The host block never contains rankings, budgets, or opinions. */
export function buildEventPageView(db: Db, event: EventRow, request: Request): EventPageView {
	const view = toEventView(event, listOptions(db, event.id));
	const participant = participantFromRequest(db, event, request);
	const mine = participant ? getMine(db, participant) : null;
	if (!isHost(event, request)) {
		return { role: 'participant', event: view, mine, host: null };
	}
	return {
		role: 'host',
		event: view,
		mine,
		host: {
			submittedCount: countSubmitted(db, event.id),
			pendingCount: countByStatus(db, event.id, 'pending'),
			roster: listRoster(db, event.id),
			tallies: event.rosterFinal && event.aggregates ? presentTallies(event.aggregates) : null
		}
	};
}
