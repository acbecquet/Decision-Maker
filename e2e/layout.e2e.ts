import { expect, test, type Locator, type Page } from '@playwright/test';
import { createEventApi, newDevice, openAsHost, optionIds, submitApi, token } from './helpers';

const NARROW = { width: 360, height: 780 };
const LONG = 'Tapas crawl through El Born and a rooftop bar afterwards';

/** How many lines a block of text occupies, from its height and computed line height. */
const lines = (el: Locator) =>
	el.evaluate((node) => {
		const box = node.getBoundingClientRect();
		return Math.round(box.height / parseFloat(getComputedStyle(node).lineHeight));
	});

/** True when nothing inside the element is clipped or cut with an ellipsis. */
const unclipped = (el: Locator) => el.evaluate((node) => node.scrollWidth <= node.clientWidth + 1);

const noSideways = (page: Page) =>
	page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('long labels wrap on a narrow phone and every control stays on one line', async ({
	browser,
	request
}) => {
	const hostToken = token();
	const code = await createEventApi(request, hostToken, {
		options: [
			{ label: LONG, note: '', cost: 25 },
			{ label: 'Beach BBQ', note: '', cost: 15 }
		]
	});
	const ids = await optionIds(request, code);

	const { context, page } = await newDevice(browser, NARROW);
	await page.goto(`/e/${code}`);
	await page.getByLabel('Your name').fill('Sam');
	await page
		.getByTestId('unranked')
		.getByRole('button', { name: /^Tapas crawl/ })
		.click();
	const row = page.getByTestId('ranked').getByRole('listitem').first();
	const label = row.locator('.grow');
	await expect(label).toContainText(LONG);
	expect(await lines(label)).toBeGreaterThan(1);
	expect(await unclipped(label)).toBe(true);
	const controls = [
		row.getByRole('button', { name: `Move ${LONG} up` }),
		row.getByRole('button', { name: `Move ${LONG} down` }),
		row.getByRole('button', { name: `Remove ${LONG} from ranking` }),
		row.getByRole('button', { name: `Won't work for ${LONG}` })
	];
	const boxes = [];
	for (const control of controls) {
		await expect(control).toBeVisible();
		boxes.push((await control.boundingBox())!);
	}
	const centre = (b: { y: number; height: number }) => b.y + b.height / 2;
	for (const box of boxes) {
		expect(Math.abs(centre(box) - centre(boxes[0]))).toBeLessThan(2);
		expect(box.x + box.width).toBeLessThanOrEqual(NARROW.width);
	}
	expect(await noSideways(page)).toBe(true);
	await page.getByRole('button', { name: 'Submit', exact: true }).click();
	await page.getByRole('heading', { name: 'Thanks, Sam' }).waitFor();
	await context.close();

	for (const name of ['Ana', 'Ben', 'Cleo', 'Dev']) {
		await submitApi(request, code, token(), { name, ranking: [ids[0], ids[1]] });
	}
	await request.post(`/api/events/${code}/close`, {
		headers: { 'x-host-token': hostToken },
		data: { pending: 'approve' }
	});
	const host = await openAsHost(browser, code, hostToken);
	await host.page.setViewportSize(NARROW);
	await expect(host.page.getByRole('heading', { name: 'Numbers' })).toBeVisible();
	const bar = host.page.getByTestId('first-choices').locator('.bar', { hasText: LONG }).first();
	const name = bar.locator('.name');
	await expect(name).toHaveText(LONG);
	expect(await lines(name)).toBeGreaterThan(1);
	expect(await unclipped(name)).toBe(true);
	expect(await noSideways(host.page)).toBe(true);
	await host.context.close();
});
