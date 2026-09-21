import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createEventApi, newDevice, optionIds, submitApi, token } from './helpers';

async function signIn(page: Page, request: APIRequestContext, email: string) {
	await page.goto('/signin');
	await page.getByLabel('Email').fill(email);
	await page.getByRole('button', { name: 'Send link' }).click();
	await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
	const mail = await request.get(`/api/test/mail?to=${encodeURIComponent(email)}`);
	expect(mail.status()).toBe(200);
	const link = new URL((await mail.json()).url);
	await page.goto(link.pathname + link.search);
	await page.getByRole('button', { name: 'Finish signing in' }).click();
	await expect(page).toHaveURL(/\/$/);
}

test('a signed-in host decides on names across events from the home screen', async ({
	browser,
	request
}) => {
	const hostToken = token();
	const dinner = await createEventApi(request, hostToken, { title: 'Axis dinner' });
	const brunch = await createEventApi(request, hostToken, { title: 'Sunday brunch' });
	const dinnerIds = await optionIds(request, dinner);
	const brunchIds = await optionIds(request, brunch);
	for (const name of ['Ana', 'Ben']) {
		await submitApi(request, dinner, token(), { name, ranking: [dinnerIds[0]], opinion: 'Fine.' });
	}
	for (const name of ['Cleo', 'Dev', 'Eve']) {
		await submitApi(request, brunch, token(), { name, ranking: [brunchIds[0]], opinion: 'Fine.' });
	}

	const phone = await newDevice(browser);
	await phone.context.addInitScript(
		([a, b, t]) => {
			localStorage.setItem(a, t);
			localStorage.setItem(b, t);
		},
		[`dm:${dinner}:host`, `dm:${brunch}:host`, hostToken]
	);
	await phone.page.clock.install();
	await signIn(phone.page, request, `home-${dinner}@example.test`);

	const cards = phone.page.getByTestId('my-events').locator(':scope > li');
	await expect(cards).toHaveCount(2);
	await expect(cards.first()).toContainText('Sunday brunch');
	await expect(phone.page.getByTestId('pending-total')).toHaveText('5 pending');
	const dinnerCard = phone.page.getByTestId(`event-${dinner}`);
	const brunchCard = phone.page.getByTestId(`event-${brunch}`);
	await expect(dinnerCard).toContainText('2 pending');
	await expect(brunchCard).toContainText('3 pending');

	await dinnerCard.getByRole('button', { name: 'Approve Ana' }).click();
	await dinnerCard.getByRole('button', { name: 'Reject Ben' }).click();
	await expect(dinnerCard).not.toContainText('pending');
	await expect(dinnerCard).toContainText('2 submitted');
	await expect(phone.page.getByTestId('pending-total')).toHaveText('3 pending');
	await brunchCard.getByRole('button', { name: 'Approve all pending (3)' }).click();
	await expect(phone.page.getByTestId('pending-total')).toHaveCount(0);
	await expect(brunchCard).not.toContainText('pending');
	await expect(brunchCard).toContainText('3 submitted');

	await dinnerCard.getByRole('link', { name: 'Axis dinner' }).click();
	await expect(phone.page).toHaveURL(new RegExp(`/e/${dinner}$`));
	const roster = phone.page.getByTestId('roster');
	await expect(roster.getByRole('listitem').filter({ hasText: 'Ana' })).toContainText('Approved');
	await expect(roster.getByRole('listitem').filter({ hasText: 'Ben' })).toContainText('Rejected');
	await phone.page.getByRole('link', { name: 'My events' }).click();
	await expect(phone.page).toHaveURL(/\/me$/);
	await expect(phone.page.getByTestId(`event-${dinner}`)).toBeVisible();

	await submitApi(request, dinner, token(), {
		name: 'Finn',
		ranking: [dinnerIds[0]],
		opinion: 'Fine.'
	});
	await phone.page.clock.runFor(15_000);
	await expect(
		phone.page.getByTestId(`event-${dinner}`).getByRole('button', { name: 'Approve Finn' })
	).toBeVisible();

	await phone.page.getByRole('button', { name: 'New event' }).click();
	await expect(phone.page).toHaveURL(/\/new$/);
	await expect(phone.page.getByRole('heading', { name: 'DecisionMaker' })).toBeVisible();
	await phone.context.close();
});
