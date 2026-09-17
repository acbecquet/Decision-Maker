import { and, eq } from 'drizzle-orm';
import type { DbLike } from '../db';
import { participants, responses } from '../db/schema';
import { toBudget } from '../participants';
import type { Budget } from '$lib/shared/types';

export type ApprovedResponse = {
	participantId: string;
	ranking: string[];
	vetoes: string[];
	budget: Budget;
	opinion: string;
	suggestion: string;
};

/**
 * The only function that reads every response of an event.
 * Called by close-time aggregation and by the analysis job. Never call it from a route.
 */
export function readApprovedResponses(db: DbLike, eventId: string): ApprovedResponse[] {
	const rows = db
		.select({
			participantId: participants.id,
			ranking: responses.ranking,
			vetoes: responses.vetoes,
			budgetKind: responses.budgetKind,
			budgetAmount: responses.budgetAmount,
			opinion: responses.opinion,
			suggestion: responses.suggestion
		})
		.from(responses)
		.innerJoin(participants, eq(participants.id, responses.participantId))
		.where(and(eq(participants.eventId, eventId), eq(participants.status, 'approved')))
		.all();
	return rows.map((r) => ({
		participantId: r.participantId,
		ranking: r.ranking,
		vetoes: r.vetoes,
		budget: toBudget(r.budgetKind, r.budgetAmount),
		opinion: r.opinion,
		suggestion: r.suggestion
	}));
}
