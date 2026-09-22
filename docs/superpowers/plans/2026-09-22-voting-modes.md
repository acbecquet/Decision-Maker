# Voting Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A host chooses, when creating an event, whether people rank the options (today's behaviour), pick exactly one option, or only write an opinion with no options at all, and every screen, rule, prompt, and report follows the choice, while every existing event keeps working as a ranked one.

**Architecture:** One `mode` column on `events` (`ranked`, `single`, `freeform`, default `ranked`) flows into `EventView`, so every component and prompt can branch on it.
Rankings stay the storage shape in every mode (a pick is a ranking of one, an opinions-only answer has an empty ranking), and one shared rule validates a submission against the mode on both sides.
Aggregation is unchanged; the tallies view, the prompts, the fake provider, the report shape (version 2 with an optional decision block, version 1 upgraded on read), the report view, and the copy summary are what branch.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, Drizzle (migration 0002), zod, Vitest, Playwright.

## Global Constraints

- Design spec section 6.9 (added 2026-09-22) is the source of truth; sections 6.1, 6.3, 7.1, 8, 9, and 10 still apply in ranked mode exactly as written.
- Every existing event is ranked: the column defaults to `ranked`, no stored row changes meaning, and a version 1 report (the live published event has one) renders exactly as before.
- Mode is chosen on the create form and can change only while nobody has submitted, which `updateEvent` already enforces for every field.
- Privacy and suppression rules are untouched: names and statuses only for the host, section 8.4 thresholds wherever numbers appear, no raw text after publish.
- Copy rule: no explanatory prose that states the obvious; labels are the ones in this plan.
- No em dashes; commit messages carry no co-author or generated-by lines.
- `npm run lint`, `npm run check`, `npx vitest run`, and `npm run test:e2e` pass before a task is done. Never stop a server with `taskkill //IM node.exe`; stop by PID only.
- Migrations come from `npm run db:generate` after the schema change; the generated file name is whatever drizzle-kit picks.

---

### Task 1: The mode in the data model and the rules

**Files:**
- Modify: `src/lib/shared/constants.ts`
- Modify: `src/lib/shared/types.ts`
- Modify: `src/lib/shared/report.ts`
- Modify: `src/lib/shared/validation.ts`
- Modify: `src/lib/server/db/schema.ts` (+ generated `drizzle/0002_*.sql` and `drizzle/meta/*`)
- Modify: `src/lib/server/events.ts`
- Modify: `src/lib/server/participants.ts`
- Test: `src/lib/shared/validation.test.ts`, `src/lib/shared/report.test.ts` (new), `src/lib/server/events.test.ts`

**Interfaces:**
- Produces: `EventMode`, `MODES`, `MODE_LABELS`; `EventView.mode`; `CreateEventInput.mode`; `checkResponseForMode(mode, input): string | null`; `Report` version 2 with `mode` and `decision: Decision | null`; `upgradeReport(stored: unknown): Report | null`.
- Consumers: Task 2 (forms and tallies) and Task 3 (analysis and report).

- [ ] **Step 1: Constants and types**

In `src/lib/shared/constants.ts` add:

```ts
export const MODES = ['ranked', 'single', 'freeform'] as const;
export const MODE_LABELS = {
	ranked: 'Rank the options',
	single: 'Pick one option',
	freeform: 'Opinions only'
} as const;
```

In `src/lib/shared/types.ts` add `export type EventMode = (typeof MODES)[number];` (import `MODES` from `./constants`) and add `mode: EventMode;` to `EventView` after `currency`.

In `src/lib/shared/report.ts` replace the `Report` type with version 2 and add the upgrade:

