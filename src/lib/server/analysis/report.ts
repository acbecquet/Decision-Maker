import { ANALYSIS, RULES } from '$lib/shared/constants';
import type { Point, ProviderId, Report, ReportUnexpected } from '$lib/shared/report';
import type { Aggregates, EventMode, OptionCount, OptionView } from '$lib/shared/types';
import type { SynthesizeOutput, SynthesizeOutputFreeform } from './schemas';

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
 * apart from dash normalization, duplicate, unknown, and cost-tagged ids are dropped, headline
 * options must exist, and in a single-choice event the winner must be an option with the most
 * votes. Throws a plain Error for an unusable answer so the caller can retry the call once.
 */
export function buildReport(
	output: SynthesizeOutput | SynthesizeOutputFreeform,
	points: Point[],
	quotable: Set<string>,
	options: OptionView[],
	mode: EventMode,
	meta: ReportMeta,
	votes: OptionCount[] = []
): Report {
	const known = new Set(options.map((o) => o.id));
	/** An opinions-only event decides nothing, so it has no headline options to check. */
	const headline = mode === 'freeform' || !('best' in output) ? null : output;
	if (headline) {
		for (const id of [
			headline.best.optionId,
			headline.runnerUp.optionId,
			headline.worst.optionId
		]) {
			if (!known.has(id)) throw new Error(`The model referred to an unknown option ${id}`);
		}
		if (mode === 'single' && votes.length > 0) {
			const most = Math.max(...votes.map((v) => v.count));
			const leaders = votes.filter((v) => v.count === most).map((v) => v.optionId);
			if (!leaders.includes(headline.best.optionId)) {
				throw new Error(
					`The model crowned ${headline.best.optionId} but ${leaders.join(' or ')} has the most votes`
				);
			}
		}
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
	let unexpected: ReportUnexpected = output.unexpected;
	if (unexpected?.kind === 'option') {
		unexpected =
			headline && unexpected.optionId && known.has(unexpected.optionId) ? unexpected : null;
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
		decision: headline && {
			best: {
				...headline.best,
				verdict: plain(headline.best.verdict),
				rationale: plain(headline.best.rationale)
			},
			runnerUp: { ...headline.runnerUp, rationale: plain(headline.runnerUp.rationale) },
			worst: { ...headline.worst, rationale: plain(headline.worst.rationale) }
		},
		unexpected,
		themes,
		stillToSettle: output.stillToSettle.map(plain),
		summary: plain(output.summary),
		...meta
	};
}
