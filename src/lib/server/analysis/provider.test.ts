import { describe, expect, it } from 'vitest';
import { fakeAnonymize, fakeProvider, fakeSynthesize } from './fake';
import { getProvider, isFakeProviderAllowed, listProviders } from './provider';
import { anonymizeOutput, synthesizeOutput } from './schemas';
import type { SynthesizeInput } from './prompts';

const options = [
	{ id: 'o1', label: 'Tapas crawl', note: '', cost: 25 },
	{ id: 'o2', label: 'Beach BBQ', note: '', cost: 15 },
	{ id: 'o3', label: 'Paella class', note: '', cost: null }
];

describe('provider registry', () => {
	it('exposes the fake provider only when the environment allows it', () => {
		expect(isFakeProviderAllowed({ ALLOW_FAKE_PROVIDER: '1' })).toBe(true);
		expect(isFakeProviderAllowed({})).toBe(false);
		expect(getProvider('fake', { ALLOW_FAKE_PROVIDER: '1' })).toBe(fakeProvider);
		expect(() => getProvider('fake', {})).toThrow(/Unknown provider/);
		expect(() => getProvider('nope', { ALLOW_FAKE_PROVIDER: '1' })).toThrow(/Unknown provider/);
		expect(getProvider('anthropic', {}).id).toBe('anthropic');
		expect(getProvider('openai', {}).id).toBe('openai');
		expect(getProvider('openrouter', {}).id).toBe('openrouter');
	});

	it('lists the three real providers, plus the fake one when allowed', () => {
		expect(listProviders({}).map((p) => p.id)).toEqual(['anthropic', 'openai', 'openrouter']);
		expect(listProviders({ ALLOW_FAKE_PROVIDER: '1' }).map((p) => p.id)).toEqual([
			'anthropic',
			'openai',
			'openrouter',
			'fake'
		]);
		expect(listProviders({}).find((p) => p.id === 'openrouter')?.auth).toBe('connect');
	});
});

describe('fakeAnonymize', () => {
	it('never echoes the opinion, tags money talk as cost, and adds a suggestion point', () => {
		const out = fakeAnonymize({
			options,
			currency: 'EUR',
			ranking: ['o1', 'o2'],
			vetoes: [],
			opinion: 'SENTINEL central is key. I cannot afford the rooftop! Sunday flight is early.',
			suggestion: 'SENTINEL flamenco'
		});
		expect(anonymizeOutput.safeParse(out).success).toBe(true);
		expect(JSON.stringify(out)).not.toContain('SENTINEL');
		expect(out.points.map((p) => p.type)).toEqual(['reason', 'cost', 'constraint', 'suggestion']);
		expect(out.points[0]).toEqual({
			text: 'One person gave a reason that favours Tapas crawl.',
			type: 'reason',
			optionIds: ['o1']
		});
		expect(out.points[1].text).toBe('One person is on a tight budget.');
		expect(out.points[3].optionIds).toEqual([]);
	});

	it('returns no points for empty text', () => {
		const out = fakeAnonymize({
			options,
			currency: 'EUR',
			ranking: [],
			vetoes: [],
			opinion: '  ',
			suggestion: ''
		});
		expect(out.points).toEqual([]);
	});
});

describe('fakeSynthesize', () => {
	const input: SynthesizeInput = {
		title: 'Saturday night',
		context: '',
		currency: 'EUR',
		options,
		tallies: {
			approvedCount: 5,
			breakdown: {
				firstChoice: [],
				rankMatrix: [],
				vetoes: [],
				borda: [
					{ optionId: 'o1', score: 7 },
					{ optionId: 'o2', score: 9 },
					{ optionId: 'o3', score: 1 }
				],
				condorcetWinner: 'o2',
				cost: null
			}
		},
		costMattersToSome: false,
		groups: [
			[
				{
					id: 'p1',
					text: 'One person gave a reason that favours Beach BBQ.',
					type: 'reason',
					optionIds: ['o2']
				},
				{ id: 'p2', text: 'One person is on a tight budget.', type: 'cost', optionIds: ['o2'] }
			],
			[
				{
					id: 'p3',
					text: 'One person gave a condition that favours Tapas crawl.',
					type: 'condition',
					optionIds: ['o1']
				}
			]
		]
	};

	it('ranks by Borda, never quotes cost points, and validates against the schema', () => {
		const out = fakeSynthesize(input);
		expect(synthesizeOutput.safeParse(out).success).toBe(true);
		expect(out.best).toMatchObject({ optionId: 'o2', consensus: 'strong' });
		expect(out.runnerUp.optionId).toBe('o1');
		expect(out.worst.optionId).toBe('o3');
		expect(out.unexpected).toBeNull();
		expect(out.themes.map((t) => t.quotePointIds)).toEqual([['p1'], ['p3'], []]);
		expect(out.themes.some((t) => /^0 /.test(t.summary))).toBe(false);
		expect(out.stillToSettle).toHaveLength(1);
		expect(out.summary).toContain('Beach BBQ');
	});

	it('falls back to option order below the breakdown threshold', () => {
		const out = fakeSynthesize({ ...input, tallies: { approvedCount: 3, breakdown: null } });
		expect(out.best.optionId).toBe('o1');
		expect(out.worst.optionId).toBe('o3');
		expect(out.best.consensus).toBe('moderate');
	});
});

describe('fakeProvider', () => {
	it('lists two models and answers from the stage payload', async () => {
		const models = await fakeProvider.listModels('any-key');
		expect(models.map((m) => m.id)).toEqual(['fake-fast', 'fake-slow']);
		const out = await fakeProvider.completeJson({
			key: 'k',
			model: 'fake-fast',
			effort: 'max',
			system: 's',
			user: 'u',
			schemaName: 'anonymize',
			schema: {},
			maxTokens: 10,
			payload: {
				stage: 'anonymize',
				input: {
					options,
					currency: 'EUR',
					ranking: ['o3'],
					vetoes: [],
					opinion: 'Fun.',
					suggestion: ''
				}
			}
		});
		expect(anonymizeOutput.parse(out).points[0].optionIds).toEqual(['o3']);
		await expect(
			fakeProvider.completeJson({
				key: 'k',
				model: 'fake-broken',
				effort: 'max',
				system: 's',
				user: 'u',
				schemaName: 'anonymize',
				schema: {},
				maxTokens: 10,
				payload: {
					stage: 'anonymize',
					input: { options, currency: 'EUR', ranking: [], vetoes: [], opinion: 'x', suggestion: '' }
				}
			})
		).rejects.toThrow(/told to fail/);
	});
});
