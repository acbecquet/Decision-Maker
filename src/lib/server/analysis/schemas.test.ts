import { describe, expect, it } from 'vitest';
import {
	ANONYMIZE_SCHEMA,
	SYNTHESIZE_SCHEMA,
	anonymizeOutput,
	synthesizeOutput,
	assertStrict
} from './schemas';

describe('provider JSON schemas', () => {
	it('are strict: every object forbids extra keys and requires every property', () => {
		expect(() => assertStrict(ANONYMIZE_SCHEMA)).not.toThrow();
		expect(() => assertStrict(SYNTHESIZE_SCHEMA)).not.toThrow();
		expect(() =>
			assertStrict({ type: 'object', properties: { a: { type: 'string' } }, required: [] })
		).toThrow(/required/);
		expect(() =>
			assertStrict({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] })
		).toThrow(/additionalProperties/);
	});

	it('use no keywords the providers reject', () => {
		const text = JSON.stringify([ANONYMIZE_SCHEMA, SYNTHESIZE_SCHEMA]);
		for (const banned of ['minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'pattern']) {
			expect(text).not.toContain(`"${banned}"`);
		}
	});
});

describe('anonymizeOutput', () => {
	it('accepts typed points, strips unknown keys, and rejects unknown types', () => {
		const ok = anonymizeOutput.safeParse({
			points: [
				{ text: 'One person prefers a central place.', type: 'reason', optionIds: ['a'], extra: 1 }
			]
		});
		expect(ok.success).toBe(true);
		if (ok.success) expect(ok.data.points[0]).not.toHaveProperty('extra');
		expect(anonymizeOutput.safeParse({ points: [] }).success).toBe(true);
		expect(
			anonymizeOutput.safeParse({ points: [{ text: 'x', type: 'joke', optionIds: [] }] }).success
		).toBe(false);
		expect(
			anonymizeOutput.safeParse({ points: [{ text: '', type: 'reason', optionIds: [] }] }).success
		).toBe(false);
	});
});

describe('synthesizeOutput', () => {
	const valid = {
		best: {
			optionId: 'a',
			verdict: 'Tapas wins.',
			rationale: 'Most first choices.',
			consensus: 'strong'
		},
		runnerUp: { optionId: 'b', rationale: 'Close second.' },
		worst: { optionId: 'c', rationale: 'Ranked last by most.' },
		unexpected: null,
		themes: [
			{ title: 'Location', summary: 'Central matters.', quotePointIds: ['p1'] },
			{ title: 'Weather', summary: 'Rain changes plans.', quotePointIds: [] },
			{ title: 'Timing', summary: 'Early flights.', quotePointIds: ['p2', 'p3'] }
		],
		stillToSettle: ['Whether it rains'],
		summary: 'The group leans toward tapas.'
	};

	it('accepts a complete synthesis and rejects fewer than three themes', () => {
		expect(synthesizeOutput.safeParse(valid).success).toBe(true);
		expect(synthesizeOutput.safeParse({ ...valid, themes: valid.themes.slice(0, 2) }).success).toBe(
			false
		);
		expect(
			synthesizeOutput.safeParse({
				...valid,
				unexpected: {
					kind: 'suggestion',
					optionId: null,
					title: 'Flamenco',
					rationale: 'Two asked.'
				}
			}).success
		).toBe(true);
		expect(
			synthesizeOutput.safeParse({ ...valid, best: { ...valid.best, consensus: 'unanimous' } })
				.success
		).toBe(false);
	});
});
