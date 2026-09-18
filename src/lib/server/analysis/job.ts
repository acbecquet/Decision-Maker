import { desc, eq, sql } from 'drizzle-orm';
import { ANALYSIS } from '$lib/shared/constants';
import type { AnalysisStatus, Point } from '$lib/shared/report';
import type { RunAnalysisInput } from '$lib/shared/validation';
import { newId } from '../crypto';
import type { Db, DbLike } from '../db';
import { analysisJobs, anonymizedPoints, events, type EventRow } from '../db/schema';
import { conflict } from '../errors';
import { getEventById, listOptions, toEventView } from '../events';
import { presentTallies } from './aggregate';
import {
	ProviderError,
	redact,
	type JsonRequest,
	type ModelProvider,
	type StagePayload
} from './contract';
import { PROMPT_VERSION, anonymizePrompt, quotableIds, synthesizePrompt } from './prompts';
import { buildReport, costMattersToSome } from './report';
import { readApprovedResponses, type ApprovedResponse } from './responses';
import { withRetry } from './retry';
import { ANONYMIZE_SCHEMA, SYNTHESIZE_SCHEMA, anonymizeOutput, synthesizeOutput } from './schemas';

const MAX_TOKENS = { anonymize: 16_000, synthesize: 32_000 } as const;

type Running = { jobId: string; controller: AbortController; timedOut: boolean };
/** One job per event at a time. The key lives only inside the running job's closure. */
const running = new Map<string, Running>();

export const isRunning = (eventId: string): boolean => running.has(eventId);

const hasText = (r: ApprovedResponse) => r.opinion.trim() !== '' || r.suggestion.trim() !== '';

export function analysisStatus(db: DbLike, event: EventRow): AnalysisStatus {
	const row = db
		.select()
		.from(analysisJobs)
		.where(eq(analysisJobs.eventId, event.id))
		.orderBy(desc(analysisJobs.startedAt), desc(sql`rowid`))
		.get();
	const hasDraft = event.report !== null;
	if (!row) return { status: 'idle', stage: null, done: 0, total: 0, error: null, hasDraft };
	const interrupted = row.status === 'running' && !running.has(event.id);
	return {
		status: interrupted ? 'failed' : row.status,
		stage: row.stage === 'anonymize' || row.stage === 'synthesize' ? row.stage : null,
		done: row.done,
		total: row.total,
		error: interrupted ? 'The analysis was interrupted, run it again' : row.error,
		hasDraft
	};
}

/** Starts a run in the background. `done` settles when the job has written its outcome; it never rejects. */
export function startAnalysis(
	db: Db,
	event: EventRow,
	input: RunAnalysisInput,
	provider: ModelProvider,
	now = new Date()
): { jobId: string; done: Promise<void> } {
	const current = getEventById(db, event.id);
	if (!current.rosterFinal || !current.aggregates)
		throw conflict('Close submissions before running the analysis');
	if (current.state === 'published') throw conflict('The results are already published');
	if (running.has(current.id)) throw conflict('An analysis is already running');

	const jobId = newId();
	const responses = readApprovedResponses(db, current.id);
	const total = responses.filter(hasText).length + 1;
	db.insert(analysisJobs)
		.values({
			id: jobId,
			eventId: current.id,
			status: 'running',
			stage: 'anonymize',
			done: 0,
			total,
			startedAt: now.toISOString()
		})
		.run();
	const controller = new AbortController();
	const entry: Running = { jobId, controller, timedOut: false };
	running.set(current.id, entry);
	const timer = setTimeout(() => {
		entry.timedOut = true;
		controller.abort();
	}, ANALYSIS.jobTimeoutMs);
	timer.unref();

	const done = runJob(db, current, responses, input, provider, jobId, controller)
		.catch((e: unknown) => {
			const message = describeFailure(e, input.key, entry.timedOut);
			db.update(analysisJobs)
				.set({ status: 'failed', error: message, finishedAt: new Date().toISOString() })
				.where(eq(analysisJobs.id, jobId))
				.run();
		})
		.finally(() => {
			clearTimeout(timer);
			running.delete(current.id);
		})
		.catch((e: unknown) => {
			console.error(
				'analysis bookkeeping failed',
				redact(e instanceof Error ? e.message : String(e), input.key)
			);
		});
	return { jobId, done };
}

/**
 * Test support only, never for a route: makes the running job for an event behave as if its timeout
 * had just fired, without waiting for the real `ANALYSIS.jobTimeoutMs`. Returns false when no job is running.
 */
export function abortAnalysis(eventId: string): boolean {
	const entry = running.get(eventId);
	if (!entry) return false;
	entry.timedOut = true;
	entry.controller.abort();
	return true;
}

function describeFailure(e: unknown, key: string, timedOut: boolean): string {
	if (timedOut) return 'The analysis took too long and was stopped';
	if (e instanceof ProviderError) return redact(e.message, key);
	console.error('analysis failed', redact(e instanceof Error ? e.message : String(e), key));
	return 'The analysis failed, try again';
}

