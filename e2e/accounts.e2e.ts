import { expect, test } from '@playwright/test';
import { createEventApi, newDevice, token } from './helpers';

test('a host signs in by magic link, sees the event on another device, and signs out', async ({
	browser,
	request
}) => {
	const hostToken = token();
	const code = await createEventApi(request, hostToken, { title: 'Sunday brunch' });
	const email = `ui-${code}@example.test`;

	const phone = await newDevice(browser);
	await phone.context.addInitScript(
		([key, value]) => localStorage.setItem(key, value),
		[`dm:${code}:host`, hostToken]
	);
	await phone.page.goto('/me');
	await expect(phone.page).toHaveURL(/\/signin$/);
	await phone.page.getByLabel('Email').fill(email);
	await phone.page.getByRole('button', { name: 'Send link' }).click();
	await expect(phone.page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

	const mail = await request.get(`/api/test/mail?to=${encodeURIComponent(email)}`);
	expect(mail.status()).toBe(200);
	const link = new URL((await mail.json()).url);
	await phone.page.goto(link.pathname + link.search);
	await phone.page.getByRole('button', { name: 'Finish signing in' }).click();
	await expect(phone.page).toHaveURL(/\/me$/);
	await expect(phone.page.getByText(email)).toBeVisible();
	const list = phone.page.getByTestId('my-events');
	await expect(list.getByRole('listitem')).toHaveCount(1);
	await expect(list).toContainText('Sunday brunch');
	await expect(list).toContainText('0 submitted');

	const laptop = await browser.newContext({ baseURL: test.info().project.use.baseURL });
	await laptop.addCookies(await phone.context.cookies());
	const laptopPage = await laptop.newPage();
	await laptopPage.goto(`/e/${code}`);
	await expect(laptopPage.getByRole('heading', { name: 'Names' })).toBeVisible();
	await expect(laptopPage.getByRole('button', { name: 'Close submissions' })).toBeVisible();
	await laptop.close();

	await phone.page.getByRole('button', { name: 'Sign out' }).click();
	await expect(phone.page).toHaveURL(/\/$/);
	await phone.page.goto('/me');
	await expect(phone.page).toHaveURL(/\/signin$/);
	await phone.context.close();
});

test('a used link is refused with a plain message', async ({ browser, request }) => {
	const email = `used-${token().slice(0, 8)}@example.test`;
	await request.post('/api/auth/magic-link', { data: { email } });
	const link = new URL(
		(await (await request.get(`/api/test/mail?to=${encodeURIComponent(email)}`)).json()).url
	);
	const magic = link.searchParams.get('token');
	expect(
		(await request.post('/api/auth/session', { data: { token: magic, hostTokens: [] } })).status()
	).toBe(200);

	const { page, context } = await newDevice(browser);
	await page.goto(link.pathname + link.search);
	await page.getByRole('button', { name: 'Finish signing in' }).click();
	await expect(page.getByRole('alert')).toContainText('already been used');
	await context.close();
});

test('a link opened on a different device than the one that requested it is refused', async ({
	browser,
	request
}) => {
	const email = `bound-${token().slice(0, 8)}@example.test`;

	const requester = await newDevice(browser);
	await requester.page.goto('/signin');
	await requester.page.getByLabel('Email').fill(email);
	await requester.page.getByRole('button', { name: 'Send link' }).click();
	await expect(requester.page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
	await requester.context.close();

	const link = new URL(
		(await (await request.get(`/api/test/mail?to=${encodeURIComponent(email)}`)).json()).url
	);

	const { page, context } = await newDevice(browser);
	await page.goto(link.pathname + link.search);
	await page.getByRole('button', { name: 'Finish signing in' }).click();
	await expect(page.getByRole('alert')).toContainText('browser that asked for it');
	await context.close();
});
