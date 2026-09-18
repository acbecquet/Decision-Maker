import type { ProviderId, ThinkingEffort } from '$lib/shared/report';

export type AnalysisPrefs = { provider: ProviderId; model: string; effort: ThinkingEffort };

const keyKey = (provider: ProviderId) => `dm:key:${provider}`;
const prefsKey = (code: string) => `dm:${code}:analysis`;

function read(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function write(key: string, value: string | null): void {
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch {
		// Storage can be unavailable in private modes; the host will be asked again.
	}
}

/** Provider keys live only here, in the host's browser. */
export const getProviderKey = (provider: ProviderId): string | null => read(keyKey(provider));
export const setProviderKey = (provider: ProviderId, key: string): void =>
	write(keyKey(provider), key);
export const clearProviderKey = (provider: ProviderId): void => write(keyKey(provider), null);

export function getAnalysisPrefs(code: string): AnalysisPrefs | null {
	const raw = read(prefsKey(code));
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as Partial<AnalysisPrefs>;
		return parsed.provider && parsed.model && parsed.effort
			? { provider: parsed.provider, model: parsed.model, effort: parsed.effort }
			: null;
	} catch {
		return null;
	}
}

export const setAnalysisPrefs = (code: string, prefs: AnalysisPrefs): void =>
	write(prefsKey(code), JSON.stringify(prefs));
