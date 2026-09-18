import { describe, expect, it } from 'vitest';
import type { ReportView } from './report';
import { copySummary } from './summary';

const view: ReportView = {
	title: 'Saturday night',
	context: '',
	currency: 'EUR',
	state: 'published',
	publishedAt: '2026-09-18T12:00:00.000Z',
	options: [
		{ id: 'o1', label: 'Tapas crawl', note: '', cost: 25 },
		{ id: 'o2', label: 'Beach BBQ', note: '', cost: 15 },
		{ id: 'o3', label: 'Paella class', note: '', cost: null }
	],
	tallies: {
		approvedCount: 6,
		breakdown: {
			firstChoice: [],
			rankMatrix: [],
			vetoes: [],
			borda: [],
			condorcetWinner: 'o1',
			cost: {
				answered: 5,
				rows: [
					{ optionId: 'o1', cost: 25, overBudget: 3 },
					{ optionId: 'o2', cost: 15, overBudget: null }
				]
			}
		}
	},
	report: {
		version: 1,
		best: { optionId: 'o1', verdict: 'Tapas wins.', rationale: 'r', consensus: 'strong' },
		runnerUp: { optionId: 'o2', rationale: 'r' },
		worst: { optionId: 'o3', rationale: 'r' },
		unexpected: { kind: 'suggestion', optionId: null, title: 'A flamenco show', rationale: 'r' },
		themes: [],
		stillToSettle: [],
		summary: 'The group leans toward tapas.',
		provider: 'fake',
		model: 'fake-fast',
		promptVersion: 'v1',
		generatedAt: '2026-09-18T12:00:00.000Z'
	}
};

describe('copySummary', () => {
	it('is the paragraph, the four headlines with prices, the cost line, and the footer', () => {
		expect(copySummary(view)).toBe(
			[
				'Saturday night',
				'',
				'The group leans toward tapas.',
				'',
				'Best: Tapas crawl (€25)',
				'Runner-up: Beach BBQ (€15)',
				'Worst: Paella class',
				'Unexpected: A flamenco show',
				'',
				'Cost: Tapas crawl is over budget for 3',
				'',
				'6 responses. Opinions were rewritten by AI to protect anonymity.'
			].join('\n')
		);
	});

	it('states plainly when no option clears the cost threshold and skips the line without costs', () => {
		const quiet = {
			...view,
			tallies: {
				...view.tallies,
				breakdown: {
					...view.tallies.breakdown!,
					cost: { answered: 5, rows: [{ optionId: 'o1', cost: 25, overBudget: null }] }
				}
			},
			report: { ...view.report, unexpected: null }
		};
		expect(copySummary(quiet)).toContain('Cost: no option is over budget for 3 or more people');
		expect(copySummary(quiet)).not.toContain('Unexpected');
		const free = {
			...view,
			tallies: { ...view.tallies, breakdown: { ...view.tallies.breakdown!, cost: null } }
		};
		expect(copySummary(free)).not.toContain('Cost:');
		const few = { ...view, tallies: { approvedCount: 3, breakdown: null } };
		expect(copySummary(few)).toContain('3 responses.');
		expect(copySummary(few)).not.toContain('Cost:');
	});
});
