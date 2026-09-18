import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fakeProvider } from './analysis/fake';
import { startAnalysis } from './analysis/job';
import { finalizeRoster } from './close';
import { anonymizedPoints, participants, responses } from './db/schema';
import { getEventById, listOptions } from './events';
import { submitResponse } from './participants';
import { publishEvent } from './publish';
import { makeDb, makeEvent, response } from './test-utils';
import type { Db } from './db';

async function drafted(db: Db) {
	const event = makeEvent(db);
	const ids = listOptions(db, event.id).map((o) => o.id);
	for (let i = 0; i < 3; i++) {
		submitResponse(
			db,
			event,
			ids,
			String(i).repeat(64),
			response(`P${i}`, [ids[i]], { opinion: `SENTINEL ${i}` }),
			{ autoApprove: i < 2 }
		);
	}
	const closed = finalizeRoster(db, event, 'reject');
	await startAnalysis(
		db,
		closed,
		{ provider: 'fake', key: 'k', model: 'fake-fast', effort: 'max' },
		fakeProvider
	).done;
	return getEventById(db, event.id);
}

const countFor = (db: Db, eventId: string) => ({
	responses: db
		.select()
		.from(responses)
		.innerJoin(participants, eq(participants.id, responses.participantId))
		.where(eq(participants.eventId, eventId))
		.all().length,
	points: db.select().from(anonymizedPoints).where(eq(anonymizedPoints.eventId, eventId)).all()
		.length,
	participants: db.select().from(participants).where(eq(participants.eventId, eventId)).all().length
});

describe('publishEvent', () => {
	it('purges responses and points, keeps participants and the report, and sets the dates', async () => {
		const db = makeDb();
		const other = makeEvent(db);
		const otherIds = listOptions(db, other.id).map((o) => o.id);
		submitResponse(db, other, otherIds, 'f'.repeat(64), response('Zed', [otherIds[0]]), {
			autoApprove: true
		});
		const event = await drafted(db);
		expect(countFor(db, event.id)).toEqual({ responses: 3, points: 2, participants: 3 });
		const now = new Date('2026-09-18T12:00:00.000Z');
		const published = publishEvent(db, event, now);
		expect(published.state).toBe('published');
		expect(published.publishedAt).toBe(now.toISOString());
		expect(published.expiresAt).toBe('2026-12-17T12:00:00.000Z');
		expect(published.report).toEqual(event.report);
		expect(countFor(db, event.id)).toEqual({ responses: 0, points: 0, participants: 3 });
		expect(countFor(db, other.id)).toEqual({ responses: 1, points: 0, participants: 1 });
	});

	it('refuses without a draft, twice, or while a run is going', async () => {
		const db = makeDb();
		const open = makeEvent(db);
		expect(() => publishEvent(db, open)).toThrow(/Run the analysis/);
		const event = await drafted(db);
		const slow = startAnalysis(
			db,
			event,
			{ provider: 'fake', key: 'k', model: 'fake-slow', effort: 'max' },
			fakeProvider
		);
		expect(() => publishEvent(db, event)).toThrow(/still running/);
		await slow.done;
		publishEvent(db, getEventById(db, event.id));
		expect(() => publishEvent(db, getEventById(db, event.id))).toThrow(/already published/);
	});
});
