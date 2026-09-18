import { describe, expect, it } from 'vitest';
import {
	checkOptionRefs,
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
	it('requires a name and at least one ranked option', () => {
		expect(responseInput.safeParse({ name: '', ranking: ['a'] }).success).toBe(false);
		expect(responseInput.safeParse({ name: 'Alex', ranking: [] }).success).toBe(false);
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
		expect(modelsInput.parse({ provider: 'openrouter', key: 'sk-or-x' })).toEqual({
			provider: 'openrouter',
			key: 'sk-or-x'
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
