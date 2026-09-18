import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

const respond = (status: number, body: string | null, type = 'application/json') =>
	vi.fn(async () => new Response(body, { status, headers: type ? { 'content-type': type } : {} }));

describe('api', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('returns parsed JSON and undefined for 204', async () => {
		vi.stubGlobal('fetch', respond(200, '{"ok":true}'));
		expect(await api('/x')).toEqual({ ok: true });
		vi.stubGlobal('fetch', respond(204, null, ''));
		expect(await api('/x', { method: 'DELETE' })).toBeUndefined();
	});

	it('uses the server message, then the status text, for failures', async () => {
		vi.stubGlobal('fetch', respond(409, '{"message":"Closing is final"}'));
		await expect(api('/x')).rejects.toMatchObject({ status: 409, message: 'Closing is final' });
		vi.stubGlobal('fetch', respond(502, '<html>bad gateway</html>', 'text/html'));
		const err = (await api('/x').catch((e) => e)) as ApiError;
		expect(err).toBeInstanceOf(ApiError);
		expect(err.status).toBe(502);
	});

	it('turns a success without JSON into a plain error rather than a syntax error', async () => {
		vi.stubGlobal('fetch', respond(200, '<html>proxy page</html>', 'text/html'));
		await expect(api('/x')).rejects.toMatchObject({
			status: 200,
			message: 'The server sent an unexpected response. Try again.'
		});
	});

	it('turns a transport failure into a status 0 error with a plain message', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('Failed to fetch');
			})
		);
		await expect(api('/x')).rejects.toMatchObject({
			status: 0,
			message: 'Could not reach the server. Check your connection and try again.'
		});
	});
});
