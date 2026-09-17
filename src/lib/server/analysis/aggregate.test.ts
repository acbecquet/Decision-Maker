import { describe, expect, it } from 'vitest';
import { aggregate, findCondorcetWinner, presentTallies } from './aggregate';
import type { Budget } from '$lib/shared/types';

const opts = [
	{ id: 'A', cost: 25 },
	{ id: 'B', cost: 15 },
	{ id: 'C', cost: 45 },
	{ id: 'D', cost: null }
];

const r = (ranking: string[], vetoes: string[] = [], budget: Budget = null) => ({
	ranking,
	vetoes,
	budget
});

const six = [
	r(['A', 'B', 'C', 'D'], [], { kind: 'limit', amount: 30 }),
	r(['A', 'C', 'B'], ['D'], { kind: 'limit', amount: 30 }),
	r(['B', 'A', 'C', 'D'], [], { kind: 'no_limit' }),
	r(['C', 'A', 'B', 'D'], [], { kind: 'limit', amount: 50 }),
	r(['A', 'B'], ['C', 'D'], { kind: 'limit', amount: 20 }),
	r(['B', 'A'])
];

describe('aggregate', () => {
	const agg = aggregate(opts, six);

	it('counts first choices in option order', () => {
		expect(agg.approvedCount).toBe(6);
		expect(agg.firstChoice).toEqual([
			{ optionId: 'A', count: 3 },
			{ optionId: 'B', count: 2 },
			{ optionId: 'C', count: 1 },
			{ optionId: 'D', count: 0 }
		]);
	});

	it('builds the rank matrix with unranked counted separately', () => {
		expect(agg.rankMatrix).toEqual([
			{ optionId: 'A', ranks: [3, 3, 0, 0], unranked: 0 },
			{ optionId: 'B', ranks: [2, 2, 2, 0], unranked: 0 },
			{ optionId: 'C', ranks: [1, 1, 2, 0], unranked: 2 },
			{ optionId: 'D', ranks: [0, 0, 0, 3], unranked: 3 }
		]);
	});

	it('counts vetoes', () => {
		expect(agg.vetoes.map((v) => v.count)).toEqual([0, 0, 1, 2]);
	});

	it('scores Borda with unranked as tied last', () => {
		expect(agg.borda).toEqual([
			{ optionId: 'A', score: 15 },
			{ optionId: 'B', score: 12 },
			{ optionId: 'C', score: 7 },
			{ optionId: 'D', score: 0 }
		]);
	});

	it('names the Condorcet winner', () => {
		expect(agg.condorcetWinner).toBe('A');
	});

	it('counts how many limits fall below each costed option', () => {
		expect(agg.cost).toEqual({
			answered: 5,
			rows: [
				{ optionId: 'A', cost: 25, overBudget: 1 },
				{ optionId: 'B', cost: 15, overBudget: 0 },
				{ optionId: 'C', cost: 45, overBudget: 3 }
			]
		});
	});

	it('has no cost block when no option has a cost', () => {
		const noCost = aggregate(
			opts.map((o) => ({ ...o, cost: null })),
			six
		);
		expect(noCost.cost).toBeNull();
	});
});

describe('findCondorcetWinner', () => {
	it('returns null for a cycle', () => {
		const cycle = [r(['A', 'B', 'C']), r(['B', 'C', 'A']), r(['C', 'A', 'B'])];
		expect(findCondorcetWinner(['A', 'B', 'C'], cycle)).toBeNull();
	});

	it('treats an unranked option as below every ranked one', () => {
		expect(findCondorcetWinner(['A', 'B'], [r(['A']), r(['A']), r(['B', 'A'])])).toBe('A');
	});
});

describe('presentTallies', () => {
	it('hides the whole breakdown below five approved responses', () => {
		const agg = aggregate(opts, six.slice(0, 4));
		expect(presentTallies(agg)).toEqual({ approvedCount: 4, breakdown: null });
	});

	it('hides cost counts below three, including zero', () => {
		const presented = presentTallies(aggregate(opts, six));
		expect(presented.breakdown?.cost).toEqual({
			answered: 5,
			rows: [
				{ optionId: 'A', cost: 25, overBudget: null },
				{ optionId: 'B', cost: 15, overBudget: null },
				{ optionId: 'C', cost: 45, overBudget: 3 }
			]
		});
	});

	it('hides the answered count when it is below three', () => {
		const few = [...six.slice(0, 2), r(['A']), r(['B']), r(['C'])];
		const presented = presentTallies(aggregate(opts, few));
		expect(presented.breakdown?.cost?.answered).toBeNull();
	});

	it('passes the other numbers through', () => {
		const presented = presentTallies(aggregate(opts, six));
		expect(presented.breakdown?.firstChoice[0]).toEqual({ optionId: 'A', count: 3 });
		expect(presented.breakdown?.condorcetWinner).toBe('A');
	});
});
