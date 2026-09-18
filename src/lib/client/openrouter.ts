import { setProviderKey } from './keys';

const PKCE_KEY = 'dm:openrouter:pkce';
const AUTH_URL = 'https://openrouter.ai/auth';
const EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys';
export const OPENROUTER_CALLBACK_PATH = '/auth/openrouter/callback';

const base64url = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');

type Attempt = { verifier: string; eventCode: string };

function readAttempt(storage: Storage): Attempt | null {
	try {
		const raw = storage.getItem(PKCE_KEY);
		return raw ? (JSON.parse(raw) as Attempt) : null;
	} catch {
		return null;
	}
}

/** Stores a PKCE verifier for the event and returns the OpenRouter authorization URL to navigate to. */
export async function beginOpenRouterConnect(
	eventCode: string,
	origin: string,
	storage: Storage = sessionStorage
): Promise<string> {
	const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	storage.setItem(PKCE_KEY, JSON.stringify({ verifier, eventCode } satisfies Attempt));
	const url = new URL(AUTH_URL);
	url.searchParams.set('callback_url', origin + OPENROUTER_CALLBACK_PATH);
	url.searchParams.set('code_challenge', base64url(new Uint8Array(digest)));
	url.searchParams.set('code_challenge_method', 'S256');
	return url.href;
}

export const pendingConnectEventCode = (storage: Storage = sessionStorage): string | null =>
	readAttempt(storage)?.eventCode ?? null;

/**
 * Exchanges the callback code for a key, straight from the browser (OpenRouter allows the cross-origin
 * call), stores the key for the openrouter provider, and returns the event code to go back to.
 */
export async function finishOpenRouterConnect(
	code: string,
	fetchImpl: typeof fetch = fetch,
	storage: Storage = sessionStorage
): Promise<string> {
	const attempt = readAttempt(storage);
	if (!attempt) throw new Error('No connect attempt in progress');
	const res = await fetchImpl(EXCHANGE_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ code, code_verifier: attempt.verifier, code_challenge_method: 'S256' })
	});
	const body = res.ok ? ((await res.json()) as { key?: unknown }) : null;
	if (!body || typeof body.key !== 'string' || body.key === '') {
		throw new Error('OpenRouter did not return a key');
	}
	setProviderKey('openrouter', body.key);
	storage.removeItem(PKCE_KEY);
	return attempt.eventCode;
}
