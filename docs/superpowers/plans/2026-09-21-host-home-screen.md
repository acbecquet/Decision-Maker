# Host Home Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in host lands on a home screen at `/` that lists every event they own, with the pending names of each event listed right there with approve and reject controls, so the host switches between events and decides on requests from one place.

**Architecture:** `/api/me` already returns the account's events; it grows the counts and the pending names per event, computed by the existing roster query.
The home screen is one client component rendered by `/` (when the server sees an account session) and by `/me`; it calls the existing approve, reject, and approve-all endpoints, which already accept the account session as host authorisation, and it refreshes itself on a timer while visible.
The create form moves into a component that `/` renders for visitors who are not signed in and that `/new` renders for everyone.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, Drizzle, Vitest, Playwright.

## Global Constraints

- Design spec section 6.7 (added 2026-09-21) is the source of truth for this feature; section 4 lists the pages.
- Privacy holds as before: the home screen shows names and statuses only, never rankings, budgets, or opinions.
- Copy rule: no explanatory prose that states the obvious; labels and counts only.
- No em dashes; commit messages carry no co-author or generated-by lines.
- `npm run lint`, `npm run check`, `npx vitest run`, and `npm run test:e2e` pass before a task is done. Never stop a server with `taskkill //IM node.exe`; stop by PID only.
- Existing behaviour that must survive: an anonymous visitor still creates an event at `/` (covered by `e2e/create.e2e.ts`), the host view is unchanged apart from one link, and `/me` still sends an anonymous visitor to `/signin`.

---

### Task 1: Account events carry counts and pending names

**Files:**
- Modify: `src/lib/shared/types.ts`
- Modify: `src/lib/server/auth.ts`
- Test: `src/lib/server/auth.test.ts`

**Interfaces:**
- Consumes: `listRoster(db, eventId): RosterRow[]` from `src/lib/server/participants.ts` (names, statuses, and the duplicate flag over the whole roster).
- Produces: the `AccountEvent` type in `src/lib/shared/types.ts` and `listAccountEvents(db, accountId): AccountEvent[]` with the new fields, which `/api/me` returns unchanged and Task 2 renders.

- [ ] **Step 1: Move the type to the shared types and extend it**

Remove `AccountEvent` from `src/lib/server/auth.ts` and add it to `src/lib/shared/types.ts` next to `RosterRow`:

```ts
/** One event on the host home screen: counts and the pending names a host decides on, nothing else. */
export type AccountEvent = {
	code: string;
	title: string;
	state: EventState;
	rosterFinal: boolean;
	submittedCount: number;
	pendingCount: number;
	approvedCount: number;
	pending: RosterRow[];
	createdAt: string;
};
```

`src/lib/server/auth.ts` imports it from `$lib/shared/types` and re-exports nothing new; `src/routes/api/me/+server.ts` needs no change.

- [ ] **Step 2: Write the failing test**

Add to the `claiming and listing events` describe block in `src/lib/server/auth.test.ts`, following the existing test's way of creating an account and events (look at how `attaches unowned events whose host token matches and lists them newest first` builds its account, and reuse `createEvent`, `submitResponse`, and `stopSubmissions` from `../events` and `../participants` as the neighbouring tests do):

```ts
it('lists open events first with the counts and the pending names a host decides on', () => {
	const db = openDatabase(':memory:');
	const accountId = /* same construction as the test above */;
	const older = createEvent(db, input, 'a'.repeat(64), accountId, new Date('2026-09-20T10:00:00.000Z'));
	const closed = createEvent(db, input, 'b'.repeat(64), accountId, new Date('2026-09-21T10:00:00.000Z'));
	const newer = createEvent(db, input, 'c'.repeat(64), accountId, new Date('2026-09-22T10:00:00.000Z'));
	const ids = listOptions(db, older.id).map((o) => o.id);
	const answer = (name: string) => ({ name, ranking: [ids[0]], vetoes: [], budget: null, opinion: '', suggestion: '' });
	submitResponse(db, older, ids, '1'.repeat(64), answer('Ana'), { autoApprove: false });
	submitResponse(db, older, ids, '2'.repeat(64), answer('Ben'), { autoApprove: true });
	submitResponse(db, older, ids, '3'.repeat(64), answer('ana'), { autoApprove: false });
	stopSubmissions(db, closed);

	const list = listAccountEvents(db, accountId);

	expect(list.map((e) => e.code)).toEqual([newer.code, older.code, closed.code]);
	expect(list[1]).toMatchObject({
		title: input.title,
		state: 'open',
		rosterFinal: false,
		submittedCount: 3,
		pendingCount: 2,
		approvedCount: 1,
		pending: [
			{ name: 'Ana', status: 'pending', duplicate: true },
			{ name: 'ana', status: 'pending', duplicate: true }
		]
	});
	expect(list[0]).toMatchObject({ submittedCount: 0, pendingCount: 0, approvedCount: 0, pending: [] });
	expect(list[2]).toMatchObject({ state: 'closed' });
});
```

