import { and, eq } from 'drizzle-orm';
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
 * The event is re-read inside the transaction so a stale caller snapshot cannot pass the
 * guard, and the update applies only while the roster is not yet final.
 */
export function finalizeRoster(
	db: Db,
	event: EventRow,
	pending: 'approve' | 'reject',
	now = new Date()
): EventRow {
	return db.transaction((tx) => {
		const current = getEventById(tx, event.id);
		if (current.state === 'published' || current.rosterFinal) {
			throw conflict('The event is already closed');
		}
		resolvePending(tx, current.id, pending === 'approve' ? 'approved' : 'rejected');
		const opts = listOptions(tx, current.id);
		const rows = readApprovedResponses(tx, current.id);
		const aggregates = aggregate(
			opts.map((o) => ({ id: o.id, cost: o.costPerPerson })),
			rows.map((r) => ({ ranking: r.ranking, vetoes: r.vetoes, budget: r.budget }))
		);
		const result = tx
			.update(events)
			.set({
				state: 'closed',
				rosterFinal: true,
				closedAt: current.closedAt ?? now.toISOString(),
				aggregates
			})
			.where(and(eq(events.id, current.id), eq(events.rosterFinal, false)))
			.run();
		if (result.changes === 0) throw conflict('The event is already closed');
		return getEventById(tx, current.id);
	});
}
