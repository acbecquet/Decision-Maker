import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ANALYSIS } from '$lib/shared/constants';
import { finalizeRoster } from '../close';
import { analysisJobs, anonymizedPoints, events } from '../db/schema';
import { getEventById, listOptions } from '../events';
import { submitResponse } from '../participants';
import { makeDb, makeEvent, response } from '../test-utils';
import { ProviderError, type ModelProvider } from './contract';
import { fakeProvider } from './fake';
import { abortAnalysis, analysisStatus, isRunning, startAnalysis } from './job';
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

/** Six approved responses, all of them with text, so every concurrency slot gets real work. */
function sixTextfulResponses(db: Db): EventRow {
	const event = makeEvent(db);
	const ids = listOptions(db, event.id).map((o) => o.id);
	for (let i = 0; i < 6; i++) {
		submitResponse(
			db,
			event,
			ids,
			String(i).repeat(64),
			response(`Q${i}`, [ids[i % 4], ids[(i + 1) % 4]], { opinion: `SENTINEL text ${i}` }),
			{ autoApprove: true }
		);
	}
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

	it('drops invented option ids and retries once when the headline option is unusable', async () => {
		const db = makeDb();
		const event = closedEvent(db);
		const optionId = listOptions(db, event.id)[0].id;
		let calls = 0;
		let synthCalls = 0;
		const stub: ModelProvider = {
			id: 'fake',
			async listModels() {
				return [];
			},
			async completeJson(req) {
				calls++;
				if (req.payload.stage === 'anonymize') {
					return {
						points: [
							{
								text: 'A reason that leans somewhere.',
								type: 'reason',
								optionIds: ['nope', optionId]
							},
							{ text: 'A cost point.', type: 'cost', optionIds: [] }
						]
					};
				}
				synthCalls++;
				const groupPoints = req.payload.input.groups.flat();
				const costId = groupPoints.find((p) => p.type === 'cost')!.id;
				const reasonId = groupPoints.find((p) => p.type === 'reason')!.id;
				const base = {
					runnerUp: { optionId, rationale: 'Second best.' },
					worst: { optionId, rationale: 'Ranked lowest.' },
					unexpected: null,
					stillToSettle: [],
					summary: 'A summary for the group.',
					themes: [
						{
							title: 'Why people lean this way',
							summary: 'Reasons came up.',
							quotePointIds: synthCalls === 1 ? [] : [costId, reasonId]
						},
						{ title: 'Second theme', summary: 'More detail.', quotePointIds: [] },
						{ title: 'Third theme', summary: 'Still more.', quotePointIds: [] }
					]
				};
				return synthCalls === 1
					? {
							...base,
							best: {
								optionId: 'nope',
								verdict: 'A bad pick.',
								rationale: 'Invented.',
								consensus: 'moderate'
							}
						}
					: {
							...base,
							best: {
								optionId,
								verdict: 'The real pick.',
								rationale: 'Solid.',
								consensus: 'moderate'
							}
						};
			}
		};
		const { done } = startAnalysis(db, event, input, stub);
		await done;
		const after = getEventById(db, event.id);
		expect(after.report).toMatchObject({ version: 1 });
		const points = db
			.select()
			.from(anonymizedPoints)
			.where(eq(anonymizedPoints.eventId, event.id))
			.all();
		const knownIds = new Set(listOptions(db, event.id).map((o) => o.id));
		for (const p of points) for (const id of p.optionIds) expect(knownIds.has(id)).toBe(true);
		const costPointIds = new Set(points.filter((p) => p.type === 'cost').map((p) => p.id));
		const report = after.report as { themes: { quotes: { pointId: string }[] }[] };
		const quotedIds = report.themes.flatMap((t) => t.quotes.map((q) => q.pointId));
		expect(quotedIds.length).toBeGreaterThan(0);
		for (const id of quotedIds) expect(costPointIds.has(id)).toBe(false);
		expect(calls).toBe(7); // 5 textful responses in closedEvent, plus 2 synthesize attempts
	});

	it('fails the job when the headline option is still unusable after the retry', async () => {
		const db = makeDb();
		const event = closedEvent(db);
		const optionId = listOptions(db, event.id)[0].id;
		const stub: ModelProvider = {
			id: 'fake',
			async listModels() {
				return [];
			},
			async completeJson(req) {
				if (req.payload.stage === 'anonymize') return { points: [] };
				return {
					best: { optionId: 'nope', verdict: 'v', rationale: 'r', consensus: 'moderate' },
					runnerUp: { optionId, rationale: 'r' },
					worst: { optionId, rationale: 'r' },
					unexpected: null,
					themes: [
						{ title: 'T1', summary: 'S1', quotePointIds: [] },
						{ title: 'T2', summary: 'S2', quotePointIds: [] },
						{ title: 'T3', summary: 'S3', quotePointIds: [] }
					],
					stillToSettle: [],
					summary: 'summary'
				};
			}
		};
		const { jobId, done } = startAnalysis(db, event, input, stub);
		await done;
		const job = db.select().from(analysisJobs).where(eq(analysisJobs.id, jobId)).get()!;
		expect(job.status).toBe('failed');
		expect(job.error).toMatch(/unusable/);
		const after = getEventById(db, event.id);
		expect(after.report).toBeNull();
	});

	it('stops stage 1 on the first failure and cancels in-flight siblings', async () => {
		const db = makeDb();
		const event = sixTextfulResponses(db);
		let calls = 0;
		let synthCalls = 0;
		const observed: boolean[] = [];
		const stub: ModelProvider = {
			id: 'fake',
			async listModels() {
				return [];
			},
			async completeJson(req) {
				if (req.payload.stage === 'synthesize') {
					synthCalls++;
					throw new Error('stage 3 should not have been called');
				}
				calls++;
				if (calls === 1) throw new ProviderError('stage 1 exploded', false);
				await new Promise((resolve) => setTimeout(resolve, 50));
				observed.push(req.signal?.aborted ?? false);
				return { points: [] };
			}
		};
		const { jobId, done } = startAnalysis(db, event, input, stub);
		expect(isRunning(event.id)).toBe(true);
		await done;
		expect(isRunning(event.id)).toBe(false);
		const job = db.select().from(analysisJobs).where(eq(analysisJobs.id, jobId)).get()!;
		expect(job.status).toBe('failed');
		// The real cause must survive even though our own fix aborts the shared signal below:
		// only a real timeout may say "took too long".
		expect(job.error).toMatch(/stage 1 exploded/);
		expect(job.error).not.toMatch(/took too long/);
		expect(calls).toBeLessThanOrEqual(ANALYSIS.concurrency);
		expect(synthCalls).toBe(0);
		expect(observed.length).toBeGreaterThan(0);
		expect(observed.every(Boolean)).toBe(true);
	});

	it('reports a timeout distinctly from an ordinary provider failure', async () => {
		const db = makeDb();
		const event = closedEvent(db);
		expect(abortAnalysis(event.id)).toBe(false);
		const stub: ModelProvider = {
			id: 'fake',
			async listModels() {
				return [];
			},
			async completeJson(req) {
				return new Promise((_resolve, reject) => {
					req.signal?.addEventListener('abort', () => reject(new ProviderError('aborted', false)), {
						once: true
					});
				});
			}
		};
		const { jobId, done } = startAnalysis(
			db,
			event,
			input,
			stub,
			new Date('2026-02-02T00:00:00.000Z')
		);
		expect(abortAnalysis(event.id)).toBe(true);
		await done;
		expect(abortAnalysis(event.id)).toBe(false);
		const job = db.select().from(analysisJobs).where(eq(analysisJobs.id, jobId)).get()!;
		expect(job.status).toBe('failed');
		expect(job.error).toMatch(/took too long/);
	});
});