```ts
export type Decision = {
	best: { optionId: string; verdict: string; rationale: string; consensus: Consensus };
	runnerUp: { optionId: string; rationale: string };
	worst: { optionId: string; rationale: string };
};

/** The stored report. Self-contained: quote text is embedded so the purge cannot orphan it. */
export type Report = {
	version: 2;
	mode: EventMode;
	/** Null for an opinions-only event, which has no options to decide between. */
	decision: Decision | null;
	unexpected: ReportUnexpected;
	themes: ReportTheme[];
	stillToSettle: string[];
	summary: string;
	provider: ProviderId;
	model: string;
	promptVersion: string;
	generatedAt: string;
};

/** A stored report of any version this code has ever written, or null when it is not one. */
export function upgradeReport(stored: unknown): Report | null {
	if (!stored || typeof stored !== 'object') return null;
	const r = stored as Record<string, unknown>;
	if (r.version === 2) return r as unknown as Report;
	if (r.version === 1) {
		const { best, runnerUp, worst, ...rest } = r as unknown as Decision & Record<string, unknown>;
		return { ...rest, version: 2, mode: 'ranked', decision: { best, runnerUp, worst } } as Report;
	}
	return null;
}
```

Add `mode: EventMode;` to `ReportView` after `currency`.

- [ ] **Step 2: Schema and migration**

In `src/lib/server/db/schema.ts` add to `events`, after `currency`:

```ts
	mode: text('mode').$type<EventMode>().notNull().default('ranked'),
```

Run `npm run db:generate`; commit the generated `drizzle/0002_*.sql` and the `drizzle/meta` changes. The SQL must be a single `ALTER TABLE events ADD mode text DEFAULT 'ranked' NOT NULL;` (drizzle may quote the names).

- [ ] **Step 3: Failing tests for the rules**

In `src/lib/shared/validation.test.ts` add:

```ts
describe('mode rules', () => {
	const base = { title: 'T', context: '', currency: 'EUR' as const, closesAt: null };
	const two = [
		{ label: 'Yes', note: '', cost: null },
		{ label: 'No', note: '', cost: null }
	];

	it('defaults the mode to ranked and needs two options unless opinions only', () => {
		expect(createEventInput.parse({ ...base, options: two }).mode).toBe('ranked');
		expect(createEventInput.safeParse({ ...base, mode: 'single', options: two }).success).toBe(true);
		expect(
			createEventInput.safeParse({ ...base, mode: 'ranked', options: [two[0]] }).error?.issues[0]
				?.message
		).toBe('Add at least two options');
		expect(createEventInput.safeParse({ ...base, mode: 'freeform', options: [] }).success).toBe(true);
		expect(
			createEventInput.safeParse({ ...base, mode: 'freeform', options: two }).error?.issues[0]
				?.message
		).toBe('Opinions only takes no options');
	});

	it('checks a submission against the mode', () => {
		const answer = { ranking: ['a'], vetoes: [], budget: null, opinion: 'ok', suggestion: '' };
		expect(checkResponseForMode('ranked', answer)).toBeNull();
		expect(checkResponseForMode('ranked', { ...answer, ranking: [] })).toBe('Rank at least one option');
		expect(checkResponseForMode('single', answer)).toBeNull();
		expect(checkResponseForMode('single', { ...answer, ranking: ['a', 'b'] })).toBe('Pick one option');
		expect(checkResponseForMode('single', { ...answer, vetoes: ['b'] })).toBe('Pick one option');
		expect(checkResponseForMode('freeform', { ...answer, ranking: [] })).toBeNull();
		expect(checkResponseForMode('freeform', answer)).toBe('Opinions only takes no ranking');
		expect(checkResponseForMode('freeform', { ...answer, ranking: [], opinion: ' ' })).toBe(
			'Write your opinion'
		);
		expect(
			checkResponseForMode('freeform', { ...answer, ranking: [], budget: { kind: 'no_limit' } })
		).toBe('Opinions only takes no ranking');
	});
});
```