The `input` fixture is whatever that test file already uses for `createEvent`; `submitResponse`'s option ids come from `listOptions`.
If `submitResponse` in this file is called with a different shape, match the neighbouring tests rather than this sketch.

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/lib/server/auth.test.ts`
Expected: FAIL on the missing fields and the order.

- [ ] **Step 4: Implement**

Replace `listAccountEvents` in `src/lib/server/auth.ts`:

```ts
/**
 * The account's events, open ones first and newest first within each group, with the counts
 * and the pending names a host decides on from the home screen.
 */
export function listAccountEvents(db: DbLike, accountId: string): AccountEvent[] {
	const rows = db
		.select({
			id: events.id,
			code: events.code,
			title: events.title,
			state: events.state,
			rosterFinal: events.rosterFinal,
			createdAt: events.createdAt
		})
		.from(events)
		.where(eq(events.accountId, accountId))
		.orderBy(sql`case when ${events.state} = 'open' then 0 else 1 end`, desc(events.createdAt))
		.all();
	return rows.map(({ id, ...row }) => {
		const roster = listRoster(db, id);
		const withStatus = (status: ParticipantStatus) => roster.filter((r) => r.status === status);
		return {
			...row,
			submittedCount: roster.length,
			pendingCount: withStatus('pending').length,
			approvedCount: withStatus('approved').length,
			pending: withStatus('pending')
		};
	});
}
```

Import `listRoster` from `./participants` and `ParticipantStatus` from `$lib/shared/types`; drop the now unused `count` and `participants` imports if nothing else in the file uses them.
`submittedCount` stays the number of participants, which is what the old query counted.

- [ ] **Step 5: Run the tests and the checks**

Run: `npx vitest run src/lib/server/auth.test.ts && npm run check && npm run lint`
Expected: PASS, 0 errors, clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/shared/types.ts src/lib/server/auth.ts src/lib/server/auth.test.ts
git commit -m "List account events open first with their counts and pending names"
```

---

### Task 2: The home screen, the create route, and the links

**Files:**
- Create: `src/lib/components/CreateEvent.svelte`
- Create: `src/lib/components/HomeScreen.svelte`
- Modify: `src/lib/components/Roster.svelte`
- Modify: `src/lib/components/HostView.svelte`
- Create: `src/routes/+page.server.ts`
- Modify: `src/routes/+page.svelte`
- Create: `src/routes/new/+page.svelte`
- Modify: `src/routes/me/+page.svelte`
- Modify: `src/routes/signin/callback/+page.svelte`
- Test: `e2e/home.e2e.ts` (new), `e2e/accounts.e2e.ts`

**Interfaces:**
- Consumes: `GET /api/me` returning `{ email: string; events: AccountEvent[] }` (Task 1); `PATCH /api/events/[code]/participants/[id]` with `{ status: 'approved' | 'rejected' }` and `POST /api/events/[code]/roster/approve-all`, both of which accept the account session as host authorisation; `api(path, { method, body, code })` from `$lib/client/api`; `Roster` with its `onstatus(id, status)` callback.
- Produces: the pages and the component described in spec section 6.7.

- [ ] **Step 1: Write the failing e2e scenario**

Create `e2e/home.e2e.ts`:

```ts
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

	await dinnerCard.getByRole('link', { name: 'Axis dinner' }).click();
	await expect(phone.page).toHaveURL(new RegExp(`/e/${dinner}$`));
	const roster = phone.page.getByTestId('roster');
	await expect(roster.getByRole('listitem').filter({ hasText: 'Ana' })).toContainText('Approved');
	await expect(roster.getByRole('listitem').filter({ hasText: 'Ben' })).toContainText('Rejected');
	await phone.page.getByRole('link', { name: 'My events' }).click();
	await expect(phone.page).toHaveURL(/\/me$/);
	await expect(phone.page.getByTestId(`event-${dinner}`)).toBeVisible();

	await submitApi(request, dinner, token(), { name: 'Finn', ranking: [dinnerIds[0]], opinion: 'Fine.' });
	await phone.page.clock.runFor(15_000);
	await expect(
		phone.page.getByTestId(`event-${dinner}`).getByRole('button', { name: 'Approve Finn' })
	).toBeVisible();

	await phone.page.getByRole('button', { name: 'New event' }).click();
	await expect(phone.page).toHaveURL(/\/new$/);
	await expect(phone.page.getByRole('heading', { name: 'DecisionMaker' })).toBeVisible();
	await phone.context.close();
});
```

