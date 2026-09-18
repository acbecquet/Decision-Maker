import { getToken } from './tokens';

export class ApiError extends Error {
	constructor(
		public readonly status: number,
		message: string
	) {
		super(message);
		this.name = 'ApiError';
	}
}

export type ApiOptions = {
	method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
	body?: unknown;
	/** When set, the stored host and participant tokens for this event are attached as headers. */
	code?: string;
	headers?: Record<string, string>;
};

/** JSON fetch wrapper. Tokens travel in headers only, never in the URL. */
export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
	const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
	if (opts.body !== undefined) headers['content-type'] = 'application/json';
	if (opts.code) {
		const host = getToken(opts.code, 'host');
		if (host) headers['x-host-token'] = host;
		const participant = getToken(opts.code, 'participant');
		if (participant) headers['x-participant-token'] = participant;
	}
	const res = await fetch(path, {
		method: opts.method ?? 'GET',
		headers,
		body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
	});
	if (!res.ok) {
		let message = res.statusText || 'Request failed';
		try {
			const data = (await res.json()) as { message?: string };
			if (data?.message) message = data.message;
		} catch {
			// Not JSON; keep the status text.
		}
		throw new ApiError(res.status, message);
	}
	if (res.status === 204) return undefined as T;
	return (await res.json()) as T;
}
