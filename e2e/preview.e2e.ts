import { expect, test } from '@playwright/test';
import { createEventApi, newDevice, token } from './helpers';

test('the shared link carries the title and unfurls with it, and the bare link still works', async ({
	browser,
	request
}) => {
	const code = await createEventApi(request, token(), { title: 'Fall of the Axis dinner' });
	const slug = 'fall-of-the-axis-dinner';

	for (const path of [`/e/${code}/${slug}`, `/e/${code}`, `/e/${code}/some-stale-slug`]) {
		const res = await request.get(path, { maxRedirects: 0 });
		expect(res.status()).toBe(200);
		const html = await res.text();
		expect(html).toContain('<title>Fall of the Axis dinner</title>');
		expect(html).toContain('<meta property="og:title" content="Fall of the Axis dinner"');
		expect(html).toContain(
			`<meta property="og:url" content="${test.info().project.use.baseURL}/e/${code}/${slug}"`
		);
		expect(html).not.toMatch(/og:(description|image|site_name)/);
		expect(html.match(/<title>/g)).toHaveLength(1);
	}

	const reserved = await createEventApi(request, token(), { title: 'Edit' });
	const reservedHtml = await (await request.get(`/e/${reserved}`, { maxRedirects: 0 })).text();
	expect(reservedHtml).toContain(
		`<meta property="og:url" content="${test.info().project.use.baseURL}/e/${reserved}"`
	);

	const missing = await request.get('/e/nosuchcode1/whatever', { maxRedirects: 0 });
	expect(missing.status()).toBe(200);
	const missingHtml = await missing.text();
	expect(missingHtml).toContain('<title>DecisionMaker</title>');
	expect(missingHtml).not.toContain('og:title');

	const phone = await newDevice(browser);
	await phone.page.goto(`/e/${code}/${slug}`);
	await expect(phone.page.getByRole('heading', { name: 'Fall of the Axis dinner' })).toBeVisible();
	await expect(phone.page.getByLabel('Your name')).toBeVisible();
	await phone.context.close();
});
