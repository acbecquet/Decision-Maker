import { and, asc, count, eq, sql } from 'drizzle-orm';
import type { Db, DbLike } from './db';
import { participants, responses, type EventRow, type ParticipantRow } from './db/schema';
import { newId } from './crypto';
import { badRequest, conflict, notFound } from './errors';
import type { Budget, MineView, ParticipantStatus, RosterRow } from '$lib/shared/types';
import {
	checkOptionRefs,
	type EditResponseInput,
	type ResponseInput
} from '$lib/shared/validation';

export function toBudget(kind: 'limit' | 'no_limit' | null, amount: number | null): Budget {
	if (kind === 'limit') return { kind: 'limit', amount: amount ?? 0 };
	if (kind === 'no_limit') return { kind: 'no_limit' };
	return null;
}

export function findParticipantByDevice(
	db: DbLike,
	eventId: string,
	deviceTokenHash: string
): ParticipantRow | undefined {
	return db
		.select()
		.from(participants)
		.where(
			and(eq(participants.eventId, eventId), eq(participants.deviceTokenHash, deviceTokenHash))
		)
		.get();
}

export function getParticipant(db: DbLike, id: string): ParticipantRow {
	const row = db.select().from(participants).where(eq(participants.id, id)).get();
	if (!row) throw notFound('Participant not found');
	return row;
}

function responseColumns(input: EditResponseInput, nowIso: string) {
	return {
		ranking: input.ranking,
		vetoes: input.vetoes,
		budgetKind: input.budget?.kind ?? null,
		budgetAmount: input.budget?.kind === 'limit' ? input.budget.amount : null,
		opinion: input.opinion,
		suggestion: input.suggestion,
		updatedAt: nowIso
	};
}

export function submitResponse(
	db: Db,
	event: EventRow,
	optionIds: string[],
	deviceTokenHash: string,
	input: ResponseInput,
	opts: { autoApprove: boolean; now?: Date }
): ParticipantRow {
	if (event.state !== 'open') throw conflict('Submissions are closed');
	const problem = checkOptionRefs(input.ranking, input.vetoes, optionIds);
	if (problem) throw badRequest(problem);
	if (findParticipantByDevice(db, event.id, deviceTokenHash)) {
		throw conflict('This device already submitted');
	}
	const id = newId();
	const nowIso = (opts.now ?? new Date()).toISOString();
	db.transaction((tx) => {
		tx.insert(participants)
			.values({
				id,
				eventId: event.id,
				displayName: input.name,
				deviceTokenHash,
				status: opts.autoApprove ? 'approved' : 'pending',
				createdAt: nowIso
			})
			.run();
		tx.insert(responses)
			.values({ participantId: id, ...responseColumns(input, nowIso) })
			.run();
	});
	return getParticipant(db, id);
}

export function updateResponse(
	db: DbLike,
	event: EventRow,
	optionIds: string[],
	participant: ParticipantRow,
	input: EditResponseInput,
	now = new Date()
): void {
	if (event.state !== 'open') throw conflict('Submissions are closed');
	const problem = checkOptionRefs(input.ranking, input.vetoes, optionIds);
	if (problem) throw badRequest(problem);
	db.update(responses)
		.set(responseColumns(input, now.toISOString()))
		.where(eq(responses.participantId, participant.id))
		.run();
}

/** The participant's own submission. The only path that returns response data to a client. */
export function getMine(db: DbLike, participant: ParticipantRow): MineView {
	const row = db.select().from(responses).where(eq(responses.participantId, participant.id)).get();
	if (!row) throw notFound('Response not found');
	return {
		name: participant.displayName,
		ranking: row.ranking,
		vetoes: row.vetoes,
		budget: toBudget(row.budgetKind, row.budgetAmount),
		opinion: row.opinion,
		suggestion: row.suggestion
	};
}

/** Names and statuses only, sorted by name, with no timestamps. */
export function listRoster(db: DbLike, eventId: string): RosterRow[] {
	const rows = db
		.select({ id: participants.id, name: participants.displayName, status: participants.status })
		.from(participants)
		.where(eq(participants.eventId, eventId))
		.orderBy(sql`lower(${participants.displayName})`, asc(participants.id))
		.all();
	const seen = new Map<string, number>();
	for (const r of rows) {
		const key = r.name.trim().toLowerCase();
		seen.set(key, (seen.get(key) ?? 0) + 1);
	}
	return rows.map((r) => ({
		...r,
		name: r.name.trim(),
		duplicate: (seen.get(r.name.trim().toLowerCase()) ?? 0) > 1
	}));
}

export function setParticipantStatus(
	db: DbLike,
	event: EventRow,
	participantId: string,
	status: 'approved' | 'rejected'
): void {
	if (event.rosterFinal) throw conflict('The roster is final');
	const result = db
		.update(participants)
		.set({ status })
		.where(and(eq(participants.id, participantId), eq(participants.eventId, event.id)))
		.run();
	if (result.changes === 0) throw notFound('Participant not found');
}

export function approveAllPending(db: DbLike, event: EventRow): number {
	if (event.rosterFinal) throw conflict('The roster is final');
	return resolvePending(db, event.id, 'approved');
}

/** Moves every pending participant to the given status. Used by approve-all and by finalizeRoster. */
export function resolvePending(
	db: DbLike,
	eventId: string,
	status: 'approved' | 'rejected'
): number {
	return db
		.update(participants)
		.set({ status })
		.where(and(eq(participants.eventId, eventId), eq(participants.status, 'pending')))
		.run().changes;
}

export function countByStatus(db: DbLike, eventId: string, status: ParticipantStatus): number {
	return (
		db
			.select({ n: count() })
			.from(participants)
			.where(and(eq(participants.eventId, eventId), eq(participants.status, status)))
			.get()?.n ?? 0
	);
}

export function countSubmitted(db: DbLike, eventId: string): number {
	return (
		db.select({ n: count() }).from(participants).where(eq(participants.eventId, eventId)).get()
			?.n ?? 0
	);
}
