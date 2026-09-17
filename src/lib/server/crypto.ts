import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { EVENT_CODE_ALPHABET, EVENT_CODE_LENGTH } from '$lib/shared/constants';

export function sha256Hex(input: string): string {
	return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Constant-time comparison of two strings of equal length. Unequal lengths are simply false. */
export function safeEqualHex(a: string, b: string): boolean {
	if (a.length === 0 || a.length !== b.length) return false;
	return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export function isTokenShape(value: string | null | undefined): value is string {
	return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/** Ten characters from a 32-symbol alphabet: 32 divides 256, so a byte maps evenly. */
export function newEventCode(): string {
	const bytes = randomBytes(EVENT_CODE_LENGTH);
	let out = '';
	for (const b of bytes) out += EVENT_CODE_ALPHABET[b % EVENT_CODE_ALPHABET.length];
	return out;
}

export function newId(): string {
	return crypto.randomUUID();
}
