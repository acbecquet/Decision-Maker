import { MAX_HOST_TOKENS_PER_SIGNIN } from '$lib/shared/constants';

export type TokenRole = 'host' | 'participant';

const key = (code: string, role: TokenRole) => `dm:${code}:${role}`;

/** 256 random bits as 64 lowercase hex characters. */
export function newToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function getToken(code: string, role: TokenRole): string | null {
	try {
		return localStorage.getItem(key(code, role));
	} catch {
		return null;
	}
}

export function setToken(code: string, role: TokenRole, token: string): void {
	try {
		localStorage.setItem(key(code, role), token);
	} catch {
		// Storage can be unavailable in private modes. The request will simply carry no token.
	}
}

/** Returns the stored token for this event and role, creating one if the device has none. */
export function ensureToken(code: string, role: TokenRole): string {
	const existing = getToken(code, role);
	if (existing) return existing;
	const token = newToken();
	setToken(code, role, token);
	return token;
}

/** Re-keys a token when an event's code changes, so the device keeps its role under the new link. */
export function moveToken(from: string, to: string, role: TokenRole): void {
	if (from === to) return;
	const token = getToken(from, role);
	if (!token) return;
	setToken(to, role, token);
	if (getToken(to, role) !== token) return;
	try {
		localStorage.removeItem(key(from, role));
	} catch {
		// Nothing to clean up when storage is unavailable.
	}
}

/**
 * Every host token this device holds, so a sign-in can attach those events to the account,
 * capped at the number the session route accepts.
 */
export function allHostTokens(): string[] {
	const tokens: string[] = [];
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (!k || !k.startsWith('dm:') || !k.endsWith(':host')) continue;
			const value = localStorage.getItem(k);
			if (value) tokens.push(value);
		}
	} catch {
		// Storage unavailable: nothing to claim.
	}
	return tokens.slice(0, MAX_HOST_TOKENS_PER_SIGNIN);
}

/** Forgets both roles for an event, after the host deletes it. */
export function clearEventTokens(code: string): void {
	try {
		localStorage.removeItem(key(code, 'host'));
		localStorage.removeItem(key(code, 'participant'));
	} catch {
		// Nothing stored, nothing to forget.
	}
}

/** True when this browser lets the app keep a token, which the host link depends on. */
export function storageAvailable(): boolean {
	const probe = 'dm:probe';
	try {
		localStorage.setItem(probe, '1');
	} catch {
		return false;
	}
	try {
		localStorage.removeItem(probe);
	} catch {
		// The write worked, which is what matters; a stray probe key is harmless.
	}
	return true;
}
