import { expect, test } from '@playwright/test';
import {
	createEventApi,
	newDevice,
	openAsHost,
	openAsParticipant,
	optionIds,
	submitApi,
	token
} from './helpers';

test.describe('single choice', () => {
	test('a host creates a yes or no event, people pick one, and the tallies show votes', async ({
		browser,
		request
	}) => {
		const host = await newDevice(browser);
		await host.page.goto('/');
		await host.page.getByLabel('What are you deciding?').fill('Is the south overrated?');
		await host.page.getByLabel('Pick one option').check();
		await host.page.getByLabel('Option 1').fill('Yes');
		await host.page.getByLabel('Option 2').fill('No');
		await host.page.getByRole('button', { name: 'Create event' }).click();
		await expect(host.page.getByRole('heading', { name: 'Your event is ready' })).toBeVisible();
		const code = new URL(host.page.url()).pathname.split('/').pop() as string;

		const phone = await newDevice(browser);
		await phone.page.goto(`/e/${code}`);
		await expect(phone.page.getByText('Pick one option')).toBeVisible();
		await expect(phone.page.getByRole('button', { name: /Won't work/ })).toHaveCount(0);
		await expect(phone.page.getByTestId('ranked')).toHaveCount(0);
		await phone.page.getByLabel('Your name').fill('Ana');
		await phone.page.getByRole('button', { name: 'Submit' }).click();
		await expect(phone.page.getByRole('alert')).toHaveText('Pick one option');
		await phone.page.getByRole('radio', { name: 'Yes' }).check();
		await phone.page.getByRole('button', { name: 'Submit' }).click();
		await expect(phone.page.getByRole('heading', { name: 'Thanks, Ana' })).toBeVisible();
		await expect(phone.page.getByText('Your pick', { exact: true })).toBeVisible();
		await expect(phone.page.getByText('Yes', { exact: true })).toBeVisible();
		await phone.context.close();

		const [yes, no] = await optionIds(request, code);
		const ranked = await submitApi(request, code, token(), { name: 'Ben', ranking: [yes, no] });
		expect(ranked.status()).toBe(400);
		const vetoed = await submitApi(request, code, token(), {
			name: 'Ben',
			ranking: [yes],
			vetoes: [no]
		});
		expect(vetoed.status()).toBe(400);
		const picks = [
			['Ben', yes],
			['Cleo', yes],
			['Dev', no],
			['Eve', yes]
		] as const;
		for (const [name, pick] of picks) {
			const res = await submitApi(request, code, token(), {
				name,
				ranking: [pick],
				opinion: 'Sure.'
			});
			expect(res.status()).toBe(201);
		}

		await host.page.getByRole('button', { name: 'Continue to host view' }).click();
		// The host view loads once on mount, so submissions that landed since need a reload.
		await host.page.reload();
		await host.page.getByRole('button', { name: 'Approve all pending (5)' }).click();
		await host.page.getByRole('button', { name: 'Close submissions' }).click();
		await expect(host.page.getByRole('dialog')).toContainText('Close submissions?');
		await host.page.getByRole('button', { name: 'Close now' }).click();
		await expect(host.page.getByRole('heading', { name: 'Votes' })).toBeVisible();
		await expect(host.page.getByTestId(`first-${yes}`)).toHaveText('4');
		await expect(host.page.getByTestId(`first-${no}`)).toHaveText('1');
		await expect(host.page.getByRole('heading', { name: 'Where each option ranked' })).toHaveCount(
			0
		);
		await expect(host.page.getByRole('heading', { name: "Won't work for" })).toHaveCount(0);

		await host.page.getByRole('tab', { name: 'Fake (demo)' }).click();
		await expect(host.page.getByLabel('Model')).toHaveValue('fake-fast');
		await host.page.getByRole('button', { name: 'Run analysis' }).click();
		const report = host.page.getByTestId('report');
		await expect(report).toBeVisible({ timeout: 20_000 });
		const winner = report.locator('.card.highlight');
		await expect(winner).toContainText('Winner');
		await expect(winner).toContainText('Yes');
		await expect(report).not.toContainText('Best option');
		await expect(report.getByRole('heading', { name: 'Numbers' })).toHaveCount(1);
		await expect(report.getByRole('heading', { name: 'Votes' })).toBeVisible();
		await expect(report.getByRole('heading', { name: 'Where each option ranked' })).toHaveCount(0);

		await host.page.getByRole('button', { name: 'Publish' }).click();
		await expect(host.page.getByRole('dialog')).toContainText('Publish results?');
		await expect(host.page.getByRole('dialog')).toContainText('Raw picks and opinions are deleted');
		await host.page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
		await expect(host.page.getByText('Published', { exact: true })).toBeVisible();

		await host.context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await host.page.getByRole('button', { name: 'Copy summary' }).click();
		await expect(host.page.getByRole('button', { name: 'Copied' })).toBeVisible();
		const summary = await host.page.evaluate(() => navigator.clipboard.readText());
		expect(summary).toContain('Winner: Yes');
		expect(summary).not.toContain('Best:');

		const guest = await openAsParticipant(browser, code, token());
		await expect(guest.page.getByTestId('report')).toBeVisible();
		await expect(guest.page.getByTestId('report')).toContainText('Winner');
		await expect(guest.page.getByRole('button', { name: 'Copy summary' })).toHaveCount(0);
		await guest.context.close();
		await host.context.close();
	});
});

test.describe('opinions only', () => {
	test('a host creates an event with no options, people write, and the host sees only the count', async ({
		browser,
		request
	}) => {
		const host = await newDevice(browser);
		await host.page.goto('/');
		await host.page.getByLabel('What are you deciding?').fill('How should we split the bill?');
		await host.page.getByLabel('Opinions only').check();
		await expect(host.page.getByLabel('Option 1')).toHaveCount(0);
		await expect(host.page.getByLabel('Currency')).toHaveCount(0);
		await host.page.getByRole('button', { name: 'Create event' }).click();
		await expect(host.page.getByRole('heading', { name: 'Your event is ready' })).toBeVisible();
		const code = new URL(host.page.url()).pathname.split('/').pop() as string;

		const phone = await newDevice(browser);
		await phone.page.goto(`/e/${code}`);
		await expect(phone.page.getByTestId('ranked')).toHaveCount(0);
		await expect(phone.page.getByLabel('Something not listed?')).toHaveCount(0);
		await phone.page.getByLabel('Your name').fill('Ana');
		await phone.page.getByRole('button', { name: 'Submit' }).click();
		await expect(phone.page.getByRole('alert')).toHaveText('Write your opinion');
		await phone.page.getByLabel('Your opinion').fill('Split it evenly, it is simpler.');
		await phone.page.getByRole('button', { name: 'Submit' }).click();
		await expect(phone.page.getByRole('heading', { name: 'Thanks, Ana' })).toBeVisible();
		await expect(phone.page.getByText('Your opinion', { exact: true })).toBeVisible();
		await expect(phone.page.getByText('Your ranking')).toHaveCount(0);
		await phone.context.close();

		const ranked = await submitApi(request, code, token(), {
			name: 'Ben',
			ranking: ['x'],
			opinion: 'No.'
		});
		expect(ranked.status()).toBe(400);
		for (const name of ['Ben', 'Cleo', 'Dev', 'Eve']) {
			const res = await submitApi(request, code, token(), {
				name,
				ranking: [],
				opinion: `${name} thinks per item.`
			});
			expect(res.status()).toBe(201);
		}

		await host.page.getByRole('button', { name: 'Continue to host view' }).click();
		// The host view loads once on mount, so submissions that landed since need a reload.
		await host.page.reload();
		await host.page.getByRole('button', { name: 'Approve all pending (5)' }).click();
		await host.page.getByRole('button', { name: 'Close submissions' }).click();
		await expect(host.page.getByRole('dialog')).toContainText('Close submissions?');
		await host.page.getByRole('button', { name: 'Close now' }).click();
		await expect(host.page.getByText('5 approved responses')).toBeVisible();
		await expect(host.page.getByRole('heading', { name: 'First choices' })).toHaveCount(0);
		await expect(host.page.getByRole('heading', { name: 'Votes' })).toHaveCount(0);
		await expect(host.page.getByText(/Numbers appear once/)).toHaveCount(0);

		await host.page.getByRole('tab', { name: 'Fake (demo)' }).click();
		await expect(host.page.getByLabel('Model')).toHaveValue('fake-fast');
		await host.page.getByRole('button', { name: 'Run analysis' }).click();
		const report = host.page.getByTestId('report');
		await expect(report).toBeVisible({ timeout: 20_000 });
		await expect(report).not.toContainText('Winner');
		await expect(report).not.toContainText('Best option');
		await expect(host.page.getByRole('heading', { name: 'Numbers' })).toHaveCount(0);
		await expect(report).toContainText('What people said');
		await expect(report.locator('blockquote').first()).toBeVisible();

		await host.page.getByRole('button', { name: 'Publish' }).click();
		await expect(host.page.getByRole('dialog')).toContainText('Publish results?');
		await expect(host.page.getByRole('dialog')).toContainText('Raw opinions are deleted');
		await host.page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
		await expect(host.page.getByText('Published', { exact: true })).toBeVisible();

		await host.context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await host.page.getByRole('button', { name: 'Copy summary' }).click();
		await expect(host.page.getByRole('button', { name: 'Copied' })).toBeVisible();
		const summary = await host.page.evaluate(() => navigator.clipboard.readText());
		expect(summary).not.toContain('Best:');
		expect(summary).not.toContain('Winner:');
		expect(summary).toContain('5 responses.');

		const guest = await openAsParticipant(browser, code, token());
		await expect(guest.page.getByTestId('report')).toBeVisible();
		await expect(guest.page.getByTestId('report')).toContainText('What people said');
		await guest.context.close();
		await host.context.close();
	});
});

test('a single-choice event with fewer than five answers still names the winner by votes', async ({
	browser,
	request
}) => {
	const hostToken = token();
	const code = await createEventApi(request, hostToken, {
		title: 'Pool or beach?',
		mode: 'single',
		options: [
			{ label: 'Pool', note: '', cost: null },
			{ label: 'Beach', note: '', cost: null }
		]
	});
	const [pool, beach] = await optionIds(request, code);
	for (const [name, pick] of [
		['Ana', beach],
		['Ben', beach],
		['Cleo', pool]
	] as const) {
		const res = await submitApi(request, code, token(), {
			name,
			ranking: [pick],
			opinion: 'Fine.'
		});
		expect(res.status()).toBe(201);
	}
	const host = { 'x-host-token': hostToken };
	await request.post(`/api/events/${code}/roster/approve-all`, { headers: host });
	await request.post(`/api/events/${code}/close`, { headers: host, data: { pending: 'approve' } });
	const started = await request.post(`/api/events/${code}/analysis`, {
		headers: host,
		data: { provider: 'fake', key: 'demo', model: 'fake-fast' }
	});
	expect(started.status()).toBe(202);
	await expect
		.poll(
			async () =>
				(await (await request.get(`/api/events/${code}/analysis`, { headers: host })).json())
					.status,
			{ timeout: 20_000 }
		)
		.toBe('succeeded');

	const { page, context } = await openAsHost(browser, code, hostToken);
	const report = page.getByTestId('report');
	await expect(report).toBeVisible();
	await expect(report).toContainText('Winner');
	await expect(report.getByText('Beach', { exact: true }).first()).toBeVisible();
	await expect(report).toContainText('Numbers appear once at least 5 approved responses are in.');
	await context.close();
});
