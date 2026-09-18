import { expect, test } from '@playwright/test';
import { newDevice, submitViaUi, type Person } from './helpers';

const people: Person[] = [
	{
		name: 'Ana',
		rank: ['Tapas', 'Rooftop', 'Beach'],
		budget: 'Up to €25',
		opinion: 'SENTINEL-Ana central is key'
	},
	{
		name: 'Ben',
		rank: ['Tapas', 'Beach'],
		veto: ['Paella'],
		budget: 'Up to €25',
		opinion: 'SENTINEL-Ben cheap and cheerful'
	},
	{
		name: 'Cleo',
		rank: ['Rooftop', 'Tapas'],
		budget: 'No limit',
		opinion: 'SENTINEL-Cleo views please'
	},
	{
		name: 'Dev',
		rank: ['Beach', 'Tapas', 'Rooftop'],
		budget: 'Up to €45',
		opinion: 'SENTINEL-Dev beach if sunny'
	},
	{
		name: 'Eli',
		rank: ['Tapas', 'Paella'],
		budget: 'Up to €25',
		opinion: 'SENTINEL-Eli early flight sunday'
	},
	{ name: 'Fay', rank: ['Rooftop'], veto: ['Beach'], opinion: 'SENTINEL-Fay hates sand' }
];

test('the whole Barcelona story through close, with the host never seeing a raw answer', async ({
	browser
}) => {
	const host = await newDevice(browser);
	const bodies: string[] = [];
	host.page.on('response', async (res) => {
		if (!res.url().includes('/api/')) return;
		try {
			bodies.push(await res.text());
		} catch {
			// A navigation can discard a body; nothing to record.
		}
	});

	await host.page.goto('/');
	await host.page.getByLabel('What are you deciding?').fill('Saturday night in Barcelona');
	await host.page.getByLabel('Context').fill('Dinner plans for the group');
	await host.page.getByLabel('Option 1').fill('Tapas crawl');
	await host.page.getByLabel('Cost per person').nth(0).fill('25');
	await host.page.getByLabel('Option 2').fill('Beach BBQ');
	await host.page.getByLabel('Cost per person').nth(1).fill('15');
	await host.page.getByRole('button', { name: 'Add option' }).click();
	await host.page.getByLabel('Option 3').fill('Rooftop bar');
	await host.page.getByLabel('Cost per person').nth(2).fill('45');
	await host.page.getByRole('button', { name: 'Add option' }).click();
	await host.page.getByLabel('Option 4').fill('Paella class');
	await host.page.getByRole('button', { name: 'Create event' }).click();
	await expect(host.page).toHaveURL(/\?created=1$/);
	const code = new URL(host.page.url()).pathname.split('/').pop() as string;
	await host.page.getByRole('button', { name: 'Continue to host view' }).click();
	await expect(host.page.getByText('0 submitted')).toBeVisible();

	for (const person of people) await submitViaUi(browser, code, person);

	await host.page.reload();
	await expect(host.page.getByText('6 submitted')).toBeVisible();
	await expect(host.page.getByTestId('roster').getByRole('listitem')).toHaveCount(6);
	await expect(host.page.getByText('First choices')).toHaveCount(0);

	await host.page.getByRole('button', { name: 'Reject Fay' }).click();
	await host.page.getByRole('button', { name: 'Approve all pending (5)' }).click();
	await host.page.getByRole('button', { name: 'Close submissions' }).click();
	await host.page.getByRole('button', { name: 'Close now' }).click();

	await expect(host.page.getByText('Closed', { exact: true })).toBeVisible();
	await expect(host.page.getByText('5 approved responses')).toBeVisible();
	const first = host.page.getByTestId('first-choices');
	await expect(first).toContainText('Tapas crawl');
	await expect(first.locator('[data-testid^="first-"]')).toHaveText(['3', '1', '1', '0']);
	await expect(
		host.page.getByText('Tapas crawl beats every other option head to head.')
	).toBeVisible();
	await expect(host.page.getByText('5 of 5 set a limit.')).toBeVisible();
	await expect(host.page.getByText('over budget for 3')).toBeVisible();

	const everything = bodies.join('\n');
	expect(everything).not.toContain('SENTINEL');
	expect(everything).not.toContain('"ranking"');
	expect(everything).not.toContain('"budget"');
	await expect(host.page.getByRole('button', { name: /reopen/i })).toHaveCount(0);

	const late = await newDevice(browser);
	await late.page.goto(`/e/${code}`);
	await expect(late.page.getByRole('heading', { name: 'Submissions are closed' })).toBeVisible();
	await late.context.close();
	await host.context.close();
});