Create `src/lib/shared/report.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { upgradeReport } from './report';

const v1 = {
	version: 1,
	best: { optionId: 'a', verdict: 'A wins', rationale: 'Most first choices', consensus: 'strong' },
	runnerUp: { optionId: 'b', rationale: 'Second' },
	worst: { optionId: 'c', rationale: 'Third' },
	unexpected: null,
	themes: [],
	stillToSettle: [],
	summary: 'Go with A.',
	provider: 'fake',
	model: 'fake-fast',
	promptVersion: 'v1',
	generatedAt: '2026-09-22T00:00:00.000Z'
};

describe('upgradeReport', () => {
	it('lifts a version 1 report into a ranked decision and keeps everything else', () => {
		const report = upgradeReport(v1);
		expect(report).toMatchObject({
			version: 2,
			mode: 'ranked',
			decision: { best: v1.best, runnerUp: v1.runnerUp, worst: v1.worst },
			summary: 'Go with A.',
			promptVersion: 'v1'
		});
		expect(report).not.toHaveProperty('best');
	});

	it('passes a version 2 report through and rejects anything else', () => {
		const v2 = { ...upgradeReport(v1)!, mode: 'single' as const };
		expect(upgradeReport(v2)).toBe(v2);
		expect(upgradeReport({ version: 3 })).toBeNull();
		expect(upgradeReport(null)).toBeNull();
	});
});
```

In `src/lib/server/events.test.ts` add to the `createEvent` describe: an event created with `mode: 'single'` reads back with `mode` `'single'` from `findEventByCode` and `toEventView`, and one created without a mode reads back `'ranked'`; and in the `updateEvent` tests, an update that switches `mode` to `'freeform'` with `options: []` leaves the event with no options and mode `'freeform'`.

Run: `npx vitest run src/lib/shared/validation.test.ts src/lib/shared/report.test.ts src/lib/server/events.test.ts`
Expected: FAIL on the missing exports and fields.

- [ ] **Step 4: Validation**

In `src/lib/shared/validation.ts`:

```ts
export const createEventInput = z
	.object({
		title: trimmed(LIMITS.title).min(1, 'Enter a title'),
		context: trimmed(LIMITS.context).default(''),
		currency: z.enum(CURRENCIES, 'Pick a currency'),
		mode: z.enum(MODES).default('ranked'),
		options: z.array(optionInput).max(LIMITS.maxOptions, `At most ${LIMITS.maxOptions} options`),
		closesAt: isoInstant.nullable().default(null)
	})
	.superRefine((v, ctx) => {
		if (v.mode === 'freeform' && v.options.length > 0) {
			ctx.addIssue({ code: 'custom', path: ['options'], message: 'Opinions only takes no options' });
		}
		if (v.mode !== 'freeform' && v.options.length < LIMITS.minOptions) {
			ctx.addIssue({ code: 'custom', path: ['options'], message: 'Add at least two options' });
		}
	});
```

Drop the `.min(1, 'Rank at least one option')` from `responseInput.ranking` (keep the `.max`), and add:

```ts
/** The one rule, shared by the server and the form, for what a submission may carry in each mode. */
export function checkResponseForMode(mode: EventMode, input: EditResponseInput): string | null {
	if (mode === 'ranked') return input.ranking.length === 0 ? 'Rank at least one option' : null;
	if (mode === 'single') {
		return input.ranking.length !== 1 || input.vetoes.length > 0 ? 'Pick one option' : null;
	}
	if (input.ranking.length > 0 || input.vetoes.length > 0 || input.budget !== null) {
		return 'Opinions only takes no ranking';
	}
	return input.opinion.trim() === '' ? 'Write your opinion' : null;
}
```

Import `MODES` from `./constants` and `EventMode` from `./types`.

- [ ] **Step 5: Server**

`src/lib/server/events.ts`: `createEvent` inserts `mode: input.mode`; `updateEvent` sets `mode: input.mode` alongside the other columns it updates; `toEventView` includes `mode: event.mode`.

`src/lib/server/participants.ts`: in both `submitResponse` and `updateResponse`, right after the `checkOptionRefs` guard, add:

```ts
	const modeProblem = checkResponseForMode(event.mode, input);
	if (modeProblem) throw badRequest(modeProblem);
```

Every caller already passes the event row.
The freeform case must also pass `checkOptionRefs` with an empty option list and an empty ranking, which it does.

- [ ] **Step 6: Run the tests and the checks**

