import { expect, test } from '@playwright/test';
import { createEventApi, openAsHost, optionIds, submitApi, token } from './helpers';

test('four approved responses show no breakdown, and small cost counts stay hidden', async ({
	browser,
	request
}) => {
	const hostToken = token();
	const code = await createEventApi(request, hostToken);
	const ids = await optionIds(request, code);
	for (const name of ['Ana', 'Ben', 'Cleo', 'Dev']) {
		await submitApi(request, code, token(), {
			name,
			ranking: [ids[0]],
			budget: { kind: 'limit', amount: 20 }
		});
	}
	const four = await openAsHost(browser, code, hostToken);
	await four.page.getByRole('button', { name: 'Close submissions' }).click();
	await four.page.getByRole('button', { name: 'Approve pending and close' }).click();
	await expect(four.page.getByText('4 approved responses')).toBeVisible();
	await expect(
		four.page.getByText('Numbers appear once at least 5 approved responses')
	).toBeVisible();
	await expect(four.page.getByText('First choices')).toHaveCount(0);
	await expect(four.page.getByText('over budget')).toHaveCount(0);
	await four.context.close();

	const code2 = await createEventApi(request, hostToken);
	const ids2 = await optionIds(request, code2);
	for (const [i, name] of ['Ana', 'Ben', 'Cleo', 'Dev', 'Eli'].entries()) {
		await submitApi(request, code2, token(), {
			name,
			ranking: [ids2[0]],
			budget: i < 2 ? { kind: 'limit', amount: 20 } : { kind: 'no_limit' }
		});
	}
	const five = await openAsHost(browser, code2, hostToken);
	await five.page.getByRole('button', { name: 'Close submissions' }).click();
	await five.page.getByRole('button', { name: 'Approve pending and close' }).click();
	await expect(five.page.getByText('5 approved responses')).toBeVisible();
	await expect(five.page.getByTestId(`first-${ids2[0]}`)).toHaveText('5');
	await expect(five.page.getByText('5 of 5 answered the budget question.')).toBeVisible();
	await expect(five.page.getByText('over budget')).toHaveCount(0);
	await five.context.close();
});
