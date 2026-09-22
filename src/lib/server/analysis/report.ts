import { ANALYSIS, RULES } from '$lib/shared/constants';
import type { Point, ProviderId, Report } from '$lib/shared/report';
import type { Aggregates, EventMode, OptionView } from '$lib/shared/types';
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

/** Model text in house style: plain dashes instead of em and en dashes. */
const plain = (text: string) => text.replace(/\u2014|\u2013/g, '-');

/**
 * Turns a validated synthesis into the stored report. Quote text is inserted verbatim from stage 1
 * apart from dash normalization, duplicate, unknown, and cost-tagged ids are dropped, and headline
 * options must exist. Throws a plain Error for an unusable answer so the caller can retry the call once.
 */
export function buildReport(
	output: SynthesizeOutput,
	points: Point[],
	quotable: Set<string>,
	options: OptionView[],
	mode: EventMode,
	meta: ReportMeta
): Report {
	const known = new Set(options.map((o) => o.id));
	for (const id of [output.best.optionId, output.runnerUp.optionId, output.worst.optionId]) {
		if (!known.has(id)) throw new Error(`The model referred to an unknown option ${id}`);
	}
	const byId = new Map(points.map((p) => [p.id, p]));
	const themes = output.themes.map((t) => ({
		title: plain(t.title),
		summary: plain(t.summary),
		quotes: [...new Set(t.quotePointIds)]
			.filter((id) => quotable.has(id) && byId.has(id))
			.slice(0, ANALYSIS.maxQuotesPerTheme)
			.map((id) => ({ pointId: id, text: plain(byId.get(id)!.text) }))
	}));
	let unexpected = output.unexpected;
	if (unexpected?.kind === 'option') {
		unexpected = unexpected.optionId && known.has(unexpected.optionId) ? unexpected : null;
	} else if (unexpected) {
		unexpected = { ...unexpected, optionId: null };
	}
	if (unexpected) {
		unexpected = {
			...unexpected,
			title: plain(unexpected.title),
			rationale: plain(unexpected.rationale)
		};
	}
	return {
		version: 2,
		mode,
		decision: {
			best: {
				...output.best,
				verdict: plain(output.best.verdict),
				rationale: plain(output.best.rationale)
			},
			runnerUp: { ...output.runnerUp, rationale: plain(output.runnerUp.rationale) },
			worst: { ...output.worst, rationale: plain(output.worst.rationale) }
		},
		unexpected,
		themes,
		stillToSettle: output.stillToSettle.map(plain),
		summary: plain(output.summary),
		...meta
	};
}
