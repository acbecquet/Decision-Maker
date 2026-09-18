import { expect, test, type APIRequestContext } from '@playwright/test';
import {
	createEventApi,
	openAsHost,
	openAsParticipant,
	optionIds,
	submitApi,
	token,
	viewApi
} from './helpers';

const names = ['Ana', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay'];

/** An event with six submissions carrying SENTINEL opinions, Fay rejected, closed with the rest approved. */
async function closedEvent(request: APIRequestContext, count = names.length) {
	const hostToken = token();
	const host = { 'x-host-token': hostToken };
	const code = await createEventApi(request, hostToken);
	const ids = await optionIds(request, code);
	const devices = names.slice(0, count).map(() => token());
	for (const [i, name] of names.slice(0, count).entries()) {
		const res = await submitApi(request, code, devices[i], {
			name,
			ranking: [ids[i % 4], ids[(i + 1) % 4]],
			budget: i % 2 === 0 ? { kind: 'limit', amount: 25 } : null,
			opinion: `SENTINEL-${name} has strong feelings. Cheap is good.`,
			suggestion: i === 0 ? 'SENTINEL flamenco' : ''
		});
		expect(res.status()).toBe(201);
	}
	if (count === names.length) {
		const roster = (await viewApi(request, code, host)).body.host.roster as {
			id: string;
			name: string;
		}[];
		const fay = roster.find((r) => r.name === 'Fay')!;
		await request.patch(`/api/events/${code}/participants/${fay.id}`, {
			headers: host,
			data: { status: 'rejected' }
		});
	}
	const closed = await request.post(`/api/events/${code}/close`, {
		headers: host,
		data: { pending: 'approve' }
	});
	expect(closed.status()).toBe(200);
	return { code, hostToken, host, devices };
}

test('the host runs the fake analysis, reads the draft, publishes, and only approved devices see the report', async ({
	browser,
	request
}) => {
	const { code, hostToken, devices } = await closedEvent(request);
	const { page, context } = await openAsHost(browser, code, hostToken);
	const bodies: Promise<string>[] = [];
	page.on('response', (res) => {
		if (res.url().includes('/api/')) bodies.push(res.text().catch(() => ''));
	});

	await expect(page.getByRole('heading', { name: 'Numbers' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Analysis' })).toBeVisible();
	await page.getByRole('tab', { name: 'Fake (demo)' }).click();
	await expect(page.getByLabel('Model')).toHaveValue('fake-fast');
	await expect(page.getByLabel('Thinking')).toHaveValue('max');
	await page.getByLabel('Model').selectOption('fake-slow');
	await page.getByRole('button', { name: 'Run analysis' }).click();
	await expect(page.getByRole('status')).toContainText(/Rewriting|Writing the report/);

	const report = page.getByTestId('report');
	await expect(report).toBeVisible({ timeout: 20_000 });
	await expect(page.getByRole('heading', { name: 'Draft' })).toBeVisible();
	await expect(report).toContainText('Best option');
	await expect(report).toContainText('5 approved responses, draft');
	await expect(report.getByRole('heading', { name: 'First choices' })).toBeVisible();
	await expect(report).toContainText('What people said');
	await expect(report.locator('blockquote').first()).toBeVisible();
	// The only Numbers heading left is the one inside the report; the standalone section is gone.
	await expect(page.getByRole('heading', { name: 'Numbers' })).toHaveCount(1);
	await expect(report.getByRole('heading', { name: 'Numbers' })).toHaveCount(1);

	await page.getByRole('button', { name: 'Run again' }).click();
	await expect(page.getByLabel('Model')).toHaveValue('fake-slow');
	await expect(page.getByTestId('report')).toHaveCount(0);
	await page.getByRole('button', { name: 'Back to the draft' }).click();
	await expect(page.getByTestId('report')).toBeVisible();

	await page.getByRole('button', { name: 'Publish' }).click();
	await expect(page.getByRole('dialog')).toContainText('Raw rankings and opinions are deleted');
	await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
	await expect(page.getByText('Published', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Copy summary' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Publish' })).toHaveCount(0);
	await expect(report).toContainText(/published [A-Za-z]{3} \d{1,2}, \d{4}/);

	const everything = (await Promise.all(bodies)).join('\n');
	expect(everything).not.toContain('SENTINEL');
	expect(everything).not.toContain('"opinion"');

	const ana = await openAsParticipant(browser, code, devices[0]);
	await expect(ana.page.getByTestId('report')).toBeVisible();
	await expect(ana.page.getByTestId('report')).toContainText('Best option');
	await expect(ana.page.getByRole('button', { name: 'Copy summary' })).toHaveCount(0);
	await expect(ana.page.getByText('Submissions are closed')).toHaveCount(0);
	await ana.context.close();

	const fay = await openAsParticipant(browser, code, devices[5]);
	await expect(
		fay.page.getByText('The host shared results with the approved group.')
	).toBeVisible();
	await expect(fay.page.getByTestId('report')).toHaveCount(0);
	await fay.context.close();

	const stranger = await openAsParticipant(browser, code, token());
	await expect(
		stranger.page.getByText('The host shared results with the approved group.')
	).toBeVisible();
	await stranger.context.close();
	await context.close();
});

test('a failed run shows the error and the host can run again', async ({ browser, request }) => {
	const { code, hostToken, host } = await closedEvent(request);
	const started = await request.post(`/api/events/${code}/analysis`, {
		headers: host,
		data: { provider: 'fake', key: 'demo', model: 'fake-broken' }
	});
	expect(started.status()).toBe(202);
	await expect
		.poll(
			async () =>
				(await (await request.get(`/api/events/${code}/analysis`, { headers: host })).json()).status
		)
		.toBe('failed');

	const { page, context } = await openAsHost(browser, code, hostToken);
	await expect(page.getByRole('alert')).toContainText('told to fail');
	await expect(page.getByTestId('report')).toHaveCount(0);
	await page.getByRole('tab', { name: 'Fake (demo)' }).click();
	await expect(page.getByLabel('Model')).toHaveValue('fake-fast');
	await page.getByRole('button', { name: 'Run analysis' }).click();
	await expect(page.getByTestId('report')).toBeVisible({ timeout: 20_000 });
	await expect(page.getByRole('alert')).toHaveCount(0);
	await context.close();
});

test('below five approved responses the report withholds the breakdown', async ({
	browser,
	request
}) => {
	const { code, hostToken } = await closedEvent(request, 3);
	const { page, context } = await openAsHost(browser, code, hostToken);
	await page.getByRole('tab', { name: 'Fake (demo)' }).click();
	await expect(page.getByLabel('Model')).toHaveValue('fake-fast');
	await page.getByRole('button', { name: 'Run analysis' }).click();
	const report = page.getByTestId('report');
	await expect(report).toBeVisible({ timeout: 20_000 });
	await expect(report).toContainText('Numbers appear once at least 5 approved responses are in.');
	await expect(report.getByRole('heading', { name: 'First choices' })).toHaveCount(0);
	await expect(report).toContainText('Best option');
	await context.close();
});
