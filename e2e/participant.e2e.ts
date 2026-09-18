import { expect, test } from '@playwright/test';
import { createEventApi, newDevice, token } from './helpers';

test.describe('participant', () => {
	test('ranks by tapping, sets a budget, submits, and is locked to the device', async ({
		browser,
		request
	}) => {
		const code = await createEventApi(request, token());
		const { page, context } = await newDevice(browser);
		await page.goto(`/e/${code}`);

		await expect(page.getByRole('heading', { name: 'Saturday night' })).toBeVisible();
		await expect(page.getByText('Only the host sees your name')).toBeVisible();

		await page.getByRole('button', { name: 'Submit', exact: true }).click();
		await expect(page.getByRole('alert')).toHaveText('Enter your name');
		await page.getByLabel('Your name').fill('Alex');
		await page.getByRole('button', { name: 'Submit', exact: true }).click();
		await expect(page.getByRole('alert')).toHaveText('Rank at least one option');

		const unranked = page.getByTestId('unranked');
		await unranked.getByRole('button', { name: /^Rooftop bar/ }).click();
		await unranked.getByRole('button', { name: /^Tapas crawl/ }).click();
		await expect(page.getByTestId('ranked')).toContainText(/1\s*Rooftop bar/);
		await expect(page.getByTestId('ranked')).toContainText(/2\s*Tapas crawl/);
		await page.getByRole('button', { name: 'Move Tapas crawl up' }).click();
		await expect(page.getByTestId('ranked')).toContainText(/1\s*Tapas crawl/);
		await page.getByRole('button', { name: "Won't work for Paella class" }).click();
		await page.getByRole('button', { name: 'Up to €25' }).click();
		await page.getByLabel('Your opinion').fill('Tapas is central so everyone can get there');
		await page.getByLabel('Something not listed?').fill('Flamenco');
		await page.getByRole('button', { name: 'Submit', exact: true }).click();

		await expect(page.getByRole('heading', { name: 'Thanks, Alex' })).toBeVisible();
		await expect(page.getByText('Tapas crawl')).toBeVisible();
		await expect(page.getByText("Won't work: Paella class")).toBeVisible();
		await expect(page.getByText('Budget: up to €25')).toBeVisible();
		await expect(page.getByText('Suggested: Flamenco')).toBeVisible();

		await page.reload();
		await expect(page.getByRole('heading', { name: 'Thanks, Alex' })).toBeVisible();

		await page.getByRole('button', { name: 'Edit my answers' }).click();
		await expect(page.getByLabel('Your name')).toHaveCount(0);
		await page.getByLabel('Your opinion').fill('Changed my mind, beach if sunny');
		await page.getByRole('button', { name: 'Save changes' }).click();
		await expect(page.getByText('Changed my mind, beach if sunny')).toBeVisible();

		const other = await newDevice(browser);
		await other.page.goto(`/e/${code}`);
		await expect(other.page.getByLabel('Your name')).toBeVisible();
		await expect(other.page.getByText('Thanks, Alex')).toHaveCount(0);
		await other.context.close();
		await context.close();
	});

	test('closed and published states read correctly', async ({ browser, request }) => {
		const hostToken = token();
		const code = await createEventApi(request, hostToken);
		const { page, context } = await newDevice(browser);
		await page.goto(`/e/${code}`);
		await page.getByLabel('Your name').fill('Sam');
		await page
			.getByTestId('unranked')
			.getByRole('button', { name: /^Beach BBQ/ })
			.click();
		await page.getByRole('button', { name: 'Submit', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Thanks, Sam' })).toBeVisible();

		const close = await request.post(`/api/events/${code}/close`, {
			headers: { 'x-host-token': hostToken },
			data: { pending: 'approve' }
		});
		expect(close.status()).toBe(200);

		await page.reload();
		await expect(page.getByRole('heading', { name: 'Submissions are closed' })).toBeVisible();
		await expect(page.getByText('Results are on the way.')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Edit my answers' })).toHaveCount(0);

		const other = await newDevice(browser);
		await other.page.goto(`/e/${code}`);
		await expect(other.page.getByRole('heading', { name: 'Submissions are closed' })).toBeVisible();
		await expect(other.page.getByText('Results are on the way.')).toHaveCount(0);
		await other.context.close();
		await context.close();
	});
});
