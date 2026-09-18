import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { finalizeRoster } from '../close';
import { analysisJobs, anonymizedPoints, events } from '../db/schema';
import { getEventById, listOptions } from '../events';
import { submitResponse } from '../participants';
import { makeDb, makeEvent, response } from '../test-utils';
import { ProviderError, type ModelProvider } from './contract';
import { fakeProvider } from './fake';
import { analysisStatus, startAnalysis } from './job';
import type { Db } from '../db';
import type { EventRow } from '../db/schema';

const opinions = [
	'SENTINEL-Ana central is key. Cheap is fine.',
	'SENTINEL-Ben beach if sunny',
	'',
	'SENTINEL-Dev views please. I cannot afford the rooftop.',
	'SENTINEL-Eli early flight',
	'SENTINEL-Fay no sand'
];

/** Six approved responses, four of them with text, then a final roster. */
function closedEvent(db: Db): EventRow {
	const event = makeEvent(db);
	const ids = listOptions(db, event.id).map((o) => o.id);
	opinions.forEach((opinion, i) => {
		submitResponse(
			db,
			event,
			ids,
			String(i).repeat(64),
			response(`P${i}`, [ids[i % 4], ids[(i + 1) % 4]], {
				opinion,
				suggestion: i === 1 ? 'SENTINEL flamenco' : ''
			}),
			{ autoApprove: true }
		);
	});
	return finalizeRoster(db, event, 'approve');
}

const input = {
	provider: 'fake' as const,
	key: 'demo-key-1234567890',
	model: 'fake-fast',
	effort: 'max' as const
};

describe('startAnalysis', () => {
	it('runs both stages, stores points and a draft, and never stores raw text', async () => {
		const db = makeDb();
		const event = closedEvent(db);
		const { jobId, done } = startAnalysis(db, event, input, fakeProvider);
		expect(analysisStatus(db, getEventById(db, event.id))).toMatchObject({
			status: 'running',
			hasDraft: false
		});
		await done;
		const job = db.select().from(analysisJobs).where(eq(analysisJobs.id, jobId)).get()!;
		expect(job).toMatchObject({ status: 'succeeded', stage: null, done: 6, total: 6, error: null });
		expect(job.finishedAt).not.toBeNull();
		const after = getEventById(db, event.id);
		expect(after.provider).toBe('fake');
		expect(after.model).toBe('fake-fast');
		expect(after.promptVersion).toBe('v1');
		expect(after.report).toMatchObject({
			version: 1,
			provider: 'fake',
			model: 'fake-fast',
			promptVersion: 'v1'
		});
		expect(JSON.stringify(after.report)).not.toContain('SENTINEL');
		const points = db
			.select()
			.from(anonymizedPoints)
			.where(eq(anonymizedPoints.eventId, event.id))
			.all();
		expect(points.length).toBeGreaterThanOrEqual(6);
		expect(points.every((p) => !p.text.includes('SENTINEL'))).toBe(true);
		expect(points.some((p) => p.type === 'cost')).toBe(true);
		const report = after.report as { themes: { quotes: { pointId: string }[] }[] };
		const quoted = report.themes.flatMap((t) => t.quotes.map((q) => q.pointId));
		expect(quoted.length).toBeGreaterThan(0);
		for (const id of quoted) expect(points.find((p) => p.id === id)?.type).not.toBe('cost');
		expect(analysisStatus(db, after)).toMatchObject({
			status: 'succeeded',
			hasDraft: true,
			done: 6,
			total: 6
		});
	});

	it('keeps the previous draft and points when a run fails', async () => {
		const db = makeDb();
		const event = closedEvent(db);
		await startAnalysis(db, event, input, fakeProvider).done;
		const before = getEventById(db, event.id);
		const pointsBefore = db
			.select()
			.from(anonymizedPoints)
			.where(eq(anonymizedPoints.eventId, event.id))
			.all();
		const { jobId, done } = startAnalysis(
			db,
			before,
			{ ...input, model: 'fake-broken' },
			fakeProvider
		);
		await done;
		const job = db.select().from(analysisJobs).where(eq(analysisJobs.id, jobId)).get()!;
		expect(job.status).toBe('failed');
		expect(job.error).toMatch(/told to fail/);
		const after = getEventById(db, event.id);
		expect(after.report).toEqual(before.report);
		expect(after.model).toBe('fake-fast');
		expect(
			db.select().from(anonymizedPoints).where(eq(anonymizedPoints.eventId, event.id)).all()
		).toEqual(pointsBefore);
		expect(analysisStatus(db, after)).toMatchObject({ status: 'failed', hasDraft: true });
	});

	it('refuses while open, while another run is going, and after publishing', async () => {
		const db = makeDb();
		const open = makeEvent(db);
		expect(() => startAnalysis(db, open, input, fakeProvider)).toThrow(/Close submissions/);
		const event = closedEvent(db);
		const first = startAnalysis(db, event, { ...input, model: 'fake-slow' }, fakeProvider);
		expect(() => startAnalysis(db, event, input, fakeProvider)).toThrow(/already running/);
		await first.done;
		db.update(events).set({ state: 'published' }).where(eq(events.id, event.id)).run();
		expect(() => startAnalysis(db, getEventById(db, event.id), input, fakeProvider)).toThrow(
			/already published/
		);
	});

	it('redacts the key from a failure message', async () => {
		const db = makeDb();
		const event = closedEvent(db);
		const leaky: ModelProvider = {
			id: 'fake',
			async listModels() {
				return [];
			},
			async completeJson(req) {
				throw new ProviderError(`upstream said no to ${req.key}`, false);
			}
		};
		const { jobId, done } = startAnalysis(db, event, input, leaky);
		await done;
		const job = db.select().from(analysisJobs).where(eq(analysisJobs.id, jobId)).get()!;
		expect(job.error).toBe('upstream said no to [key]');
		expect(job.error).not.toContain(input.key);
	});

	it('reports a running row with no live job as interrupted', () => {
		const db = makeDb();
		const event = closedEvent(db);
		db.insert(analysisJobs)
			.values({
				id: 'stale',
				eventId: event.id,
				status: 'running',
				stage: 'anonymize',
				done: 1,
				total: 6,
				startedAt: '2026-01-01T00:00:00.000Z'
			})
			.run();
		expect(analysisStatus(db, event)).toMatchObject({
			status: 'failed',
			error: expect.stringMatching(/interrupted/)
		});
	});
});