Then update `e2e/accounts.e2e.ts`: after `Finish signing in` the URL is `/` and the email and the `my-events` list are read on that page; after `Sign out` the URL is still `/` and the create form heading `DecisionMaker` is visible; the final `goto('/me')` still lands on `/signin`.
Keep every other assertion.

- [ ] **Step 2: Run it to see it fail**

Run: `npx playwright test e2e/home.e2e.ts e2e/accounts.e2e.ts`
Expected: FAIL (no home screen, sign-in lands on `/me`).

- [ ] **Step 3: The create form as a component**

Create `src/lib/components/CreateEvent.svelte` by moving the whole content of today's `src/routes/+page.svelte` into it unchanged (the script with `create` and the `<main>` with the `DecisionMaker` heading, the `EventForm`, and the `My events` link).

Create `src/routes/new/+page.svelte`:

```svelte
<script lang="ts">
	import CreateEvent from '$lib/components/CreateEvent.svelte';
</script>

<CreateEvent />
```

- [ ] **Step 4: The roster without status pills**

In `src/lib/components/Roster.svelte` add a `showStatus` prop, default `true`, and wrap the status pill in `{#if showStatus}`:

```svelte
	let {
		roster,
		readonly,
		onstatus,
		showStatus = true
	}: {
		roster: RosterRow[];
		readonly: boolean;
		onstatus?: (id: string, status: 'approved' | 'rejected') => void;
		showStatus?: boolean;
	} = $props();
```

- [ ] **Step 5: The home screen component**

Create `src/lib/components/HomeScreen.svelte`:

```svelte
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api, ApiError } from '$lib/client/api';
	import type { AccountEvent, EventState } from '$lib/shared/types';
	import Roster from './Roster.svelte';

	/** New requests show up on their own at this cadence while the screen is visible. */
	const REFRESH_MS = 15_000;

	let email = $state('');
	let rows = $state<AccountEvent[] | null>(null);
	let error = $state('');
	const totalPending = $derived(rows?.reduce((n, r) => n + r.pendingCount, 0) ?? 0);

	const pill: Record<EventState, string> = {
		open: 'pill-success',
		closed: 'pill-warn',
		published: ''
	};
	const label: Record<EventState, string> = {
		open: 'Open',
		closed: 'Closed',
		published: 'Published'
	};

	async function refresh() {
		try {
			const me = await api<{ email: string; events: AccountEvent[] }>('/api/me');
			email = me.email;
			rows = me.events;
		} catch (err) {
			if (err instanceof ApiError && err.status === 401) await goto(resolve('/signin'));
			else if (rows === null) error = 'Could not load your events. Check your connection and try again.';
			// A failed background refresh keeps the last good list on screen.
		}
	}

	onMount(() => {
		void refresh();
		const tick = () => {
			if (document.visibilityState === 'visible') void refresh();
		};
		const timer = setInterval(tick, REFRESH_MS);
		document.addEventListener('visibilitychange', tick);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', tick);
		};
	});

	async function act(code: string, path: string, body?: unknown, method: 'POST' | 'PATCH' = 'POST') {
		error = '';
		try {
			await api(path, { method, body, code });
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Something went wrong, try again';
		}
		await refresh();
	}
	const setStatus = (code: string) => (id: string, status: 'approved' | 'rejected') =>
		act(code, `/api/events/${code}/participants/${id}`, { status }, 'PATCH');
	const approveAll = (code: string) => act(code, `/api/events/${code}/roster/approve-all`);

	async function signOut() {
		try {
			await api('/api/auth/signout', { method: 'POST' });
			await goto(resolve('/'), { invalidateAll: true });
		} catch (err) {
			error =
				err instanceof ApiError
					? err.message
					: 'Could not sign out. Check your connection and try again.';
		}
	}
</script>

<svelte:head>
	<title>My events</title>
</svelte:head>

<main>
	<h1>My events</h1>
	{#if email}
		<p class="small muted">{email}</p>
	{/if}
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	{#if rows === null}
		{#if !error}
			<p class="muted">Loading</p>
		{/if}
	{:else if rows.length === 0}
		<p class="muted">No events yet.</p>
	{:else}
		{#if totalPending > 0}
			<p class="notice" data-testid="pending-total">{totalPending} pending</p>
		{/if}
		<ul style="list-style:none;padding:0;margin:0" data-testid="my-events">
			{#each rows as row (row.code)}
				<li class="card" style="margin:8px 0" data-testid={`event-${row.code}`}>
					<a
						href={resolve('/e/[code]', { code: row.code })}
						style="text-decoration:none;color:inherit"
					>
						<strong>{row.title}</strong>
					</a>
					<p style="margin:6px 0 0">
						<span class={`pill ${pill[row.state]}`}>{label[row.state]}</span>
						<span class="muted small" style="margin-left:8px">{row.submittedCount} submitted</span>
						{#if row.pendingCount > 0}
							<span class="muted small" style="margin-left:8px">{row.pendingCount} pending</span>
						{/if}
					</p>
					{#if row.pending.length > 0}
						<div style="margin-top:8px">
							<Roster
								roster={row.pending}
								readonly={false}
								showStatus={false}
								onstatus={setStatus(row.code)}
							/>
							<button
								type="button"
								class="btn-block"
								style="margin-top:8px"
								onclick={() => approveAll(row.code)}
							>
								Approve all pending ({row.pendingCount})
							</button>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
	<div class="actions" style="margin-top:16px">
		<button type="button" class="btn-primary" onclick={() => goto(resolve('/new'))}>New event</button>
		<button type="button" onclick={signOut}>Sign out</button>
	</div>
</main>
```

