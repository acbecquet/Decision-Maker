import { expect, test } from '@playwright/test';
import { createEventApi, optionIds, submitApi, token, viewApi } from './helpers';

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

test.describe('responses API', () => {
	test('device lock: one submission per device, readable and editable only by that device', async ({
		request
	}) => {
		const hostToken = token();
		const code = await createEventApi(request, hostToken);
		const ids = await optionIds(request, code);
		const alex = token();

		const first = await submitApi(request, code, alex, {
			name: 'Alex',
			ranking: [ids[0], ids[1]],
			vetoes: [ids[3]],
			budget: { kind: 'limit', amount: 30 },
			opinion: 'SENTINEL-OPINION tapas is central',
			suggestion: 'Flamenco'
		});
		expect(first.status()).toBe(201);
		expect((await first.json()).participantId).toEqual(expect.any(String));

		const again = await submitApi(request, code, alex, { name: 'Alex', ranking: [ids[0]] });
		expect(again.status()).toBe(409);

		const mine = await viewApi(request, code, { 'x-participant-token': alex });
		expect(mine.body.role).toBe('participant');
		expect(mine.body.mine).toEqual({
			name: 'Alex',
			ranking: [ids[0], ids[1]],
			vetoes: [ids[3]],
			budget: { kind: 'limit', amount: 30 },
			opinion: 'SENTINEL-OPINION tapas is central',
			suggestion: 'Flamenco'
		});

		const other = await viewApi(request, code, { 'x-participant-token': token() });
		expect(other.body.mine).toBeNull();

		const edit = await request.put(`/api/events/${code}/responses`, {
			headers: { 'x-participant-token': alex },
			data: { ranking: [ids[1]], vetoes: [], budget: null, opinion: 'changed', suggestion: '' }
		});
		expect(edit.status()).toBe(200);
		const after = await viewApi(request, code, { 'x-participant-token': alex });
		expect(after.body.mine).toMatchObject({ name: 'Alex', ranking: [ids[1]], opinion: 'changed' });

		const strangerEdit = await request.put(`/api/events/${code}/responses`, {
			headers: { 'x-participant-token': token() },
			data: { ranking: [ids[1]] }
		});
		expect(strangerEdit.status()).toBe(403);
	});

	test('the host receives names and a count, never rankings, budgets, or opinions', async ({
		request
	}) => {
		const hostToken = token();
		const code = await createEventApi(request, hostToken);
		const ids = await optionIds(request, code);
		await submitApi(request, code, token(), {
			name: 'Sam',
			ranking: [ids[2]],
			budget: { kind: 'limit', amount: 20 },
			opinion: 'SENTINEL-OPINION rooftop or nothing'
		});

		const asHost = await viewApi(request, code, { 'x-host-token': hostToken });
		expect(asHost.body.host.submittedCount).toBe(1);
		expect(asHost.body.host.pendingCount).toBe(1);
		expect(asHost.body.host.roster).toEqual([
			{ id: expect.any(String), name: 'Sam', status: 'pending', duplicate: false }
		]);
		expect(asHost.body.host.tallies).toBeNull();
		const serialized = JSON.stringify(asHost.body);
		expect(serialized).not.toContain('SENTINEL-OPINION');
		expect(serialized).not.toContain('"ranking"');
		expect(serialized).not.toContain('"budget"');
	});

	test('the host submitting their own response is auto-approved', async ({ request }) => {
		const hostToken = token();
		const code = await createEventApi(request, hostToken);
		const ids = await optionIds(request, code);
		const res = await submitApi(
			request,
			code,
			token(),
			{ name: 'Host', ranking: [ids[0]] },
			{ 'x-host-token': hostToken }
		);
		expect(res.status()).toBe(201);
		const asHost = await viewApi(request, code, { 'x-host-token': hostToken });
		expect(asHost.body.host.roster[0]).toMatchObject({ name: 'Host', status: 'approved' });
	});

	test('rejects a missing token, unknown options, and repeats', async ({ request }) => {
		const code = await createEventApi(request, token());
		const ids = await optionIds(request, code);

		const noToken = await request.post(`/api/events/${code}/responses`, {
			data: { name: 'A', ranking: [ids[0]] }
		});
		expect(noToken.status()).toBe(400);

		const unknown = await submitApi(request, code, token(), { name: 'A', ranking: ['nope'] });
		expect(unknown.status()).toBe(400);
		expect((await unknown.json()).message).toMatch(/unknown option/);

		const repeat = await submitApi(request, code, token(), {
			name: 'A',
			ranking: [ids[0], ids[0]]
		});
		expect(repeat.status()).toBe(400);
		expect((await repeat.json()).message).toMatch(/repeats/);

		const empty = await submitApi(request, code, token(), { name: 'A', ranking: [] });
		expect(empty.status()).toBe(400);
		expect((await empty.json()).message).toMatch(/at least one/);
	});
});
