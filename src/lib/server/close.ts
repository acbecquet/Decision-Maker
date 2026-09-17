import { eq } from 'drizzle-orm';
import { aggregate } from './analysis/aggregate';
import { readApprovedResponses } from './analysis/responses';
import type { Db } from './db';
import { events, type EventRow } from './db/schema';
import { conflict } from './errors';
import { getEventById, listOptions } from './events';
import { resolvePending } from './participants';

/**
 * Finalizes the roster: resolves pending names, freezes the aggregates on the event,
 * and makes the close final. There is no reverse operation.
 */
export function finalizeRoster(
	db: Db,
	event: EventRow,
	pending: 'approve' | 'reject',
	now = new Date()
): EventRow {
	if (event.state === 'published' || event.rosterFinal) {
		throw conflict('The event is already closed');
	}
	return db.transaction((tx) => {
		resolvePending(tx, event.id, pending === 'approve' ? 'approved' : 'rejected');
		const opts = listOptions(tx, event.id);
		const rows = readApprovedResponses(tx, event.id);
		const aggregates = aggregate(
			opts.map((o) => ({ id: o.id, cost: o.costPerPerson })),
			rows.map((r) => ({ ranking: r.ranking, vetoes: r.vetoes, budget: r.budget }))
		);
		tx.update(events)
			.set({
				state: 'closed',
				rosterFinal: true,
				closedAt: event.closedAt ?? now.toISOString(),
				aggregates
			})
			.where(eq(events.id, event.id))
			.run();
		return getEventById(tx, event.id);
	});
}
