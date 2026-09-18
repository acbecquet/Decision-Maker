import { ANALYSIS, RULES } from '$lib/shared/constants';
import type { Point, ProviderId, Report } from '$lib/shared/report';
import type { Aggregates, OptionView } from '$lib/shared/types';
import type { SynthesizeOutput } from './schemas';

export type ReportMeta = {
	provider: ProviderId;
	model: string;
	promptVersion: string;
	generatedAt: string;
};

/** True when a cost count was suppressed but not zero: cost matters to some people, with no number to show. */
export function costMattersToSome(agg: Aggregates): boolean {
	if (!agg.cost) return false;
	const small = (n: number) => n > 0 && n < RULES.minCostCount;
	return small(agg.cost.answered) || agg.cost.rows.some((r) => small(r.overBudget));
}

/**
 * Turns a validated synthesis into the stored report. Quote text is inserted verbatim from stage 1,
 * duplicate, unknown, and cost-tagged ids are dropped, and headline options must exist.
 * Throws a plain Error for an unusable answer so the caller can retry the call once.
 */
export function buildReport(
	output: SynthesizeOutput,
	points: Point[],
	quotable: Set<string>,
	options: OptionView[],
	meta: ReportMeta
): Report {
	const known = new Set(options.map((o) => o.id));
	for (const id of [output.best.optionId, output.runnerUp.optionId, output.worst.optionId]) {
		if (!known.has(id)) throw new Error(`The model referred to an unknown option ${id}`);
	}
	const byId = new Map(points.map((p) => [p.id, p]));
	const themes = output.themes.map((t) => ({
		title: t.title,
		summary: t.summary,
		quotes: [...new Set(t.quotePointIds)]
			.filter((id) => quotable.has(id) && byId.has(id))
			.slice(0, ANALYSIS.maxQuotesPerTheme)
			.map((id) => ({ pointId: id, text: byId.get(id)!.text }))
	}));
	let unexpected = output.unexpected;
	if (unexpected?.kind === 'option') {
		unexpected = unexpected.optionId && known.has(unexpected.optionId) ? unexpected : null;
	} else if (unexpected) {
		unexpected = { ...unexpected, optionId: null };
	}
	return {
		version: 1,
		best: output.best,
		runnerUp: output.runnerUp,
		worst: output.worst,
		unexpected,
		themes,
		stillToSettle: output.stillToSettle,
		summary: output.summary,
		...meta
	};
}
