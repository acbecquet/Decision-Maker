import { describe, expect, it } from 'vitest';
import {
	checkOptionRefs,
	checkResponseForMode,
	createEventInput,
	editResponseInput,
	modelsInput,
	responseInput,
	runAnalysisInput
} from './validation';

const validEvent = {
	title: 'Saturday night',
	context: '',
	currency: 'EUR',
	options: [
		{ label: 'Tapas', note: '', cost: 25 },
		{ label: 'Beach', note: 'bring towels', cost: null }
	],
	closesAt: null
};

describe('createEventInput', () => {
	it('accepts a valid event and applies defaults', () => {
		const result = createEventInput.safeParse({
			title: '  Saturday night ',
			currency: 'EUR',
			options: [{ label: 'Tapas' }, { label: 'Beach' }]
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.title).toBe('Saturday night');
			expect(result.data.context).toBe('');
			expect(result.data.options[0]).toEqual({ label: 'Tapas', note: '', cost: null });
			expect(result.data.closesAt).toBeNull();
		}
	});

	it('rejects fewer than two options', () => {
		const result = createEventInput.safeParse({ ...validEvent, options: [validEvent.options[0]] });
		expect(result.success).toBe(false);
	});

	it('rejects more than two decimals in a cost', () => {
		const result = createEventInput.safeParse({
			...validEvent,
			options: [{ label: 'A', cost: 12.345 }, { label: 'B' }]
		});
		expect(result.success).toBe(false);
	});

	it('rejects an unknown currency', () => {
		expect(createEventInput.safeParse({ ...validEvent, currency: 'XXX' }).success).toBe(false);
	});

	it('rejects a title over 80 characters', () => {
		expect(createEventInput.safeParse({ ...validEvent, title: 'x'.repeat(81) }).success).toBe(
			false
		);
	});
});

describe('responseInput', () => {
	it('requires a name and leaves an empty ranking to the mode rule', () => {
		expect(responseInput.safeParse({ name: '', ranking: ['a'] }).success).toBe(false);
		expect(responseInput.safeParse({ name: 'Alex', ranking: [] }).success).toBe(true);
	});

	it('applies defaults for the optional fields', () => {
		const result = responseInput.safeParse({ name: 'Alex', ranking: ['a'] });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual({
				name: 'Alex',
				ranking: ['a'],
				vetoes: [],
				budget: null,
				opinion: '',
				suggestion: ''
			});
		}
	});

	it('accepts both budget shapes', () => {
		expect(
			responseInput.safeParse({ name: 'A', ranking: ['a'], budget: { kind: 'limit', amount: 30 } })
				.success
		).toBe(true);
		expect(
			responseInput.safeParse({ name: 'A', ranking: ['a'], budget: { kind: 'no_limit' } }).success
		).toBe(true);
		expect(
			responseInput.safeParse({ name: 'A', ranking: ['a'], budget: { kind: 'limit' } }).success
		).toBe(false);
	});

	it('caps the opinion at 2000 characters', () => {
		expect(
			responseInput.safeParse({ name: 'A', ranking: ['a'], opinion: 'x'.repeat(2001) }).success
		).toBe(false);
	});

	it('edit input has no name', () => {
		const result = editResponseInput.safeParse({ name: 'ignored', ranking: ['a'] });
		expect(result.success).toBe(true);
		if (result.success) expect('name' in result.data).toBe(false);
	});
});

