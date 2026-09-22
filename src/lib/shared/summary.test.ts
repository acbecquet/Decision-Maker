import { describe, expect, it } from 'vitest';
import type { ReportView } from './report';
import { copySummary } from './summary';

const view: ReportView = {
	title: 'Saturday night',
	context: '',
	currency: 'EUR',
	mode: 'ranked',
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
		version: 2,
		mode: 'ranked',
		decision: {
			best: { optionId: 'o1', verdict: 'Tapas wins.', rationale: 'r', consensus: 'strong' },
			runnerUp: { optionId: 'o2', rationale: 'r' },
			worst: { optionId: 'o3', rationale: 'r' }
		},
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

	it('reads as votes in a single-choice event', () => {
		const single: ReportView = {
			...view,
			mode: 'single',
			report: { ...view.report, mode: 'single' }
		};
		const text = copySummary(single);
		expect(text).toContain('Winner: Tapas crawl (€25)');
		expect(text).toContain('Runner-up: Beach BBQ (€15)');
		expect(text).toContain('Fewest votes: Paella class');
		expect(text).not.toContain('Best:');
		expect(text).not.toContain('Worst:');
	});

	it('names the last option once when it is also the runner-up', () => {
		const two: ReportView = {
			...view,
			mode: 'single',
			report: {
				...view.report,
				mode: 'single',
				decision: {
					...view.report.decision!,
					worst: {
						...view.report.decision!.worst,
						optionId: view.report.decision!.runnerUp.optionId
					}
				}
			}
		};
		const text = copySummary(two);
		expect(text).toContain('Runner-up: Beach BBQ (€15)');
		expect(text).not.toContain('Fewest votes');
	});

	it('is the paragraph, the unexpected line, and the footer in an opinions-only event', () => {
		const freeform: ReportView = {
			...view,
			mode: 'freeform',
			options: [],
			tallies: { approvedCount: 5, breakdown: null },
			report: { ...view.report, mode: 'freeform', decision: null }
		};
		expect(copySummary(freeform)).toBe(
			[
				'Saturday night',
				'',
				'The group leans toward tapas.',
				'',
				'Unexpected: A flamenco show',
				'',
				'5 responses. Opinions were rewritten by AI to protect anonymity.'
			].join('\n')
		);
		expect(copySummary(freeform)).not.toContain('Best:');
		expect(copySummary(freeform)).not.toContain('Winner:');
	});
});