async function runJob(
	db: Db,
	event: EventRow,
	responses: ApprovedResponse[],
	input: RunAnalysisInput,
	provider: ModelProvider,
	jobId: string,
	controller: AbortController
): Promise<void> {
	const signal = controller.signal;
	const options = toEventView(event, listOptions(db, event.id)).options;
	const aggregates = event.aggregates!;
	const knownOption = (id: string) => options.some((o) => o.id === id);

	/** One validated model call: provider retries for retryable errors, then one retry for an unusable answer. */
	async function call<T>(
		payload: StagePayload,
		schemaName: string,
		schema: JsonRequest['schema'],
		maxTokens: number,
		validate: (raw: unknown) => T
	): Promise<T> {
		const { system, user } =
			payload.stage === 'anonymize'
				? anonymizePrompt(payload.input)
				: synthesizePrompt(payload.input);
		const req: JsonRequest = {
			key: input.key,
			model: input.model,
			effort: input.effort,
			system,
			user,
			schemaName,
			schema,
			maxTokens,
			payload,
			signal
		};
		const once = () =>
			withRetry(() => provider.completeJson(req), {
				attempts: ANALYSIS.attempts,
				baseDelayMs: 1000,
				signal
			});
		try {
			return validate(await once());
		} catch (e) {
			if (e instanceof ProviderError) throw e;
			try {
				return validate(await once());
			} catch (again) {
				if (again instanceof ProviderError) throw again;
				throw new ProviderError('The model returned an unusable answer twice', false);
			}
		}
	}

	const byParticipant = new Map<string, Point[]>();
	await mapWithConcurrency(responses.filter(hasText), ANALYSIS.concurrency, async (r) => {
		let out;
		try {
			out = await call(
				{
					stage: 'anonymize',
					input: {
						options,
						currency: event.currency,
						ranking: r.ranking,
						vetoes: r.vetoes,
						opinion: r.opinion,
						suggestion: r.suggestion
					}
				},
				'anonymize',
				ANONYMIZE_SCHEMA,
				MAX_TOKENS.anonymize,
				(raw) => anonymizeOutput.parse(raw)
			);
		} catch (e) {
			// This call failed: stop the in-flight sibling calls through the shared signal.
			controller.abort();
			throw e;
		}
		byParticipant.set(
			r.participantId,
			out.points.map((p) => ({
				id: newId(),
				text: p.text,
				type: p.type,
				optionIds: p.optionIds.filter(knownOption)
			}))
		);
		db.update(analysisJobs)
			.set({ done: sql`${analysisJobs.done} + 1` })
			.where(eq(analysisJobs.id, jobId))
			.run();
	});

	db.update(analysisJobs).set({ stage: 'synthesize' }).where(eq(analysisJobs.id, jobId)).run();
	const groups = shuffle([...byParticipant.values()].filter((g) => g.length > 0));
	const points = groups.flat();
	const meta = {
		provider: provider.id,
		model: input.model,
		promptVersion: PROMPT_VERSION,
		generatedAt: new Date().toISOString()
	};
	const report = await call(
		{
			stage: 'synthesize',
			input: {
				title: event.title,
				context: event.context,
				currency: event.currency,
				options,
				tallies: presentTallies(aggregates),
				costMattersToSome: costMattersToSome(aggregates),
				groups
			}
		},
		'synthesize',
		SYNTHESIZE_SCHEMA,
		MAX_TOKENS.synthesize,
		(raw) => buildReport(synthesizeOutput.parse(raw), points, quotableIds(groups), options, meta)
	);

	db.transaction((tx) => {
		tx.delete(anonymizedPoints).where(eq(anonymizedPoints.eventId, event.id)).run();
		const rows = [...byParticipant].flatMap(([participantId, mine]) =>
			mine.map((p) => ({
				id: p.id,
				eventId: event.id,
				participantId,
				text: p.text,
				type: p.type,
				optionIds: p.optionIds,
				model: input.model
			}))
		);
		if (rows.length) tx.insert(anonymizedPoints).values(rows).run();
		tx.update(events)
			.set({ report, provider: provider.id, model: input.model, promptVersion: PROMPT_VERSION })
			.where(eq(events.id, event.id))
			.run();
		tx.update(analysisJobs)
			.set({
				status: 'succeeded',
				stage: null,
				done: sql`${analysisJobs.total}`,
				error: null,
				finishedAt: new Date().toISOString()
			})
			.where(eq(analysisJobs.id, jobId))
			.run();
	});
}

async function mapWithConcurrency<T>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<void>
): Promise<void> {
	let next = 0;
	let failed = false;
	let firstError: unknown;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length && !failed) {
			const item = items[next++];
			try {
				await fn(item);
			} catch (e) {
				if (!failed) {
					failed = true;
					firstError = e;
				}
				return;
			}
		}
	});
	await Promise.all(workers);
	if (failed) throw firstError;
}

/** Fisher-Yates with platform randomness, so group order carries no information about who is who. */
function shuffle<T>(items: T[]): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}
