import { beforeEach, describe, expect, it } from 'vitest';
import { ensureToken, getToken, newToken, setToken } from './tokens';

class MemoryStorage {
	private map = new Map<string, string>();
	getItem(key: string) {
		return this.map.get(key) ?? null;
	}
	setItem(key: string, value: string) {
		this.map.set(key, value);
	}
	removeItem(key: string) {
		this.map.delete(key);
	}
	clear() {
		this.map.clear();
	}
}

describe('token store', () => {
	beforeEach(() => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: new MemoryStorage(),
			configurable: true
		});
	});

	it('generates 64-hex tokens that differ', () => {
		const a = newToken();
		const b = newToken();
		expect(a).toMatch(/^[0-9a-f]{64}$/);
		expect(a).not.toBe(b);
	});

	it('stores tokens per event and role', () => {
		setToken('abc', 'host', 'h'.repeat(64));
		expect(getToken('abc', 'host')).toBe('h'.repeat(64));
		expect(getToken('abc', 'participant')).toBeNull();
		expect(getToken('xyz', 'host')).toBeNull();
	});

	it('ensureToken creates once and then reuses', () => {
		const first = ensureToken('abc', 'participant');
		expect(ensureToken('abc', 'participant')).toBe(first);
		expect(getToken('abc', 'participant')).toBe(first);
	});
});
