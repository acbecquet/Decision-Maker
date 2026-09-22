import { describe, expect, it } from 'vitest';
import { buildReport, costMattersToSome } from './report';
import type { Point } from '$lib/shared/report';
import type { Aggregates } from '$lib/shared/types';

const options = [
	{ id: 'o1', label: 'Tapas', note: '', cost: 25 },
	{ id: 'o2', label: 'Beach', note: '', cost: 15 }
];
const points: Point[] = [
	{ id: 'p1', text: 'One person wants somewhere central.', type: 'reason', optionIds: ['o1'] },
	{ id: 'p2', text: 'One person is on a tight budget.', type: 'cost', optionIds: ['o1'] },
	{ id: 'p3', text: 'The beach only works if dry.', type: 'condition', optionIds: ['o2'] }
];
const quotable = new Set(['p1', 'p3']);
const meta = {
	provider: 'fake' as const,
	model: 'fake-fast',
	promptVersion: 'v1',
	generatedAt: '2026-09-18T00:00:00.000Z'
};
const output = {
	best: { optionId: 'o1', verdict: 'Tapas.', rationale: 'Most.', consensus: 'strong' as const },
	runnerUp: { optionId: 'o2', rationale: 'Second.' },
	worst: { optionId: 'o2', rationale: 'Last.' },
	unexpected: { kind: 'option' as const, optionId: 'o2', title: 'Beach', rationale: 'Undersold.' },
	themes: [
		{ title: 'Place', summary: 'Central.', quotePointIds: ['p1', 'p1', 'p2', 'nope'] },
		{ title: 'Weather', summary: 'Dry.', quotePointIds: ['p3'] },
		{ title: 'Time', summary: 'Early.', quotePointIds: [] }
	],
	stillToSettle: ['Rain'],
	summary: 'Tapas it is.'
};

const freeformOutput = {
	unexpected: {
		kind: 'suggestion' as const,
		optionId: null,
		title: 'Split by item',
		rationale: 'Two asked.'
	},
	themes: output.themes,
	stillToSettle: output.stillToSettle,
	summary: output.summary
};

