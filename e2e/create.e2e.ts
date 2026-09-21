import { expect, test } from '@playwright/test';
import { newDevice, submitViaUi } from './helpers';

test.describe('creating an event', () => {
	test('validates, creates, shows the link, and lands on the host view', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'DecisionMaker' })).toBeVisible();

		await page.getByRole('button', { name: 'Create event' }).click();
		await expect(page.getByRole('alert')).toHaveText('Enter a title');

		await page.getByLabel('What are you deciding?').fill('Saturday night in Barcelona');
		await page.getByLabel('Context').fill('Dinner plans for the group');
		await page.getByLabel('Currency').selectOption('EUR');
		await page.getByLabel('Option 1').fill('Tapas crawl');
		await page.getByLabel('Cost per person').nth(0).fill('25');
		await page.getByLabel('Option 2').fill('Beach BBQ');
		await page.getByRole('button', { name: 'Add option' }).click();
		await page.getByLabel('Option 3').fill('Rooftop bar');
		await page.getByLabel('Cost per person').nth(2).fill('45');
		await page.getByRole('button', { name: 'Create event' }).click();

		await expect(page).toHaveURL(/\/e\/[0-9a-hj-kmnp-tv-z]{10}\?created=1$/);
		const code = new URL(page.url()).pathname.split('/').pop() as string;
		await expect(page.getByRole('heading', { name: 'Your event is ready' })).toBeVisible();
		await expect(page.getByLabel('Share this link')).toHaveValue(
			new RegExp(`/e/${code}/saturday-night-in-barcelona$`)
		);
		await expect(page.getByTestId('qr').locator('svg')).toBeVisible();

		await page.getByRole('button', { name: 'Continue to host view' }).click();
		await expect(page).toHaveURL(new RegExp(`/e/${code}$`));
		await expect(page.getByRole('heading', { name: 'Saturday night in Barcelona' })).toBeVisible();
		await expect(page.getByText('Open', { exact: true })).toBeVisible();
		await expect(page.getByText('0 submitted')).toBeVisible();
	});

	test('a device without the host token sees the participant side', async ({ page, browser }) => {
		await page.goto('/');
		await page.getByLabel('What are you deciding?').fill('Lunch');
		await page.getByLabel('Option 1').fill('A');
		await page.getByLabel('Option 2').fill('B');
		await page.getByRole('button', { name: 'Create event' }).click();
		await expect(page).toHaveURL(/\?created=1$/);
		const code = new URL(page.url()).pathname.split('/').pop() as string;

		const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
		const otherPage = await other.newPage();
		await otherPage.goto(`/e/${code}`);
		await expect(otherPage.getByRole('heading', { name: 'Lunch' })).toBeVisible();
		await expect(otherPage.getByText('0 submitted')).toHaveCount(0);
		await expect(otherPage.getByRole('button', { name: 'Close submissions' })).toHaveCount(0);
		await other.close();
	});

	test('editing from the link screen replaces the options and rotates the link', async ({
		page,
		browser
	}) => {
		await page.goto('/');
		await page.getByLabel('What are you deciding?').fill('Lunch');
		await page.getByLabel('Option 1').fill('A');
		await page.getByLabel('Note').nth(0).fill('Outdoor');
		await page.getByLabel('Cost per person').nth(0).fill('12');
		await page.getByLabel('Option 2').fill('B');
		await page.getByRole('button', { name: 'Create event' }).click();
		await expect(page).toHaveURL(/\?created=1$/);
		const first = new URL(page.url()).pathname.split('/').pop() as string;

		await page.getByRole('button', { name: 'Edit event' }).click();
		await expect(page).toHaveURL(new RegExp(`/e/${first}/edit`));
		await expect(page.getByLabel('Note').nth(0)).toHaveValue('Outdoor');
		await expect(page.getByLabel('Cost per person').nth(0)).toHaveValue('12');
		await page.getByRole('button', { name: 'Cancel' }).click();
		await expect(page).toHaveURL(/\?created=1$/);
		await expect(page.getByRole('heading', { name: 'Your event is ready' })).toBeVisible();

		await page.getByRole('button', { name: 'Edit event' }).click();
		await expect(page).toHaveURL(new RegExp(`/e/${first}/edit`));
		await expect(page.getByLabel('What are you deciding?')).toHaveValue('Lunch');
		await expect(page.getByLabel('Option 2')).toHaveValue('B');
		await page.getByLabel('What are you deciding?').fill('Late lunch');
		await page.getByLabel('Option 2').fill('Beach');
		await page.getByRole('button', { name: 'Add option' }).click();
		await page.getByLabel('Option 3').fill('Cafe');
		await page.getByRole('button', { name: 'Save' }).click();

		await expect(page).toHaveURL(/\?created=1$/);
		const second = new URL(page.url()).pathname.split('/').pop() as string;
		expect(second).not.toBe(first);
		await expect(page.getByRole('heading', { name: 'Your event is ready' })).toBeVisible();
		await expect(page.getByLabel('Share this link')).toHaveValue(
			new RegExp(`/e/${second}/late-lunch$`)
		);
		await page.getByRole('button', { name: 'Continue to host view' }).click();
		await expect(page.getByRole('heading', { name: 'Late lunch' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Edit event' })).toBeVisible();

		await page.getByRole('button', { name: 'Edit event' }).click();
		await expect(page).toHaveURL(new RegExp(`/e/${second}/edit`));
		await expect(page.getByLabel('Cost per person').nth(0)).toHaveValue('12');
		await expect(page.getByLabel('Option 3')).toHaveValue('Cafe');
		await page.getByRole('button', { name: 'Cancel' }).click();
		await expect(page).toHaveURL(new RegExp(`/e/${second}$`));
		await expect(page.getByRole('heading', { name: 'Late lunch' })).toBeVisible();

		const old = await newDevice(browser);
		await old.page.goto(`/e/${first}`);
		await expect(old.page.getByText('This event does not exist.')).toBeVisible();
		await old.context.close();

		await submitViaUi(browser, second, { name: 'Ana', rank: ['Cafe'] });
		await page.reload();
		await expect(page.getByText('1 submitted')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Edit event' })).toHaveCount(0);

		await page.goto(`/e/${second}/edit`);
		await expect(page).toHaveURL(new RegExp(`/e/${second}$`));
	});
});
