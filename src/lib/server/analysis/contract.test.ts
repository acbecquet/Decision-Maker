import { describe, expect, it } from 'vitest';
import { ProviderError, capUpstreamMessage, parseJsonText, preferFirst, redact } from './contract';

describe('parseJsonText', () => {
	it('parses a bare object and one wrapped in prose or fences', () => {
		expect(parseJsonText('{"a":1}')).toEqual({ a: 1 });
		expect(parseJsonText('Here you go:\n```json\n{"a":[1,2]}\n```\nDone.')).toEqual({ a: [1, 2] });
	});

	it('throws a non-retryable ProviderError for missing or malformed JSON', () => {
		expect(() => parseJsonText('no json here')).toThrow(ProviderError);
		try {
			parseJsonText('{"a":');
		} catch (e) {
			expect(e).toBeInstanceOf(ProviderError);
			expect((e as ProviderError).retryable).toBe(false);
		}
	});
});

describe('redact', () => {
	it('replaces every occurrence of the key and leaves short keys alone', () => {
		expect(
			redact('bad key sk-or-v1-abcdefgh used twice sk-or-v1-abcdefgh', 'sk-or-v1-abcdefgh')
		).toBe('bad key [key] used twice [key]');
		expect(redact('short', 'ab')).toBe('short');
	});
});

describe('capUpstreamMessage', () => {
	it('flattens whitespace and caps the length, so a verbose upstream body cannot blow up an error', () => {
		expect(capUpstreamMessage('bad request')).toBe('bad request');
		expect(capUpstreamMessage('line one\n\n  line   two\ttabbed')).toBe('line one line two tabbed');
		expect(capUpstreamMessage('  padded  ')).toBe('padded');
		const long = capUpstreamMessage('x'.repeat(500));
		expect(long).toHaveLength(200);
		expect(long).toBe('x'.repeat(200));
	});
});

describe('preferFirst', () => {
	it('moves the first present preferred id to the front and keeps the rest in order', () => {
		const models = [
			{ id: 'b', label: 'B' },
			{ id: 'c', label: 'C' },
			{ id: 'a', label: 'A' }
		];
		expect(preferFirst(models, ['zzz', 'c']).map((m) => m.id)).toEqual(['c', 'b', 'a']);
		expect(preferFirst(models, ['zzz']).map((m) => m.id)).toEqual(['b', 'c', 'a']);
	});
});