describe('analysis inputs', () => {
	it('accepts a provider, key, model, and effort, defaulting effort to max', () => {
		expect(modelsInput.parse({ provider: 'openrouter', key: 'sk-or-x1234567890' })).toEqual({
			provider: 'openrouter',
			key: 'sk-or-x1234567890'
		});
		const run = runAnalysisInput.parse({ provider: 'fake', key: 'k', model: ' fake-fast ' });
		expect(run).toEqual({ provider: 'fake', key: 'k', model: 'fake-fast', effort: 'max' });
		expect(runAnalysisInput.safeParse({ provider: 'nope', key: 'k', model: 'm' }).success).toBe(
			false
		);
		expect(runAnalysisInput.safeParse({ provider: 'fake', key: '', model: 'm' }).success).toBe(
			false
		);
		expect(
			runAnalysisInput.safeParse({ provider: 'fake', key: 'k', model: 'm', effort: 'ultra' })
				.success
		).toBe(false);
	});

	it('requires a real-looking key for a real provider but accepts any non-empty key for fake', () => {
		const short = modelsInput.safeParse({ provider: 'anthropic', key: 'short' });
		expect(short.success).toBe(false);
		if (!short.success) {
			expect(short.error.issues[0].message).toBe('That does not look like an API key');
			expect(short.error.issues[0].path).toEqual(['key']);
		}
		expect(modelsInput.safeParse({ provider: 'anthropic', key: 'x'.repeat(16) }).success).toBe(
			true
		);
		expect(modelsInput.safeParse({ provider: 'fake', key: 'demo' }).success).toBe(true);

		expect(
			runAnalysisInput.safeParse({ provider: 'openai', key: 'short', model: 'm' }).success
		).toBe(false);
		expect(
			runAnalysisInput.safeParse({ provider: 'openai', key: 'x'.repeat(16), model: 'm' }).success
		).toBe(true);
		expect(runAnalysisInput.safeParse({ provider: 'fake', key: 'demo', model: 'm' }).success).toBe(
			true
		);
	});
});

describe('mode rules', () => {
	const base = { title: 'T', context: '', currency: 'EUR' as const, closesAt: null };
	const two = [
		{ label: 'Yes', note: '', cost: null },
		{ label: 'No', note: '', cost: null }
	];

	it('defaults the mode to ranked and needs two options unless opinions only', () => {
		expect(createEventInput.parse({ ...base, options: two }).mode).toBe('ranked');
		expect(createEventInput.safeParse({ ...base, mode: 'single', options: two }).success).toBe(
			true
		);
		expect(
			createEventInput.safeParse({ ...base, mode: 'ranked', options: [two[0]] }).error?.issues[0]
				?.message
		).toBe('Add at least two options');
		expect(createEventInput.safeParse({ ...base, mode: 'freeform', options: [] }).success).toBe(
			true
		);
		expect(
			createEventInput.safeParse({ ...base, mode: 'freeform', options: two }).error?.issues[0]
				?.message
		).toBe('Opinions only takes no options');
	});

	it('checks a submission against the mode', () => {
		const answer = { ranking: ['a'], vetoes: [], budget: null, opinion: 'ok', suggestion: '' };
		expect(checkResponseForMode('ranked', answer)).toBeNull();
		expect(checkResponseForMode('ranked', { ...answer, ranking: [] })).toBe(
			'Rank at least one option'
		);
		expect(checkResponseForMode('single', answer)).toBeNull();
		expect(checkResponseForMode('single', { ...answer, ranking: ['a', 'b'] })).toBe(
			'Pick one option'
		);
		expect(checkResponseForMode('single', { ...answer, vetoes: ['b'] })).toBe('Pick one option');
		expect(checkResponseForMode('freeform', { ...answer, ranking: [] })).toBeNull();
		expect(checkResponseForMode('freeform', answer)).toBe('Opinions only takes no ranking');
		expect(checkResponseForMode('freeform', { ...answer, ranking: [], opinion: ' ' })).toBe(
			'Write your opinion'
		);
		expect(
			checkResponseForMode('freeform', { ...answer, ranking: [], budget: { kind: 'no_limit' } })
		).toBe('Opinions only takes no ranking');
	});
});

describe('checkOptionRefs', () => {
	it('returns null for a clean ranking', () => {
		expect(checkOptionRefs(['a', 'b'], ['c'], ['a', 'b', 'c'])).toBeNull();
	});

	it('flags repeats and unknown ids', () => {
		expect(checkOptionRefs(['a', 'a'], [], ['a', 'b'])).toMatch(/repeats/);
		expect(checkOptionRefs(['a', 'z'], [], ['a', 'b'])).toMatch(/unknown/);
		expect(checkOptionRefs(['a'], ['z'], ['a', 'b'])).toMatch(/unknown/);
	});
});
