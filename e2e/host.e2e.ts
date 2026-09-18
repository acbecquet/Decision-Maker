import { expect, test } from '@playwright/test';
import { createEventApi, openAsHost, optionIds, submitApi, token } from './helpers';

test.describe('host', () => {
	test('sees names and a count, approves, closes, and the roster locks', async ({
		browser,
		request
	}) => {
		const hostToken = token();
		const code = await createEventApi(request, hostToken);
		const ids = await optionIds(request, code);
		const { page, context } = await openAsHost(browser, code, hostToken);

		await expect(page.getByText('0 submitted')).toBeVisible();
		await expect(page.getByText('Nobody has submitted yet')).toBeVisible();

		for (const [i, name] of ['Ana', 'Ben', 'Cleo'].entries()) {
			await submitApi(request, code, token(), {
				name,
				ranking: [ids[i % 2]],
				opinion: `SENTINEL-${name}`
			});
		}
		await page.reload();
		await expect(page.getByText('3 submitted')).toBeVisible();
		const roster = page.getByTestId('roster');
		await expect(roster.getByRole('listitem')).toHaveCount(3);
		await expect(roster).toContainText('Ana');
		await expect(page.getByText('First choices')).toHaveCount(0);
		await expect(page.getByTestId(/^first-/)).toHaveCount(0);
		await expect(page.getByText('SENTINEL')).toHaveCount(0);

		await page.getByRole('button', { name: 'Reject Cleo' }).click();
		await expect(roster.getByRole('listitem').filter({ hasText: 'Cleo' })).toContainText(
			'Rejected'
		);
		await page.getByRole('button', { name: 'Approve all pending (2)' }).click();
		await expect(roster.getByRole('listitem').filter({ hasText: 'Ana' })).toContainText('Approved');
		await expect(page.getByRole('button', { name: /Approve all pending/ })).toHaveCount(0);

		await page.getByRole('button', { name: 'Close submissions' }).click();
		await expect(page.getByRole('dialog')).toContainText('Close submissions?');
		await expect(page.getByRole('dialog')).toContainText('Closing is final');
		await page.getByRole('button', { name: 'Close now' }).click();

		await expect(page.getByText('Closed', { exact: true })).toBeVisible();
		await expect(page.getByText('2 approved responses')).toBeVisible();
		await expect(page.getByText('Numbers appear once at least 5 approved responses')).toBeVisible();
		await expect(page.getByRole('button', { name: /Approve|Reject/ })).toHaveCount(0);
		await expect(page.getByRole('button', { name: /reopen/i })).toHaveCount(0);
		await context.close();
	});

	test('with five or more approved the tallies show after close, resolving pending names', async ({
		browser,
		request
	}) => {
		const hostToken = token();
		const code = await createEventApi(request, hostToken);
		const ids = await optionIds(request, code);
		const names = ['Ana', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay'];
		for (const [i, name] of names.entries()) {
			await submitApi(request, code, token(), {
				name,
				ranking: [ids[i % 2], ids[2]],
				budget: { kind: 'limit', amount: i < 3 ? 20 : 50 }
			});
		}
		const { page, context } = await openAsHost(browser, code, hostToken);
		await page.getByRole('button', { name: 'Close submissions' }).click();
		await expect(page.getByRole('dialog')).toContainText('6 names are still pending');
		await page.getByRole('button', { name: 'Approve pending and close' }).click();

		await expect(page.getByText('6 approved responses')).toBeVisible();
		await expect(page.getByTestId(`first-${ids[0]}`)).toHaveText('3');
		await expect(page.getByTestId(`first-${ids[1]}`)).toHaveText('3');
		await expect(page.getByTestId(`first-${ids[2]}`)).toHaveText('0');
		await expect(page.getByTestId(`over-${ids[2]}`)).toHaveText('over budget for 3');
		await expect(page.getByTestId(`over-${ids[0]}`)).toHaveText('over budget for 3');
		await expect(page.getByTestId(`over-${ids[1]}`)).toHaveCount(0);
		await expect(page.getByText('6 of 6 answered the budget question.')).toBeVisible();
		await context.close();
	});

	test('the host can submit their own response and it is approved at once', async ({
		browser,
		request
	}) => {
		const hostToken = token();
		const code = await createEventApi(request, hostToken);
		const { page, context } = await openAsHost(browser, code, hostToken);
		await page.getByRole('button', { name: 'Submit my response' }).click();
		await page.getByLabel('Your name').fill('Charlie');
		await page
			.getByTestId('unranked')
			.getByRole('button', { name: /^Tapas crawl/ })
			.click();
		await page.getByRole('button', { name: 'Submit', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Thanks, Charlie' })).toBeVisible();
		await expect(page.getByText('1 submitted')).toBeVisible();
		await expect(
			page.getByTestId('roster').getByRole('listitem').filter({ hasText: 'Charlie' })
		).toContainText('Approved');
		await context.close();
	});

	test('an auto-closed event asks the host to resolve pending names before showing numbers', async ({
		browser,
		request
	}) => {
		const hostToken = token();
		const code = await createEventApi(request, hostToken);
		const ids = await optionIds(request, code);
		await submitApi(request, code, token(), { name: 'Ana', ranking: [ids[0]] });
		const soon = new Date(Date.now() + 3000).toISOString();
		const set = await request.patch(`/api/events/${code}`, {
			headers: { 'x-host-token': hostToken },
			data: { closesAt: soon }
		});
		expect(set.status()).toBe(200);
		await new Promise((resolve) => setTimeout(resolve, 3200));

		const { page, context } = await openAsHost(browser, code, hostToken);
		await expect(page.getByText('Submissions closed automatically')).toBeVisible();
		await expect(page.getByText('First choices')).toHaveCount(0);
		await page.getByRole('button', { name: 'Finish closing' }).click();
		await expect(page.getByRole('dialog')).toContainText('Finish closing?');
		await page.getByRole('button', { name: 'Reject pending and close' }).click();
		await expect(page.getByText('0 approved responses')).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Numbers' })).toBeVisible();
		await expect(page.getByRole('button', { name: /^(Approve|Reject) / })).toHaveCount(0);
		await expect(page.getByRole('button', { name: /reopen/i })).toHaveCount(0);
		await context.close();
	});

	test('the delete dialog explains a run in progress', async ({ browser, request }) => {
		const hostToken = token();
		const host = { 'x-host-token': hostToken };
		const code = await createEventApi(request, hostToken);
		const ids = await optionIds(request, code);
		for (const name of ['Ana', 'Ben', 'Cleo']) {
			await submitApi(request, code, token(), { name, ranking: [ids[0]], opinion: 'Thoughts.' });
		}
		await request.post(`/api/events/${code}/close`, {
			headers: host,
			data: { pending: 'approve' }
		});
		const started = await request.post(`/api/events/${code}/analysis`, {
			headers: host,
			data: { provider: 'fake', key: 'demo', model: 'fake-stuck' }
		});
		expect(started.status()).toBe(202);
		const { page, context } = await openAsHost(browser, code, hostToken);
		await page.getByRole('button', { name: 'Delete event' }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
		await expect(page.getByRole('dialog').getByRole('alert')).toContainText('still running');
		await context.close();
	});

	test('deleting from the host view lands on the home page and kills the link', async ({
		browser,
		request
	}) => {
		const hostToken = token();
		const code = await createEventApi(request, hostToken);
		const { page, context } = await openAsHost(browser, code, hostToken);
		await page.getByRole('button', { name: 'Delete event' }).click();
		await expect(page.getByRole('dialog')).toContainText('including the report');
		await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
		await expect(page).toHaveURL(/\/$/);
		await page.goto(`/e/${code}`);
		await expect(page.getByText('This event does not exist.')).toBeVisible();
		await context.close();
	});
});
