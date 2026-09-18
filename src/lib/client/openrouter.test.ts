import { beforeEach, describe, expect, it } from 'vitest';
import { getProviderKey } from './keys';
import {
	beginOpenRouterConnect,
	finishOpenRouterConnect,
	pendingConnectEventCode
} from './openrouter';

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

const sha256url = async (s: string) => {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
	return btoa(String.fromCharCode(...new Uint8Array(digest)))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
};

describe('OpenRouter PKCE connect', () => {
	let session: MemoryStorage;
	beforeEach(() => {
		session = new MemoryStorage();
		Object.defineProperty(globalThis, 'localStorage', {
			value: new MemoryStorage(),
			configurable: true
		});
	});

	it('builds the authorization URL with an S256 challenge of a stored verifier', async () => {
		const url = new URL(
			await beginOpenRouterConnect('evt123', 'https://example.test', session as unknown as Storage)
		);
		expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth');
		expect(url.searchParams.get('callback_url')).toBe(
			'https://example.test/auth/openrouter/callback'
		);
		expect(url.searchParams.get('code_challenge_method')).toBe('S256');
		const stored = JSON.parse(session.getItem('dm:openrouter:pkce')!);
		expect(stored.eventCode).toBe('evt123');
		expect(stored.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(url.searchParams.get('code_challenge')).toBe(await sha256url(stored.verifier));
		expect(pendingConnectEventCode(session as unknown as Storage)).toBe('evt123');
	});

	it('exchanges the code with the verifier, stores the key, and clears the attempt', async () => {
		await beginOpenRouterConnect('evt123', 'https://example.test', session as unknown as Storage);
		const verifier = JSON.parse(session.getItem('dm:openrouter:pkce')!).verifier;
		const calls: { url: string; body: unknown }[] = [];
		const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
			return new Response(JSON.stringify({ key: 'sk-or-v1-new' }), { status: 200 });
		}) as typeof fetch;
		const eventCode = await finishOpenRouterConnect(
			'the-code',
			fetchImpl,
			session as unknown as Storage
		);
		expect(eventCode).toBe('evt123');
		expect(calls).toEqual([
			{
				url: 'https://openrouter.ai/api/v1/auth/keys',
				body: { code: 'the-code', code_verifier: verifier, code_challenge_method: 'S256' }
			}
		]);
		expect(getProviderKey('openrouter')).toBe('sk-or-v1-new');
		expect(session.getItem('dm:openrouter:pkce')).toBeNull();
	});

	it('fails plainly when there is no attempt or the exchange is refused', async () => {
		await expect(
			finishOpenRouterConnect('x', fetch, session as unknown as Storage)
		).rejects.toThrow(/No connect attempt/);
		await beginOpenRouterConnect('evt123', 'https://example.test', session as unknown as Storage);
		const refuse = (async () =>
			new Response(JSON.stringify({ error: { message: 'Invalid code' } }), {
				status: 400
			})) as typeof fetch;
		await expect(
			finishOpenRouterConnect('bad', refuse, session as unknown as Storage)
		).rejects.toThrow(/did not return a key/);
		expect(getProviderKey('openrouter')).toBeNull();
	});
});