Run: `npx vitest run && npm run check && npm run lint`
Expected: PASS; the type change to `Report` will surface every consumer that still reads `report.best` (`src/lib/server/analysis/report.ts`, `src/lib/server/views.ts`, `src/lib/components/ReportView.svelte`, `src/lib/shared/summary.ts`, `src/lib/server/analysis/fake.ts`, tests). Do the minimum in this task to keep `npm run check` green: in `buildReport` produce `version: 2`, `mode` (add a `mode: EventMode` parameter and pass `event.mode` from `job.ts`), and `decision: { best, runnerUp, worst }`; in `views.ts` read the stored report through `upgradeReport` and drop the `report.version !== 1` check in favour of a null check, and add `mode: event.mode` to the returned `ReportView`; in `ReportView.svelte`, `summary.ts`, and `fake.ts` read `report.decision!.best` and so on for now (Task 3 makes them mode-aware). Update the tests those files have so they pass with version 2.

- [ ] **Step 7: Commit**

```bash
git add src/lib/shared src/lib/server drizzle src/lib/components/ReportView.svelte
git commit -m "Give an event a voting mode and one shared rule for what each mode accepts"
```

---

### Task 2: The forms and the tallies follow the mode

**Files:**
- Modify: `src/lib/components/EventForm.svelte`
- Modify: `src/lib/components/ResponseForm.svelte`
- Modify: `src/lib/components/SubmittedCard.svelte`
- Modify: `src/lib/components/TalliesView.svelte`
- Modify: `src/lib/components/HostView.svelte`
- Modify: `src/lib/components/ReportView.svelte` (only to pass `mode` to `TalliesView`)
- Test: `e2e/modes.e2e.ts` (new)

**Interfaces:**
- Consumes: `MODES`, `MODE_LABELS`, `EventView.mode`, `checkResponseForMode` from Task 1.
- Produces: the create form's mode selector, the participant form per mode, the tallies per mode.

- [ ] **Step 1: The failing e2e scenarios**

Create `e2e/modes.e2e.ts`:

```ts
import { expect, test } from '@playwright/test';
import { createEventApi, newDevice, openAsHost, optionIds, submitApi, token } from './helpers';

test.describe('single choice', () => {
	test('a host creates a yes or no event, people pick one, and the tallies show votes', async ({
		browser,
		request
	}) => {
		const host = await newDevice(browser);
		await host.page.goto('/');
		await host.page.getByLabel('What are you deciding?').fill('Is the south overrated?');
		await host.page.getByLabel('Pick one option').check();
		await host.page.getByLabel('Option 1').fill('Yes');
		await host.page.getByLabel('Option 2').fill('No');
		await host.page.getByRole('button', { name: 'Create event' }).click();
		await expect(host.page.getByRole('heading', { name: 'Your event is ready' })).toBeVisible();
		const code = new URL(host.page.url()).pathname.split('/').pop() as string;

		const phone = await newDevice(browser);
		await phone.page.goto(`/e/${code}`);
		await expect(phone.page.getByText('Pick one option')).toBeVisible();
		await expect(phone.page.getByRole('button', { name: /Won't work/ })).toHaveCount(0);
		await expect(phone.page.getByTestId('ranked')).toHaveCount(0);
		await phone.page.getByLabel('Your name').fill('Ana');
		await phone.page.getByRole('button', { name: 'Submit' }).click();
		await expect(phone.page.getByRole('alert')).toHaveText('Pick one option');
		await phone.page.getByRole('radio', { name: 'Yes' }).check();
		await phone.page.getByRole('button', { name: 'Submit' }).click();
		await expect(phone.page.getByText('Your pick')).toBeVisible();
		await expect(phone.page.getByText('Yes', { exact: true })).toBeVisible();
		await phone.context.close();

		const [yes, no] = await optionIds(request, code);
		expect((await submitApi(request, code, token(), { name: 'Ben', ranking: [yes, no] })).status()).toBe(400);
		expect((await submitApi(request, code, token(), { name: 'Ben', ranking: [yes], vetoes: [no] })).status()).toBe(400);
		for (const [name, pick] of [['Ben', yes], ['Cleo', yes], ['Dev', no], ['Eve', yes]] as const) {
			expect((await submitApi(request, code, token(), { name, ranking: [pick], opinion: 'Sure.' })).status()).toBe(201);
		}

		await host.page.getByRole('button', { name: 'Continue to host view' }).click();
		await host.page.getByRole('button', { name: 'Approve all pending (5)' }).click();
		await host.page.getByRole('button', { name: 'Close submissions' }).click();
		await host.page.getByRole('dialog').getByRole('button', { name: 'Close submissions' }).click();
		await expect(host.page.getByRole('heading', { name: 'Votes' })).toBeVisible();
		await expect(host.page.getByTestId(`first-${yes}`)).toHaveText('4');
		await expect(host.page.getByTestId(`first-${no}`)).toHaveText('1');
		await expect(host.page.getByRole('heading', { name: 'Where each option ranked' })).toHaveCount(0);
		await expect(host.page.getByRole('heading', { name: "Won't work for" })).toHaveCount(0);
		await host.context.close();
	});
});

test.describe('opinions only', () => {
	test('a host creates an event with no options, people write, and the host sees only the count', async ({
		browser,
		request
	}) => {
		const host = await newDevice(browser);
		await host.page.goto('/');
		await host.page.getByLabel('What are you deciding?').fill('How should we split the bill?');
		await host.page.getByLabel('Opinions only').check();
		await expect(host.page.getByLabel('Option 1')).toHaveCount(0);
		await expect(host.page.getByLabel('Currency')).toHaveCount(0);
		await host.page.getByRole('button', { name: 'Create event' }).click();
		await expect(host.page.getByRole('heading', { name: 'Your event is ready' })).toBeVisible();
		const code = new URL(host.page.url()).pathname.split('/').pop() as string;

		const phone = await newDevice(browser);
		await phone.page.goto(`/e/${code}`);
		await expect(phone.page.getByTestId('ranked')).toHaveCount(0);
		await expect(phone.page.getByLabel('Something not listed?')).toHaveCount(0);
		await phone.page.getByLabel('Your name').fill('Ana');
		await phone.page.getByRole('button', { name: 'Submit' }).click();
		await expect(phone.page.getByRole('alert')).toHaveText('Write your opinion');
		await phone.page.getByLabel('Your opinion').fill('Split it evenly, it is simpler.');
		await phone.page.getByRole('button', { name: 'Submit' }).click();
		await expect(phone.page.getByText('Your opinion')).toBeVisible();
		await expect(phone.page.getByText('Your ranking')).toHaveCount(0);
		await phone.context.close();

		expect((await submitApi(request, code, token(), { name: 'Ben', ranking: ['x'], opinion: 'No.' })).status()).toBe(400);
		for (const name of ['Ben', 'Cleo', 'Dev', 'Eve']) {
			expect((await submitApi(request, code, token(), { name, ranking: [], opinion: `${name} thinks per item.` })).status()).toBe(201);
		}

		await host.page.getByRole('button', { name: 'Continue to host view' }).click();
		await host.page.getByRole('button', { name: 'Approve all pending (5)' }).click();
		await host.page.getByRole('button', { name: 'Close submissions' }).click();
		await host.page.getByRole('dialog').getByRole('button', { name: 'Close submissions' }).click();
		await expect(host.page.getByText('5 approved responses')).toBeVisible();
		await expect(host.page.getByRole('heading', { name: 'First choices' })).toHaveCount(0);
		await expect(host.page.getByRole('heading', { name: 'Votes' })).toHaveCount(0);
		await expect(host.page.getByText(/Numbers appear once/)).toHaveCount(0);
		await host.context.close();
	});
});
```

`createEventApi` gains no new behaviour; API-created events default to ranked. If the close dialog's buttons are named differently, use the names `e2e/host.e2e.ts` uses. `submitApi` takes the payload as given; `vetoes` defaults to `[]` server-side when absent.

Run: `npx playwright test e2e/modes.e2e.ts`
Expected: FAIL (no mode selector).

- [ ] **Step 2: The create form**

In `src/lib/components/EventForm.svelte`:
- state: `let mode = $state<EventMode>(seed?.mode ?? 'ranked');`
- markup, after the context field and before the currency select:

```svelte
	<fieldset>
		<legend>How people answer</legend>
		{#each MODES as m (m)}
			<label class="row">
				<input type="radio" name="mode" value={m} bind:group={mode} />
				<span class="grow">{MODE_LABELS[m]}</span>
			</label>
		{/each}
	</fieldset>
```

- wrap the currency select and the whole Options block (heading, cards, Add option) in `{#if mode !== 'freeform'}`; `payload()` sends `mode` and, when `mode === 'freeform'`, `options: []`; when the mode leaves freeform and `options` is empty, restore two blank options.
- keep `removeOption` limited by `LIMITS.minOptions` as it is.

Check the CSS for `fieldset` and `legend` in `src/app.css`; if there is none, add a minimal rule (`fieldset { border: 0; padding: 0; margin: 0 0 12px }`, `legend` styled like `.label`).

- [ ] **Step 3: The participant form**

In `src/lib/components/ResponseForm.svelte`, after `safeParse` succeeds and before the request, add:

```ts
		const problem = checkResponseForMode(event.mode, parsed.data);
		if (problem) {
			error = problem;
			return;
		}
```

Replace the ranking block with a mode switch:

```svelte
	{#if event.mode === 'ranked'}
		<p class="label">Rank the options <span class="muted">tap in order of preference</span></p>
		<RankingWidget options={event.options} currency={event.currency} bind:ranked bind:vetoed />
	{:else if event.mode === 'single'}
		<fieldset>
			<legend>Pick one option</legend>
			{#each event.options as option (option.id)}
				<label class="row">
					<input type="radio" name="pick" value={option.id} bind:group={pick} />
					<span class="grow" style="line-height:1.25">
						{option.label}
						{#if option.cost !== null}
							<span class="muted small">{formatMoney(option.cost, event.currency)}</span>
						{/if}
						{#if option.note}
							<span class="muted small" style="display:block">{option.note}</span>
						{/if}
					</span>
				</label>
			{/each}
		</fieldset>
	{/if}
```

with `let pick = $state<string | null>(initial?.ranking[0] ?? null);` and the payload built as `ranking: event.mode === 'single' ? (pick ? [pick] : []) : event.mode === 'freeform' ? [] : ranked`, `vetoes: event.mode === 'ranked' ? vetoed : []`, `budget: event.mode === 'freeform' ? null : budget`.
In freeform mode hide the budget chips and the suggestion field, make the opinion label `Your opinion` with no `optional` hint, and use the placeholder `What you think the group should do, and why`.
In single mode the opinion placeholder reads `Why you picked it, dealbreakers, what would change your mind`.
`formatMoney` comes from `$lib/shared/money`.

- [ ] **Step 4: The submitted card and the tallies**

`src/lib/components/SubmittedCard.svelte`: in single mode show `<p class="label">Your pick</p><p>{label(mine.ranking[0])}</p>` instead of the ranking list; in freeform mode show neither the ranking nor the vetoes nor the budget lines.

`src/lib/components/TalliesView.svelte`: add a `mode: EventMode` prop.
In freeform mode render only the count line and nothing else, not even the "Numbers appear once" card.
In single mode render the count line, the first-choice bars under the heading `Votes` (same markup and test ids), and the cost section; skip the rank matrix, its caption, the vetoes, and the head-to-head line.
Ranked mode is unchanged.
`HostView.svelte` passes `mode={event.mode}` and `ReportView.svelte` passes `mode={view.mode}`.

- [ ] **Step 5: Run the scenarios, then everything**

Run: `npx playwright test e2e/modes.e2e.ts e2e/create.e2e.ts e2e/participant.e2e.ts e2e/host.e2e.ts`
Expected: PASS.

