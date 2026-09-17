import { describe, expect, it } from 'vitest';
import { formatMoney } from './money';

describe('formatMoney', () => {
	it('drops the decimals for whole amounts', () => {
		expect(formatMoney(25, 'EUR', 'en')).toBe('€25');
	});

	it('keeps two decimals otherwise', () => {
		expect(formatMoney(12.5, 'USD', 'en')).toBe('$12.50');
	});

	it('handles zero-decimal currencies', () => {
		expect(formatMoney(1500, 'JPY', 'en')).toBe('¥1,500');
	});
});
