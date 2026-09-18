import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
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
			'hasDraft',
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

	test('the host can edit the event until the first submission, which rotates the link', async ({
		request
	}) => {
		const hostToken = token();
		const code = await createEventApi(request, hostToken);
		const body = {
			title: 'Sunday brunch',
			context: '',
			currency: 'USD',
			options: [
				{ label: 'Cafe', note: '', cost: 12 },
				{ label: 'Market', note: '', cost: null }
			],
			closesAt: null
		};

		const stranger = await request.put(`/api/events/${code}`, { data: body });
		expect(stranger.status()).toBe(403);

		const edited = await request.put(`/api/events/${code}`, {
			headers: { 'x-host-token': hostToken },
			data: body
		});
		expect(edited.status()).toBe(200);
		const { code: next } = (await edited.json()) as { code: string };
		expect(next).toMatch(/^[0-9a-hj-kmnp-tv-z]{10}$/);
		expect(next).not.toBe(code);
		expect((await request.get(`/api/events/${code}`)).status()).toBe(404);

		const view = await viewApi(request, next, { 'x-host-token': hostToken });
		expect(view.status).toBe(200);
		expect(view.body.role).toBe('host');
		expect(view.body.event.title).toBe('Sunday brunch');
		expect(view.body.event.currency).toBe('USD');
		expect((view.body.event.options as { label: string }[]).map((o) => o.label)).toEqual([
			'Cafe',
			'Market'
		]);

		const ids = await optionIds(request, next);
		const submitted = await submitApi(request, next, token(), { name: 'Ana', ranking: [ids[0]] });
		expect(submitted.status()).toBe(201);
		const locked = await request.put(`/api/events/${next}`, {
			headers: { 'x-host-token': hostToken },
			data: body
		});
		expect(locked.status()).toBe(409);
		expect((await locked.json()).message).toMatch(/already submitted/);
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

test.describe('roster and close API', () => {
	test('approval, close with pending resolution, tallies after close, and no reopen', async ({
		request
	}) => {
		const hostToken = token();
		const host = { 'x-host-token': hostToken };
		const code = await createEventApi(request, hostToken);
		const ids = await optionIds(request, code);
		const people = ['Ana', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay'];
		const tokens = people.map(() => token());
		for (let i = 0; i < people.length; i++) {
			const res = await submitApi(request, code, tokens[i], {
				name: people[i],
				ranking: [ids[i % 2], ids[2]],
				budget: { kind: 'limit', amount: i < 3 ? 20 : 50 }
			});
			expect(res.status()).toBe(201);
		}

		let view = (await viewApi(request, code, host)).body;
		expect(view.host.submittedCount).toBe(6);
		expect(view.host.pendingCount).toBe(6);
		expect(view.host.tallies).toBeNull();

		const fay = view.host.roster.find((r: { name: string }) => r.name === 'Fay');
		const reject = await request.patch(`/api/events/${code}/participants/${fay.id}`, {
			headers: host,
			data: { status: 'rejected' }
		});
		expect(reject.status()).toBe(200);
		const strangerPatch = await request.patch(`/api/events/${code}/participants/${fay.id}`, {
			data: { status: 'approved' }
		});
		expect(strangerPatch.status()).toBe(403);

		const strangerApprove = await request.post(`/api/events/${code}/roster/approve-all`);
		expect(strangerApprove.status()).toBe(403);

		const approveAll = await request.post(`/api/events/${code}/roster/approve-all`, {
			headers: host
		});
		expect(approveAll.status()).toBe(200);
		view = await approveAll.json();
		expect(view.host.pendingCount).toBe(0);
		expect(
			view.host.roster.filter((r: { status: string }) => r.status === 'approved')
		).toHaveLength(5);
		expect(view.host.tallies).toBeNull();

		const strangerClose = await request.post(`/api/events/${code}/close`, {
			data: { pending: 'approve' }
		});
		expect(strangerClose.status()).toBe(403);

		const close = await request.post(`/api/events/${code}/close`, {
			headers: host,
			data: { pending: 'approve' }
		});
		expect(close.status()).toBe(200);
		view = await close.json();
		expect(view.event.state).toBe('closed');
		expect(view.event.rosterFinal).toBe(true);
		expect(view.host.tallies.approvedCount).toBe(5);
		expect(view.host.tallies.breakdown.firstChoice).toEqual([
			{ optionId: ids[0], count: 3 },
			{ optionId: ids[1], count: 2 },
			{ optionId: ids[2], count: 0 },
			{ optionId: ids[3], count: 0 }
		]);
		expect(view.host.tallies.breakdown.cost).toEqual({
			answered: 5,
			rows: [
				{ optionId: ids[0], cost: 25, overBudget: 3 },
				{ optionId: ids[1], cost: 15, overBudget: null },
				{ optionId: ids[2], cost: 45, overBudget: 3 }
			]
		});

		const again = await request.post(`/api/events/${code}/close`, {
			headers: host,
			data: { pending: 'approve' }
		});
		expect(again.status()).toBe(409);

		const late = await submitApi(request, code, token(), { name: 'Late', ranking: [ids[0]] });
		expect(late.status()).toBe(409);

		const flip = await request.patch(`/api/events/${code}/participants/${fay.id}`, {
			headers: host,
			data: { status: 'approved' }
		});
		expect(flip.status()).toBe(409);

		const edit = await request.put(`/api/events/${code}/responses`, {
			headers: { 'x-participant-token': tokens[0] },
			data: { ranking: [ids[1]], vetoes: [], budget: null, opinion: '', suggestion: '' }
		});
		expect(edit.status()).toBe(409);
	});

	test('below five approved responses the breakdown is hidden', async ({ request }) => {
		const hostToken = token();
		const host = { 'x-host-token': hostToken };
		const code = await createEventApi(request, hostToken);
		const ids = await optionIds(request, code);
		for (const name of ['Ana', 'Ben', 'Cleo', 'Dev']) {
			await submitApi(request, code, token(), { name, ranking: [ids[0]] });
		}
		const close = await request.post(`/api/events/${code}/close`, {
			headers: host,
			data: { pending: 'approve' }
		});
		const view = await close.json();
		expect(view.host.tallies).toEqual({ approvedCount: 4, breakdown: null });
	});

	test('a passed auto-close time stops submissions and leaves pending names for the host', async ({
		request
	}) => {
		const hostToken = token();
		const host = { 'x-host-token': hostToken };
		const code = await createEventApi(request, hostToken);
		const ids = await optionIds(request, code);
		await submitApi(request, code, token(), { name: 'Ana', ranking: [ids[0]] });

		const soon = new Date(Date.now() + 3000).toISOString();
		const set = await request.patch(`/api/events/${code}`, {
			headers: host,
			data: { closesAt: soon }
		});
		expect(set.status()).toBe(200);
		await new Promise((resolve) => setTimeout(resolve, 3200));

		const view = (await viewApi(request, code, host)).body;
		expect(view.event.state).toBe('closed');
		expect(view.event.rosterFinal).toBe(false);
		expect(view.host.tallies).toBeNull();
		expect(view.host.pendingCount).toBe(1);

		const late = await submitApi(request, code, token(), { name: 'Late', ranking: [ids[0]] });
		expect(late.status()).toBe(409);

		const close = await request.post(`/api/events/${code}/close`, {
			headers: host,
			data: { pending: 'reject' }
		});
		expect(close.status()).toBe(200);
		const closed = await close.json();
		expect(closed.event.rosterFinal).toBe(true);
		expect(closed.host.pendingCount).toBe(0);
		expect(closed.host.tallies).toEqual({ approvedCount: 0, breakdown: null });
	});
});

test.describe('analysis API', () => {
	test('runs the fake provider after close, gates the report, publishes, and purges', async ({
		request
	}) => {
		const hostToken = token();
		const host = { 'x-host-token': hostToken };
		const code = await createEventApi(request, hostToken);
		const ids = await optionIds(request, code);
		const names = ['Ana', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay'];
		const devices = names.map(() => token());
		for (const [i, name] of names.entries()) {
			const res = await submitApi(request, code, devices[i], {
				name,
				ranking: [ids[i % 4], ids[(i + 1) % 4]],
				opinion: `SENTINEL-${name} has thoughts`
			});
			expect(res.status()).toBe(201);
		}
		const run = { provider: 'fake', key: 'demo', model: 'fake-fast' };

		const providers = await request.get('/api/providers');
		expect((await providers.json()).providers.map((p: { id: string }) => p.id)).toEqual([
			'anthropic',
			'openai',
			'openrouter',
			'fake'
		]);

		expect(
			(await request.post(`/api/events/${code}/analysis`, { headers: host, data: run })).status()
		).toBe(409);
		expect(
			(
				await request.post(`/api/events/${code}/models`, {
					data: { provider: 'fake', key: 'demo' }
				})
			).status()
		).toBe(403);
		const models = await request.post(`/api/events/${code}/models`, {
			headers: host,
			data: { provider: 'fake', key: 'demo' }
		});
		expect(models.status()).toBe(200);
		expect((await models.json()).models[0]).toEqual({
			id: 'fake-fast',
			label: 'Fake (deterministic)'
		});

		const roster = (await viewApi(request, code, host)).body.host.roster as {
			id: string;
			name: string;
		}[];
		const fay = roster.find((r) => r.name === 'Fay')!;
		await request.patch(`/api/events/${code}/participants/${fay.id}`, {
			headers: host,
			data: { status: 'rejected' }
		});
		const closed = await request.post(`/api/events/${code}/close`, {
			headers: host,
			data: { pending: 'approve' }
		});
		expect(closed.status()).toBe(200);
		expect((await closed.json()).host.hasDraft).toBe(false);

		const started = await request.post(`/api/events/${code}/analysis`, {
			headers: host,
			data: run
		});
		expect(started.status()).toBe(202);
		let status = {
			status: 'running',
			done: 0,
			total: 0,
			hasDraft: false,
			error: null as string | null
		};
		for (let i = 0; i < 40 && status.status === 'running'; i++) {
			await new Promise((r) => setTimeout(r, 250));
			status = await (await request.get(`/api/events/${code}/analysis`, { headers: host })).json();
		}
		expect(status).toMatchObject({ status: 'succeeded', hasDraft: true, error: null });
		expect(status.done).toBe(status.total);
		expect(status.total).toBe(6);

		const draft = await request.get(`/api/events/${code}/report`, { headers: host });
		expect(draft.status()).toBe(200);
		const draftBody = await draft.json();
		expect(Object.keys(draftBody).sort()).toEqual([
			'context',
			'currency',
			'options',
			'publishedAt',
			'report',
			'state',
			'tallies',
			'title'
		]);
		expect(draftBody.state).toBe('closed');
		expect(ids).toContain(draftBody.report.best.optionId);
		expect(draftBody.report.themes.length).toBeGreaterThanOrEqual(3);
		expect(JSON.stringify(draftBody)).not.toContain('SENTINEL');
		expect(
			(
				await request.get(`/api/events/${code}/report`, {
					headers: { 'x-participant-token': devices[0] }
				})
			).status()
		).toBe(404);

		expect((await request.post(`/api/events/${code}/publish`)).status()).toBe(403);
		const published = await request.post(`/api/events/${code}/publish`, { headers: host });
		expect(published.status()).toBe(200);
		expect((await published.json()).event.state).toBe('published');

		const approved = await request.get(`/api/events/${code}/report`, {
			headers: { 'x-participant-token': devices[0] }
		});
		expect(approved.status()).toBe(200);
		expect((await approved.json()).report.best.optionId).toBe(draftBody.report.best.optionId);
		expect(
			(
				await request.get(`/api/events/${code}/report`, {
					headers: { 'x-participant-token': devices[5] }
				})
			).status()
		).toBe(404);
		expect((await request.get(`/api/events/${code}/report`)).status()).toBe(404);
		expect(
			(await request.post(`/api/events/${code}/analysis`, { headers: host, data: run })).status()
		).toBe(409);
		expect((await request.post(`/api/events/${code}/publish`, { headers: host })).status()).toBe(
			409
		);

		const dbFile = new Database('e2e/.tmp/e2e.db', { fileMustExist: true });
		try {
			const count = (sql: string) => (dbFile.prepare(sql).get(code) as { n: number }).n;
			expect(
				count(
					'SELECT count(*) AS n FROM responses r JOIN participants p ON p.id = r.participant_id JOIN events e ON e.id = p.event_id WHERE e.code = ?'
				)
			).toBe(0);
			expect(
				count(
					'SELECT count(*) AS n FROM anonymized_points a JOIN events e ON e.id = a.event_id WHERE e.code = ?'
				)
			).toBe(0);
			expect(
				count(
					'SELECT count(*) AS n FROM participants p JOIN events e ON e.id = p.event_id WHERE e.code = ?'
				)
			).toBe(6);
		} finally {
			dbFile.close();
		}
	});
});
