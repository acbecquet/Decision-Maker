import { RULES } from '$lib/shared/constants';
import type { Aggregates, Budget, PresentedTallies } from '$lib/shared/types';

export type AggregateOption = { id: string; cost: number | null };
export type AggregateResponse = { ranking: string[]; vetoes: string[]; budget: Budget };

/** True when the response ranks a above b. An unranked option loses to any ranked one. */
function prefers(response: AggregateResponse, a: string, b: string): boolean {
	const ia = response.ranking.indexOf(a);
	const ib = response.ranking.indexOf(b);
	if (ia < 0) return false;
	if (ib < 0) return true;
	return ia < ib;
}

/** The option that beats every other option head to head, or null when there is none. */
export function findCondorcetWinner(ids: string[], responses: AggregateResponse[]): string | null {
	outer: for (const a of ids) {
		for (const b of ids) {
			if (a === b) continue;
			const ab = responses.filter((r) => prefers(r, a, b)).length;
			const ba = responses.filter((r) => prefers(r, b, a)).length;
			if (ab <= ba) continue outer;
		}
		return a;
	}
	return null;
}

/** Stage 2: pure arithmetic over approved responses. No model, no names. */
export function aggregate(opts: AggregateOption[], responses: AggregateResponse[]): Aggregates {
	const n = opts.length;
	const ids = opts.map((o) => o.id);

	const firstChoice = ids.map((id) => ({
		optionId: id,
		count: responses.filter((r) => r.ranking[0] === id).length
	}));

	const rankMatrix = ids.map((id) => {
		const ranks = new Array<number>(n).fill(0);
		let unranked = 0;
		for (const r of responses) {
			const i = r.ranking.indexOf(id);
			if (i < 0) unranked++;
			else ranks[i]++;
		}
		return { optionId: id, ranks, unranked };
	});

	const vetoes = ids.map((id) => ({
		optionId: id,
		count: responses.filter((r) => r.vetoes.includes(id)).length
	}));

	const borda = ids.map((id) => ({
		optionId: id,
		score: responses.reduce((sum, r) => {
			const i = r.ranking.indexOf(id);
			return sum + (i < 0 ? 0 : n - 1 - i);
		}, 0)
	}));

	const costed = opts.filter((o): o is { id: string; cost: number } => o.cost !== null);
	const cost =
		costed.length === 0
			? null
			: {
					answered: responses.filter((r) => r.budget !== null).length,
					rows: costed.map((o) => ({
						optionId: o.id,
						cost: o.cost,
						overBudget: responses.filter(
							(r) => r.budget?.kind === 'limit' && r.budget.amount < o.cost
						).length
					}))
				};

	return {
		approvedCount: responses.length,
		firstChoice,
		rankMatrix,
		vetoes,
		borda,
		condorcetWinner: findCondorcetWinner(ids, responses),
		cost
	};
}

const hideBelow = (value: number, floor: number): number | null => (value >= floor ? value : null);

/** Applies the suppression rules. Hosts and reports only ever see the result of this function. */
export function presentTallies(agg: Aggregates): PresentedTallies {
	if (agg.approvedCount < RULES.minBreakdownResponses) {
		return { approvedCount: agg.approvedCount, breakdown: null };
	}
	return {
		approvedCount: agg.approvedCount,
		breakdown: {
			firstChoice: agg.firstChoice,
			rankMatrix: agg.rankMatrix,
			vetoes: agg.vetoes,
			borda: agg.borda,
			condorcetWinner: agg.condorcetWinner,
			cost: agg.cost
				? {
						answered: hideBelow(agg.cost.answered, RULES.minCostCount),
						rows: agg.cost.rows.map((r) => ({
							optionId: r.optionId,
							cost: r.cost,
							overBudget: hideBelow(r.overBudget, RULES.minCostCount)
						}))
					}
				: null
		}
	};
}
