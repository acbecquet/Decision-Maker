import { beforeEach, describe, expect, it } from 'vitest';
import {
	allHostTokens,
	clearEventTokens,
	ensureToken,
	getToken,
	moveToken,
	newToken,
	setToken
} from './tokens';

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
	key(index: number) {
		return [...this.map.keys()][index] ?? null;
	}
	get length() {
		return this.map.size;
	}
}

/** Behaves like MemoryStorage, but fails to write the new key, as a full or blocked store might. */
class FailsToWriteNewKeyStorage extends MemoryStorage {
	setItem(key: string, value: string) {
		if (key.includes(':new:')) throw new Error('storage unavailable');
		super.setItem(key, value);
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

	it('moveToken re-keys a token to the new code and clears the old one', () => {
		setToken('old', 'host', 'h'.repeat(64));
		moveToken('old', 'new', 'host');
		expect(getToken('new', 'host')).toBe('h'.repeat(64));
		expect(getToken('old', 'host')).toBeNull();
		moveToken('none', 'other', 'host');
		expect(getToken('other', 'host')).toBeNull();
	});

	it('moveToken keeps the old key when the write to the new key does not land', () => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: new FailsToWriteNewKeyStorage(),
			configurable: true
		});
		setToken('old', 'host', 'h'.repeat(64));
		moveToken('old', 'new', 'host');
		expect(getToken('old', 'host')).toBe('h'.repeat(64));
		expect(getToken('new', 'host')).toBeNull();
	});

	it('allHostTokens returns every stored host token and nothing else', () => {
		setToken('one', 'host', 'a'.repeat(64));
		setToken('two', 'host', 'b'.repeat(64));
		setToken('two', 'participant', 'c'.repeat(64));
		localStorage.setItem('unrelated', 'x');
		expect(allHostTokens().sort()).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
	});

	it('clearEventTokens removes both roles for one event only', () => {
		setToken('abc', 'host', 'a'.repeat(64));
		setToken('abc', 'participant', 'b'.repeat(64));
		setToken('xyz', 'host', 'c'.repeat(64));
		clearEventTokens('abc');
		expect(getToken('abc', 'host')).toBeNull();
		expect(getToken('abc', 'participant')).toBeNull();
		expect(getToken('xyz', 'host')).toBe('c'.repeat(64));
	});
});
