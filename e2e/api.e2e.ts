import { expect, test } from '@playwright/test';
import { createEventApi, token, viewApi } from './helpers';

test.describe('events API', () => {
	test('creates an event and resolves roles from tokens', async ({ request }) => {
		const hostToken = token();
		const code = await createEventApi(request, hostToken);
		expect(code).toMatch(/^[0-9a-hj-kmnp-tv-z]{10}$/);

		const asHost = await viewApi(request, code, { 'x-host-token': hostToken });
		expect(asHost.status).toBe(200);
		expect(asHost.body.role).toBe('host');
		expect(asHost.body.host).toMatchObject({
			submittedCount: 0,
			pendingCount: 0,
			roster: [],
			tallies: null
		});
		expect(asHost.body.event.options).toHaveLength(4);
		expect(asHost.body.event.options[0]).toEqual({
			id: expect.any(String),
			label: 'Tapas crawl',
			note: 'El Born',
			cost: 25
		});
		expect(Object.keys(asHost.body.event).sort()).toEqual([
			'closedAt',
			'closesAt',
			'code',
			'context',
			'currency',
			'options',
			'rosterFinal',
			'state',
			'title'
		]);
		expect(Object.keys(asHost.body.host).sort()).toEqual([
			'pendingCount',
			'roster',
			'submittedCount',
			'tallies'
		]);
		const serialized = JSON.stringify(asHost.body);
		for (const field of [
			'hostTokenHash',
			'accountId',
			'aggregates',
			'report',
			'expiresAt',
			'createdAt'
		]) {
			expect(serialized).not.toContain(`"${field}"`);
		}

		const asStranger = await viewApi(request, code);
		expect(asStranger.body.role).toBe('participant');
		expect(asStranger.body.host).toBeNull();
		expect(asStranger.body.mine).toBeNull();

		const wrongToken = await viewApi(request, code, { 'x-host-token': token() });
		expect(wrongToken.body.role).toBe('participant');
		expect(wrongToken.body.host).toBeNull();
		expect(wrongToken.body.mine).toBeNull();
	});

	test('rejects a missing host token and bad input', async ({ request }) => {
		const noToken = await request.post('/api/events', {
			data: { title: 'x', currency: 'EUR', options: [{ label: 'a' }, { label: 'b' }] }
		});
		expect(noToken.status()).toBe(400);
		expect((await noToken.json()).message).toMatch(/host token/);

		const oneOption = await request.post('/api/events', {
			headers: { 'x-host-token': token() },
			data: { title: 'x', currency: 'EUR', options: [{ label: 'a' }] }
		});
		expect(oneOption.status()).toBe(400);
		expect((await oneOption.json()).message).toMatch(/at least two/);
	});

	test('unknown codes are 404', async ({ request }) => {
		const res = await request.get('/api/events/0000000000');
		expect(res.status()).toBe(404);
	});

	test('the host can set and clear the auto-close time while open', async ({ request }) => {
		const hostToken = token();
		const code = await createEventApi(request, hostToken);
		const future = new Date(Date.now() + 3_600_000).toISOString();

		const set = await request.patch(`/api/events/${code}`, {
			headers: { 'x-host-token': hostToken },
			data: { closesAt: future }
		});
		expect(set.status()).toBe(200);
		expect((await set.json()).event.closesAt).toBe(future);

		const cleared = await request.patch(`/api/events/${code}`, {
			headers: { 'x-host-token': hostToken },
			data: { closesAt: null }
		});
		expect((await cleared.json()).event.closesAt).toBeNull();

		const past = await request.patch(`/api/events/${code}`, {
			headers: { 'x-host-token': hostToken },
			data: { closesAt: new Date(Date.now() - 1000).toISOString() }
		});
		expect(past.status()).toBe(400);

		const stranger = await request.patch(`/api/events/${code}`, { data: { closesAt: null } });
		expect(stranger.status()).toBe(403);
	});
});
