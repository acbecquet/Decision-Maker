import { describe, expect, it } from 'vitest';
import {
	ANONYMIZE_SCHEMA,
	SYNTHESIZE_SCHEMA,
	SYNTHESIZE_SCHEMA_FREEFORM,
	anonymizeOutput,
	synthesizeOutput,
	synthesizeOutputFor,
	synthesizeOutputFreeform,
	synthesizeSchemaFor,
	assertStrict
} from './schemas';

describe('provider JSON schemas', () => {
	it('are strict: every object forbids extra keys and requires every property', () => {
		expect(() => assertStrict(ANONYMIZE_SCHEMA)).not.toThrow();
		expect(() => assertStrict(SYNTHESIZE_SCHEMA)).not.toThrow();
		expect(() => assertStrict(SYNTHESIZE_SCHEMA_FREEFORM)).not.toThrow();
		expect(() =>
			assertStrict({ type: 'object', properties: { a: { type: 'string' } }, required: [] })
		).toThrow(/required/);
		expect(() =>
			assertStrict({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] })
		).toThrow(/additionalProperties/);
	});

	it('use no keywords the providers reject', () => {
		const text = JSON.stringify([ANONYMIZE_SCHEMA, SYNTHESIZE_SCHEMA, SYNTHESIZE_SCHEMA_FREEFORM]);
		for (const banned of ['minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'pattern']) {
			expect(text).not.toContain(`"${banned}"`);
		}
	});

	it('give an opinions-only event a schema with no decision fields', () => {
		const properties = SYNTHESIZE_SCHEMA_FREEFORM.properties as Record<string, unknown>;
		expect(Object.keys(properties)).toEqual(['unexpected', 'themes', 'stillToSettle', 'summary']);
		expect(synthesizeSchemaFor('freeform')).toBe(SYNTHESIZE_SCHEMA_FREEFORM);
		expect(synthesizeSchemaFor('single')).toBe(SYNTHESIZE_SCHEMA);
		expect(synthesizeSchemaFor('ranked')).toBe(SYNTHESIZE_SCHEMA);
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

	it('accepts more than twelve points and text over 600 characters: the job trims, not the schema', () => {
		const points = Array.from({ length: 13 }, (_, i) => ({
			text: `Point number ${i}.`,
			type: 'reason' as const,
			optionIds: []
		}));
		const result = anonymizeOutput.safeParse({ points });
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.points).toHaveLength(13);
		expect(
			anonymizeOutput.safeParse({
				points: [{ text: 'x'.repeat(700), type: 'reason', optionIds: [] }]
			}).success
		).toBe(true);
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

	it('accepts an opinions-only synthesis without best, runnerUp, or worst', () => {
		const freeform = {
			unexpected: valid.unexpected,
			themes: valid.themes,
			stillToSettle: valid.stillToSettle,
			summary: valid.summary
		};
		expect(synthesizeOutputFreeform.safeParse(freeform).success).toBe(true);
		expect(synthesizeOutput.safeParse(freeform).success).toBe(false);
		expect(synthesizeOutputFreeform.parse(valid)).not.toHaveProperty('best');
		expect(
			synthesizeOutputFreeform.safeParse({
				...freeform,
				unexpected: { kind: 'option', optionId: 'a', title: 'Beach', rationale: 'Undersold.' }
			}).success
		).toBe(false);
		expect(synthesizeOutputFor('freeform')).toBe(synthesizeOutputFreeform);
		expect(synthesizeOutputFor('ranked')).toBe(synthesizeOutput);
	});
});