If `api()`'s options type does not accept `code` together with `method` and `body`, look at `src/lib/client/api.ts` and pass what it accepts; the account session is what authorises these calls, the event tokens are optional.

- [ ] **Step 6: The routes**

Create `src/routes/+page.server.ts`:

```ts
import type { PageServerLoad } from './$types';

/** Whether the visitor has an account session decides which home they get: the home screen or the create form. */
export const load: PageServerLoad = ({ locals }) => ({ signedIn: locals.accountId !== null });
```

Replace `src/routes/+page.svelte` with:

```svelte
<script lang="ts">
	import CreateEvent from '$lib/components/CreateEvent.svelte';
	import HomeScreen from '$lib/components/HomeScreen.svelte';

	let { data } = $props();
</script>

{#if data.signedIn}
	<HomeScreen />
{:else}
	<CreateEvent />
{/if}
```

Replace the content of `src/routes/me/+page.svelte` with:

```svelte
<script lang="ts">
	import HomeScreen from '$lib/components/HomeScreen.svelte';
</script>

<HomeScreen />
```

and keep `src/routes/me/+page.ts` as it is (`ssr = false`).

In `src/routes/signin/callback/+page.svelte` change the success redirect from `resolve('/me')` to `resolve('/')`.

Check `src/app.d.ts` for the type of `locals.accountId`; if it is `string | null` the comparison above is right, if it is optional use `Boolean(locals.accountId)`.

- [ ] **Step 7: The link back from the event page**

At the very top of the markup in `src/lib/components/HostView.svelte`, before the first existing element, add:

```svelte
<p class="small" style="margin:0 0 8px"><a href={resolve('/me')}>My events</a></p>
```

`resolve` is already imported there.
It links to `/me` rather than `/`, because `/` shows the create form to a host who is not signed in, while `/me` sends them to sign in.

- [ ] **Step 8: Run the scenario, then everything**

Run: `npx playwright test e2e/home.e2e.ts e2e/accounts.e2e.ts e2e/create.e2e.ts`
Expected: PASS.
If `page.clock.runFor` does not fire the interval, install the clock after the sign-in navigation and before `goto('/me')` instead, and note it in the report.

Run: `npm run lint && npm run check && npx vitest run && npm run test:e2e`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add src/lib/components/CreateEvent.svelte src/lib/components/HomeScreen.svelte src/lib/components/Roster.svelte src/lib/components/HostView.svelte src/routes/+page.server.ts src/routes/+page.svelte src/routes/new/+page.svelte src/routes/me/+page.svelte src/routes/signin/callback/+page.svelte e2e/home.e2e.ts e2e/accounts.e2e.ts
git commit -m "Give a signed-in host a home screen that decides on names across events"
```

## Deviations after review

The task reviews changed the code in these ways, and the code is the source of truth over the steps above.

- The Task 1 test pins the duplicate flag across statuses: a pending `Ana` next to an approved `ana`, so a pending-only query could not slip in unnoticed.
- `refresh()` in the home screen clears the error on success, drops any response older than the newest request, and does nothing once the screen is unmounting or signing out, so a background tick can neither paint a stale list over a fresh decision nor redirect to sign-in in the middle of signing out.
- The home page sends `cache-control: private, no-store`, since its HTML differs by session.
- The card title takes the link colour so it reads as the way into the event.
- Recorded and left alone: the home screen renders "Loading" on the server before its first fetch; errors show at the top of the page rather than beside the control; a decision has no busy state (the endpoints are idempotent); every card's pending list shares the `roster` test id and tests scope by card; `AccountEvent.rosterFinal` is carried but not read.
