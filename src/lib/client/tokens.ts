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
	const token = getToken(from, role);
	if (!token) return;
	setToken(to, role, token);
	try {
		localStorage.removeItem(key(from, role));
	} catch {
		// Nothing to clean up when storage is unavailable.
	}
}
