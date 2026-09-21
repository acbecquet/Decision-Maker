import { describe, expect, it } from 'vitest';
import { slugify } from './slug';

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
});