Run: `npm run lint && npm run check && npx vitest run && npm run test:e2e`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components src/app.css e2e/modes.e2e.ts
git commit -m "Let the create form choose the mode and make the answer form and tallies follow it"
```

---

### Task 3: The analysis and the report follow the mode

**Files:**
- Modify: `src/lib/server/analysis/prompts.ts`
- Modify: `src/lib/server/analysis/schemas.ts`
- Modify: `src/lib/server/analysis/fake.ts`
- Modify: `src/lib/server/analysis/report.ts`
- Modify: `src/lib/server/analysis/job.ts`
- Modify: `src/lib/components/ReportView.svelte`
- Modify: `src/lib/shared/summary.ts`
- Test: `src/lib/server/analysis/prompts.test.ts`, `schemas.test.ts`, `report.test.ts`, `src/lib/shared/summary.test.ts`, `e2e/modes.e2e.ts`

**Interfaces:**
- Consumes: `EventMode`, `Report` version 2, `Decision`, `EventView.mode`, `ReportView.mode` from Task 1; the tallies per mode from Task 2.
- Produces: mode-aware prompts, a freeform synthesis schema, a fake provider that answers every mode, reports with `decision: null` for freeform, and a report view and copy summary per mode.

- [ ] **Step 1: Failing unit tests**

In `src/lib/server/analysis/prompts.test.ts` add tests that build inputs the way the existing ones do and assert:
- `anonymizePrompt` with `mode: 'single'` contains a line `Pick: Yes` and no `Ranking, best first` line and no `Won't work` line; with `mode: 'freeform'` contains no `Options:` block, no `Pick`, and no `Ranking` line.
- `synthesizePrompt` with `mode: 'single'` has a `Votes:` line, no `Rank positions`, no `Borda`, no `Head to head`, and its system text says best is the option with the most votes; with `mode: 'freeform'` has no `Options:` block, a numbers line `5 approved responses. No options and no numbers.`, and its system text names only `unexpected`, `themes`, `stillToSettle`, and `summary` as fields.

In `src/lib/server/analysis/schemas.test.ts` add: `SYNTHESIZE_SCHEMA_FREEFORM` passes `assertStrict` and has no `best` property; `synthesizeOutputFreeform` accepts an object without `best`, `runnerUp`, `worst`.

In `src/lib/server/analysis/report.test.ts` add: `buildReport` for `mode: 'freeform'` with a freeform output returns `decision: null`, `mode: 'freeform'`, `version: 2`; for `mode: 'single'` returns the decision.

In `src/lib/shared/summary.test.ts` add: a freeform view's summary has no `Best:` line; a single-choice view's summary reads `Winner:`, `Runner-up:`, `Fewest votes:`.

Run: `npx vitest run src/lib/server/analysis src/lib/shared/summary.test.ts`
Expected: FAIL.

- [ ] **Step 2: Prompts**

Add `mode: EventMode` to `AnonymizeInput` and `SynthesizeInput`; `job.ts` passes `event.mode` into both.
Bump `PROMPT_VERSION` to `'v2'`.

`anonymizePrompt`: the type line becomes `'Types: reason (why they lean the way they do), condition ...'`; the user text is:
- ranked: as today;
- single: the options block, then `Pick: <label>` (or `none`), no `Won't work` line;
- freeform: no options block, no pick or ranking line, only the fenced opinion and suggestion.

`synthesizePrompt`:
- `numbers()`: single mode returns the count line, `Votes: Yes 4, No 1` from `firstChoice`, and the cost lines; freeform returns `[\`${tallies.approvedCount} approved responses. No options and no numbers.\`]`; ranked as today.
- the system text: in single mode the `best` description reads `best (the option with the most votes; when votes tie, say so in the rationale and pick the one the points support)` and `worst` reads `worst (the fewest votes, factual wording)`; in freeform the fields sentence lists only `unexpected (a participant suggestion or a compromise; null when there is none)`, `themes`, `stillToSettle`, and `summary`, and the option-id sentence is dropped.
- the user text omits the `Options:` block in freeform mode.

- [ ] **Step 3: Schemas**

Add `SYNTHESIZE_SCHEMA_FREEFORM` (the same object without `best`, `runnerUp`, `worst`, and with `unexpected.kind` limited to `suggestion` and `compromise`) and `synthesizeOutputFreeform` (the zod object without those three keys); export a `synthesizeSchemaFor(mode)` and `synthesizeOutputFor(mode)` that pick by mode.
`job.ts` uses them by the event's mode wherever it uses `SYNTHESIZE_SCHEMA` and `synthesizeOutput` today.

