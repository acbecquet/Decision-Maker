import { describe, expect, it } from 'vitest';
import { EVENT_CODE_ALPHABET, EVENT_CODE_LENGTH } from '$lib/shared/constants';
import { isTokenShape, newEventCode, newId, safeEqualHex, sha256Hex } from './crypto';

describe('sha256Hex', () => {
	it('hashes deterministically to 64 hex characters', () => {
		const a = sha256Hex('hello');
		expect(a).toMatch(/^[0-9a-f]{64}$/);
		expect(sha256Hex('hello')).toBe(a);
		expect(sha256Hex('hello!')).not.toBe(a);
	});
});

describe('safeEqualHex', () => {
	it('compares equal-length strings and rejects mismatched lengths', () => {
		expect(safeEqualHex('abcd', 'abcd')).toBe(true);
		expect(safeEqualHex('abcd', 'abce')).toBe(false);
		expect(safeEqualHex('abcd', 'abc')).toBe(false);
		expect(safeEqualHex('', '')).toBe(false);
	});
});

describe('isTokenShape', () => {
	it('accepts only 64 lowercase hex characters', () => {
		expect(isTokenShape('a'.repeat(64))).toBe(true);
		expect(isTokenShape('A'.repeat(64))).toBe(false);
		expect(isTokenShape('a'.repeat(63))).toBe(false);
		expect(isTokenShape(null)).toBe(false);
	});
});

describe('newEventCode', () => {
	it('uses only the code alphabet at the right length and does not repeat', () => {
		const codes = new Set<string>();
		for (let i = 0; i < 200; i++) {
			const code = newEventCode();
			expect(code).toHaveLength(EVENT_CODE_LENGTH);
			for (const ch of code) expect(EVENT_CODE_ALPHABET).toContain(ch);
			codes.add(code);
		}
		expect(codes.size).toBe(200);
	});
});

describe('newId', () => {
	it('returns a uuid', () => {
		expect(newId()).toMatch(/^[0-9a-f-]{36}$/);
	});
});
