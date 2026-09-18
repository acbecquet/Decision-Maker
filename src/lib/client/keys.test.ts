import { beforeEach, describe, expect, it } from 'vitest';
import {
	clearProviderKey,
	getAnalysisPrefs,
	getProviderKey,
	setAnalysisPrefs,
	setProviderKey
} from './keys';

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
}

describe('provider keys and analysis preferences', () => {
	beforeEach(() => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: new MemoryStorage(),
			configurable: true
		});
	});

	it('stores one key per provider and clears it', () => {
		expect(getProviderKey('openrouter')).toBeNull();
		setProviderKey('openrouter', 'sk-or-1');
		setProviderKey('anthropic', 'sk-ant-1');
		expect(getProviderKey('openrouter')).toBe('sk-or-1');
		expect(getProviderKey('anthropic')).toBe('sk-ant-1');
		clearProviderKey('openrouter');
		expect(getProviderKey('openrouter')).toBeNull();
		expect(getProviderKey('anthropic')).toBe('sk-ant-1');
	});

	it('stores preferences per event and ignores garbage', () => {
		expect(getAnalysisPrefs('abc')).toBeNull();
		setAnalysisPrefs('abc', {
			provider: 'openrouter',
			model: '~deepseek/deepseek-pro-latest',
			effort: 'max'
		});
		expect(getAnalysisPrefs('abc')).toEqual({
			provider: 'openrouter',
			model: '~deepseek/deepseek-pro-latest',
			effort: 'max'
		});
		localStorage.setItem('dm:abc:analysis', '{not json');
		expect(getAnalysisPrefs('abc')).toBeNull();
	});
});
