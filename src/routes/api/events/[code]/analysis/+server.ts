import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { analysisStatus, isRunning, startAnalysis } from '$lib/server/analysis/job';
import { getProvider } from '$lib/server/analysis/provider';
import { getDb } from '$lib/server/db';
import { conflict } from '$lib/server/errors';
import { raise, readJson } from '$lib/server/http';
import { enforce } from '$lib/server/ratelimit';
import { requireHost } from '$lib/server/roles';
import { loadEventOr404 } from '$lib/server/views';
import { ANALYSIS } from '$lib/shared/constants';
import { runAnalysisInput } from '$lib/shared/validation';

export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const db = getDb();
		const event = loadEventOr404(db, params.code);
		requireHost(event, request);
		// The same preconditions startAnalysis re-checks, so a refused attempt never burns the run budget.
		if (!event.rosterFinal || !event.aggregates) {
			throw conflict('Close submissions before running the analysis');
		}
		if (event.state === 'published') throw conflict('The results are already published');
		if (isRunning(event.id)) throw conflict('An analysis is already running');
		const input = await readJson(request, runAnalysisInput);
		enforce(`analysis:${event.id}`, ANALYSIS.runsPerWindow, ANALYSIS.runWindowMs);
		const { jobId } = startAnalysis(db, event, input, getProvider(input.provider));
		return json({ jobId }, { status: 202 });
	} catch (e) {
		raise(e);
	}
};

export const GET: RequestHandler = ({ params, request }) => {
	try {
		const db = getDb();
		const event = loadEventOr404(db, params.code);
		requireHost(event, request);
		return json(analysisStatus(db, event));
	} catch (e) {
		raise(e);
	}
};
