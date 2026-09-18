import { randomBytes } from 'node:crypto';
import {
	test,
	type APIRequestContext,
	type Browser,
	type BrowserContext,
	type Page
} from '@playwright/test';

/** A fresh 64-hex token, the same shape the browser generates. */
export const token = () => randomBytes(32).toString('hex');

export const sampleOptions = [
	{ label: 'Tapas crawl', note: 'El Born', cost: 25 },
	{ label: 'Beach BBQ', note: '', cost: 15 },
	{ label: 'Rooftop bar', note: '', cost: 45 },
	{ label: 'Paella class', note: '', cost: null }
];

export async function createEventApi(
	request: APIRequestContext,
	hostToken: string,
	overrides: Record<string, unknown> = {}
): Promise<string> {
	const res = await request.post('/api/events', {
		headers: { 'x-host-token': hostToken },
		data: {
			title: 'Saturday night',
			context: 'Dinner plans',
			currency: 'EUR',
			options: sampleOptions,
			closesAt: null,
			...overrides
		}
	});
	if (res.status() !== 201) throw new Error(`create failed: ${res.status()} ${await res.text()}`);
	const { code } = (await res.json()) as { code: string };
	return code;
}

export async function viewApi(
	request: APIRequestContext,
	code: string,
	headers: Record<string, string> = {}
) {
	const res = await request.get(`/api/events/${code}`, { headers });
	return { status: res.status(), body: await res.json() };
}

export async function optionIds(request: APIRequestContext, code: string): Promise<string[]> {
	const { body } = await viewApi(request, code);
	return (body.event.options as { id: string }[]).map((o) => o.id);
}

export function submitApi(
	request: APIRequestContext,
	code: string,
	participantToken: string,
	body: Record<string, unknown>,
	extraHeaders: Record<string, string> = {}
) {
	return request.post(`/api/events/${code}/responses`, {
		headers: { 'x-participant-token': participantToken, ...extraHeaders },
		data: body
	});
}

/** A fresh browser context is a fresh device: its own storage, so its own tokens. */
export async function newDevice(
	browser: Browser
): Promise<{ context: BrowserContext; page: Page }> {
	const use = test.info().project.use;
	const context = await browser.newContext({
		baseURL: use.baseURL,
		viewport: use.viewport ?? undefined,
		deviceScaleFactor: use.deviceScaleFactor,
		isMobile: use.isMobile,
		hasTouch: use.hasTouch
	});
	const page = await context.newPage();
	return { context, page };
}

export type Person = {
	name: string;
	/** Option labels in ranking order. Matched as a prefix, so "Tapas" matches "Tapas crawl". */
	rank: string[];
	veto?: string[];
	/** Text of the budget chip to tap, for example "Up to €25" or "No limit". */
	budget?: string;
	opinion?: string;
	suggestion?: string;
};

const startsWith = (label: string) =>
	new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

/** Opens the link on a fresh device, fills the form as the given person, submits, and closes the device. */
export async function submitViaUi(browser: Browser, code: string, person: Person): Promise<void> {
	const { context, page } = await newDevice(browser);
	await page.goto(`/e/${code}`);
	await page.getByLabel('Your name').fill(person.name);
	const unranked = page.getByTestId('unranked');
	for (const label of person.rank) {
		await unranked.getByRole('button', { name: startsWith(label) }).click();
	}
	for (const label of person.veto ?? []) {
		await page.getByRole('button', { name: `Won't work for ${label}` }).click();
	}
	if (person.budget) await page.getByRole('button', { name: person.budget }).click();
	if (person.opinion) await page.getByLabel('Your opinion').fill(person.opinion);
	if (person.suggestion) await page.getByLabel('Something not listed?').fill(person.suggestion);
	await page.getByRole('button', { name: 'Submit', exact: true }).click();
	await page.getByRole('heading', { name: `Thanks, ${person.name}` }).waitFor();
	await context.close();
}
