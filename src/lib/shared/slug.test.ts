import { describe, expect, it } from 'vitest';
import { eventPath, slugify } from './slug';

describe('slugify', () => {
	it('lowercases, drops accents, and joins words with single hyphens', () => {
		expect(slugify('Axis Powers Themed Dinner Date + Dishes')).toBe(
			'axis-powers-themed-dinner-date-dishes'
		);
		expect(slugify('  Café  Central!  ')).toBe('cafe-central');
	});

	it('cuts long titles at 60 characters without a dangling hyphen', () => {
		const slug = slugify('word '.repeat(30));
		expect(slug.length).toBeLessThanOrEqual(60);
		expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
	});

	it('gives nothing for a title with no letters or digits it can keep', () => {
		expect(slugify('日本語')).toBe('');
		expect(slugify('---')).toBe('');
	});

	it('spells the Latin letters that decomposition leaves alone', () => {
		expect(slugify('Straße Fest')).toBe('strasse-fest');
		expect(slugify('Æon Flux night')).toBe('aeon-flux-night');
		expect(slugify('Øl og Łódź')).toBe('ol-og-lodz');
	});
});

describe('eventPath', () => {
	it('adds the slug after the code and leaves it out when empty or reserved', () => {
		expect(eventPath('abc', 'Axis dinner')).toBe('/e/abc/axis-dinner');
		expect(eventPath('abc', '日本語')).toBe('/e/abc');
		expect(eventPath('abc', 'Edit')).toBe('/e/abc');
		expect(eventPath('abc', 'Édit!')).toBe('/e/abc');
	});
});