describe('buildReport', () => {
	it('embeds quote text, dedupes ids, and drops cost-tagged or unknown ids', () => {
		const report = buildReport(output, points, quotable, options, 'ranked', meta);
		expect(report.version).toBe(2);
		expect(report.mode).toBe('ranked');
		expect(report.decision).toMatchObject({
			best: { optionId: 'o1', verdict: 'Tapas.', consensus: 'strong' },
			runnerUp: { optionId: 'o2' },
			worst: { optionId: 'o2' }
		});
		expect(report.themes[0].quotes).toEqual([
			{ pointId: 'p1', text: 'One person wants somewhere central.' }
		]);
		expect(report.themes[1].quotes).toEqual([
			{ pointId: 'p3', text: 'The beach only works if dry.' }
		]);
		expect(report.themes[2].quotes).toEqual([]);
		expect(report.unexpected).toEqual({
			kind: 'option',
			optionId: 'o2',
			title: 'Beach',
			rationale: 'Undersold.'
		});
		expect(report).toMatchObject(meta);
		expect(JSON.stringify(report)).not.toContain('tight budget');
	});

	it('nulls an unexpected option the event does not have, and keeps suggestions', () => {
		const withBadOption = buildReport(
			{ ...output, unexpected: { kind: 'option', optionId: 'zzz', title: 'x', rationale: 'y' } },
			points,
			quotable,
			options,
			'ranked',
			meta
		);
		expect(withBadOption.unexpected).toBeNull();
		const suggestion = buildReport(
			{
				...output,
				unexpected: { kind: 'suggestion', optionId: null, title: 'Flamenco', rationale: 'Asked.' }
			},
			points,
			quotable,
			options,
			'ranked',
			meta
		);
		expect(suggestion.unexpected?.kind).toBe('suggestion');
	});

	it('replaces em and en dashes in model text with plain dashes', () => {
		const dashed = buildReport(
			{
				...output,
				summary: 'Tapas it is\u2014decide the time later\u2013soon.',
				themes: output.themes.map((t) => ({ ...t, summary: 'Central\u2014or close.' }))
			},
			points,
			quotable,
			options,
			'ranked',
			meta
		);
		expect(dashed.summary).toBe('Tapas it is-decide the time later-soon.');
		expect(dashed.themes[0].summary).toBe('Central-or close.');
		expect(JSON.stringify(dashed)).not.toMatch(/\u2014|\u2013/);
	});

	it('rejects headline options the event does not have', () => {
		expect(() =>
			buildReport(
				{ ...output, best: { ...output.best, optionId: 'zzz' } },
				points,
				quotable,
				options,
				'ranked',
				meta
			)
		).toThrow(/unknown option/);
	});

	it('leaves an opinions-only report without a decision', () => {
		const report = buildReport(freeformOutput, points, quotable, [], 'freeform', meta);
		expect(report.version).toBe(2);
		expect(report.mode).toBe('freeform');
		expect(report.decision).toBeNull();
		expect(report.summary).toBe('Tapas it is.');
		expect(report.themes[1].quotes).toEqual([
			{ pointId: 'p3', text: 'The beach only works if dry.' }
		]);
		expect(report.unexpected?.kind).toBe('suggestion');
	});

	it('ignores a decision and an unexpected option in an opinions-only report', () => {
		const report = buildReport(output, points, quotable, options, 'freeform', meta);
		expect(report.decision).toBeNull();
		expect(report.unexpected).toBeNull();
	});

	it('holds every single-choice card to the votes and refuses a winner that is not a leader', () => {
		const votes = (o1: number, o2: number) => [
			{ optionId: 'o1', count: o1 },
			{ optionId: 'o2', count: o2 }
		];
		expect(() =>
			buildReport(output, points, quotable, options, 'single', meta, votes(1, 3))
		).toThrow(/has the most votes/);
		const tied = buildReport(output, points, quotable, options, 'single', meta, votes(3, 3));
		expect(tied.decision).toMatchObject({
			best: { optionId: 'o1' },
			runnerUp: { optionId: 'o2' },
			worst: { optionId: 'o2' }
		});
		const swapped = buildReport(
			{
				...output,
				runnerUp: { ...output.runnerUp, optionId: 'o1' },
				worst: { ...output.worst, optionId: 'o1' }
			},
			points,
			quotable,
			options,
			'single',
			meta,
			votes(4, 1)
		);
		expect(swapped.decision).toMatchObject({
			best: { optionId: 'o1', verdict: 'Tapas.' },
			runnerUp: { optionId: 'o2' },
			worst: { optionId: 'o2' }
		});
		expect(
			buildReport(output, points, quotable, options, 'ranked', meta, votes(1, 3)).decision?.best
				.optionId
		).toBe('o1');
	});

	it('keeps the decision for a single-choice event', () => {
		const report = buildReport(output, points, quotable, options, 'single', meta);
		expect(report.mode).toBe('single');
		expect(report.decision?.best.optionId).toBe('o1');
		expect(report.decision?.worst.optionId).toBe('o2');
	});
});

describe('costMattersToSome', () => {
	const base: Aggregates = {
		approvedCount: 6,
		firstChoice: [],
		rankMatrix: [],
		vetoes: [],
		borda: [],
		condorcetWinner: null,
		cost: { answered: 5, rows: [{ optionId: 'o1', cost: 25, overBudget: 0 }] }
	};
	it('is true only when some cost count is suppressed but not zero', () => {
		expect(costMattersToSome(base)).toBe(false);
		expect(
			costMattersToSome({
				...base,
				cost: { answered: 5, rows: [{ optionId: 'o1', cost: 25, overBudget: 2 }] }
			})
		).toBe(true);
		expect(
			costMattersToSome({
				...base,
				cost: { answered: 5, rows: [{ optionId: 'o1', cost: 25, overBudget: 3 }] }
			})
		).toBe(false);
		expect(costMattersToSome({ ...base, cost: { answered: 1, rows: [] } })).toBe(true);
		expect(costMattersToSome({ ...base, cost: null })).toBe(false);
	});
});