- [ ] **Step 4: The report builder and the fake provider**

`buildReport(output, points, quotable, options, meta, mode)`: for freeform, skip the option-id check for the headline options, set `decision: null`, and treat an `unexpected` of kind `option` as null; otherwise build the decision as today.

`fakeSynthesize`: in single mode order the options by `firstChoice` count (ties by option order) instead of Borda; in freeform mode return the freeform shape: no `best`, `runnerUp`, `worst`, themes from point types with the same fillers minus the two that name options, `summary` `The group's opinions cluster around ${themes[0].title.toLowerCase()}.`.
`fakeAnonymize` already copes with an empty ranking.

- [ ] **Step 5: The report view and the copy summary**

`ReportView.svelte`: when `view.report.decision` is null, render no best, runner-up, worst, or `Numbers` section; the tallies section otherwise passes `mode`; in single mode the three card labels read `Winner`, `Runner-up`, and `Fewest votes`; in ranked mode they stay `Best option`, `Runner-up`, `Worst`.
`copySummary`: freeform emits the title, the summary, the unexpected line if any, and the footer; single mode emits `Winner:`, `Runner-up:`, `Fewest votes:`; ranked is unchanged.

- [ ] **Step 6: The e2e continuation**

Extend both scenarios in `e2e/modes.e2e.ts` past the close: the host connects the fake provider and runs the analysis the way `e2e/analysis.e2e.ts` does (copy its steps), then:
- single choice: the report shows `Winner` with `Yes`, the `Votes` heading inside `Numbers`, no `Where each option ranked`; after publishing, a fresh device sees the report; the copy summary text contains `Winner: Yes`.
- opinions only: the report has no `Winner`, no `Best option`, no `Numbers` heading, and has `What people said` with at least one blockquote; the copy summary contains no `Best:` and no `Winner:`.

Run: `npx playwright test e2e/modes.e2e.ts e2e/analysis.e2e.ts`
Expected: PASS.

Run: `npm run lint && npm run check && npx vitest run && npm run test:e2e`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/analysis src/lib/components/ReportView.svelte src/lib/shared/summary.ts src/lib/shared/summary.test.ts src/lib/server/analysis/*.test.ts e2e/modes.e2e.ts
git commit -m "Make the analysis, the report, and the summary follow the voting mode"
```

## Deviations after review

The task reviews changed the code in these ways, and the code is the source of truth over the steps above.

- Task 1: `insertOptions` guards the empty option list an opinions-only event carries, since drizzle refuses an insert with no rows; the server-side mode rule has its own tests in `participants.test.ts`; `buildReport` takes `mode` before `meta`.
- Task 2: `AnalysisSection` also passes `mode` to the tallies; the create form restores two blank options when the mode leaves opinions only; the close dialog's confirm button is `Close now`; the event page now reloads its view whenever its address changes, which the scenarios had worked around with a reload.
- Task 3: the opinions-only fake needs three fillers of its own to clear the three-theme minimum, and none of them states a number; the privacy notice names the pick, the ranking, or only the opinion by mode; the publish dialog names what is deleted by mode; an opinions-only host view carries no `Numbers` heading.
- The report builder refuses a single-choice winner that is not an option with the most votes (ties allowed), so a live model cannot crown the wrong option above the vote chart; the job passes the raw first-choice counts, which are never shown.
- A two-option event names the runner-up once in the cards and in the copy summary, since it is also the last option; the labels follow the mode the report was generated under, not the event's current mode.
- Recorded and left alone: the ranked schema's property list has no pin after the refactor; no unit case pins the single-choice tie-break; the live spot-check script does not exercise the opinions-only schema; the fake computes an order in every mode.
- The final whole-branch review found that the winner check could never pass below five responses, where the counts are withheld from the model: the job now hands the synthesis the order by votes (`voteOrder`, never the counts), the prompt names it, the fake follows it, and `buildReport` holds all three single-choice cards to the votes while only a winner that is not among the leaders fails the answer; a scenario below the threshold and a job test for the opinions-only schema cover both.
