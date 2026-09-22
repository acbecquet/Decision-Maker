/**
 * Manual spot-check against a real provider. Skipped unless LIVE_KEY_FILE points at a file holding
 * an OpenRouter key. Allowed to be flaky; never part of the required gates. The key is read from the
 * file and passed to the adapter only; nothing here prints it.
 *
 *   LIVE_KEY_FILE=decision-maker-openrouter-key.txt npx vitest run src/lib/server/analysis/providers/live.spec.ts
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ThinkingEffort } from '$lib/shared/report';
import {
	anonymizePrompt,
	synthesizePrompt,
	type AnonymizeInput,
	type SynthesizeInput
} from '../prompts';
import { ANONYMIZE_SCHEMA, SYNTHESIZE_SCHEMA, anonymizeOutput, synthesizeOutput } from '../schemas';
import { createOpenRouterProvider } from './openrouter';

const keyFile = process.env.LIVE_KEY_FILE;
const model = process.env.LIVE_MODEL ?? '~deepseek/deepseek-pro-latest';
const effort = (process.env.LIVE_EFFORT ?? 'max') as ThinkingEffort;

const options = [
	{ id: 'o1', label: 'Tapas crawl in El Born', note: 'Central, easy to split', cost: 25 },
	{ id: 'o2', label: 'Beach BBQ at Barceloneta', note: '', cost: 15 },
	{ id: 'o3', label: 'Rooftop bar', note: 'Views', cost: 45 }
];

describe.skipIf(!keyFile)('live OpenRouter spot-check', () => {
	const key = keyFile ? readFileSync(keyFile, 'utf8').trim() : '';
	const provider = createOpenRouterProvider({ origin: 'https://decide.acb-apps.com' });

	it('lists models with the DeepSeek alias first', async () => {
		const models = await provider.listModels(key);
		expect(models.length).toBeGreaterThan(50);
		expect(models[0].id).toBe('~deepseek/deepseek-pro-latest');
	}, 60_000);

	it('anonymizes an opinion into typed points without echoing it', async () => {
		const input: AnonymizeInput = {
			options,
			currency: 'EUR',
			mode: 'ranked',
			ranking: ['o2', 'o1'],
			vetoes: ['o3'],
			opinion:
				"I booked the hotel so I'd rather stay close to it. Beach is great unless it rains. Honestly I only have about 40 euros left for the whole weekend so the rooftop is out for me.",
			suggestion: 'A flamenco show near the hotel'
		};
		const { system, user } = anonymizePrompt(input);
		const raw = await provider.completeJson({
			key,
			model,
			effort,
			system,
			user,
			schemaName: 'anonymize',
			schema: ANONYMIZE_SCHEMA,
			maxTokens: 16_000,
			payload: { stage: 'anonymize', input }
		});
		const out = anonymizeOutput.parse(raw);
		console.log(JSON.stringify(out, null, 2));
		expect(out.points.length).toBeGreaterThanOrEqual(2);
		const text = JSON.stringify(out).toLowerCase();
		expect(text).not.toContain('40 euros');
		expect(text).not.toContain('booked the hotel');
		expect(out.points.some((p) => p.type === 'cost')).toBe(true);
	}, 180_000);

	it('synthesizes a report from points and numbers', async () => {
		const input: SynthesizeInput = {
			title: 'Saturday night in Barcelona',
			context: 'Dinner plans for the group',
			currency: 'EUR',
			mode: 'ranked',
			options,
			tallies: {
				approvedCount: 6,
				breakdown: {
					firstChoice: [
						{ optionId: 'o1', count: 4 },
						{ optionId: 'o2', count: 2 },
						{ optionId: 'o3', count: 0 }
					],
					rankMatrix: [
						{ optionId: 'o1', ranks: [4, 2, 0], unranked: 0 },
						{ optionId: 'o2', ranks: [2, 3, 0], unranked: 1 },
						{ optionId: 'o3', ranks: [0, 1, 2], unranked: 3 }
					],
					vetoes: [
						{ optionId: 'o1', count: 0 },
						{ optionId: 'o2', count: 1 },
						{ optionId: 'o3', count: 2 }
					],
					borda: [
						{ optionId: 'o1', score: 10 },
						{ optionId: 'o2', score: 7 },
						{ optionId: 'o3', score: 2 }
					],
					condorcetWinner: 'o1',
					cost: {
						answered: 5,
						rows: [
							{ optionId: 'o1', cost: 25, overBudget: null },
							{ optionId: 'o2', cost: 15, overBudget: null },
							{ optionId: 'o3', cost: 45, overBudget: 3 }
						]
					}
				}
			},
			costMattersToSome: true,
			groups: [
				[
					{
						id: 'p1',
						text: 'One person wants to stay close to the hotel.',
						type: 'reason',
						optionIds: ['o1']
					},
					{
						id: 'p2',
						text: 'The beach only works if it stays dry.',
						type: 'condition',
						optionIds: ['o2']
					},
					{ id: 'p3', text: 'One person is on a tight budget.', type: 'cost', optionIds: ['o3'] }
				],
				[
					{
						id: 'p4',
						text: 'One person prefers somewhere with a view.',
						type: 'reason',
						optionIds: ['o3']
					},
					{
						id: 'p5',
						text: 'One person has an early flight on Sunday.',
						type: 'constraint',
						optionIds: []
					}
				],
				[
					{
						id: 'p6',
						text: 'One person suggested a flamenco show.',
						type: 'suggestion',
						optionIds: []
					}
				]
			]
		};
		const { system, user } = synthesizePrompt(input);
		const raw = await provider.completeJson({
			key,
			model,
			effort,
			system,
			user,
			schemaName: 'synthesize',
			schema: SYNTHESIZE_SCHEMA,
			maxTokens: 32_000,
			payload: { stage: 'synthesize', input }
		});
		const out = synthesizeOutput.parse(raw);
		console.log(JSON.stringify(out, null, 2));
		expect(['o1', 'o2', 'o3']).toContain(out.best.optionId);
		expect(out.themes.flatMap((t) => t.quotePointIds)).not.toContain('p3');
	}, 660_000);
});
