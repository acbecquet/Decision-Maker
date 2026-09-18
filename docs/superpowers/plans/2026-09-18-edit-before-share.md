# Edit Before Share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the host edit an event from the link screen or the host view until the first submission arrives, where saving replaces the details and options, rotates the event code so the old link dies, and shows the new link.

**Architecture:** One new repository function `updateEvent` does the whole edit inside a transaction with a live-row guard, exposed as `PUT /api/events/{code}` for the host.
The create form moves into a shared `EventForm` component used by the home page and by a new client-only route `/e/{code}/edit`, which re-keys the host token to the new code and lands on the link screen.

**Tech Stack:** SvelteKit 2 with Svelte 5 runes, TypeScript, Drizzle ORM on better-sqlite3, zod 4, Vitest, Playwright.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-09-17-decision-maker-design.md`, sections 6.1 and 6.2 (edit until the first submission, code rotation) and 14.5 (twenty event creations or edits per hour per IP).
- Editing is allowed only while `state === 'open'` and no participant row exists for the event. The server guard re-reads the live event row and counts participants inside the same transaction that writes the edit.
- Saving generates a new event code with `newEventCode()`; the old code must return 404 afterwards. The event id and `hostTokenHash` never change.
- Tokens travel in the `x-host-token` header only, never in URLs or bodies.
- The edit endpoint shares the creation rate-limit bucket: `enforce(\`create:${ip}\`, 20, 3_600_000)`.
- Copy rule: no explanatory prose that states the obvious. Labels and button text over paragraphs. The one sentence allowed on the edit page is "Saving makes a new link. The old one stops working."
- Navigation uses `goto(resolve('/e/[code]', { code }))` from `$app/navigation` and `$app/paths` (eslint rule `svelte/no-navigation-without-resolve`).
- Seed `$state` from props through `untrack` to avoid `state_referenced_locally` warnings.
- `npm run lint` (prettier + eslint), `npm run check` (svelte-check), `npx vitest run`, and `npm run test:e2e` must all pass before a task is done. The e2e server sets `RATE_LIMIT_SCALE=10`.
- Never stop a dev or test server with `taskkill //IM node.exe`; stop by PID only.
- No em dashes anywhere. Commit messages carry no co-author or generated-by lines.

---

### Task 1: `updateEvent` and `PUT /api/events/{code}`

**Files:**
- Modify: `src/lib/server/events.ts`
- Modify: `src/routes/api/events/[code]/+server.ts`
- Test: `src/lib/server/events.test.ts`
- Test: `e2e/api.e2e.ts`

**Interfaces:**
- Consumes: `getEventById`, `newEventCode`, `newId`, `toIso`, `conflict` (all existing), `participants` and `options` tables from `./db/schema`, `count` from `drizzle-orm`.
- Produces: `updateEvent(db: Db, event: EventRow, input: CreateEventInput): EventRow` and the route `PUT /api/events/{code}` which returns `{ code: string }` with status 200.

- [ ] **Step 1: Write the failing unit tests**

Append to `src/lib/server/events.test.ts`. Add `updateEvent` to the existing import from `./events` and add `import { submitResponse } from './participants';`.

```ts
describe('updateEvent', () => {
	const edit = {
		title: 'Sunday brunch',
		context: 'Late start',
		currency: 'USD' as const,
		options: [
			{ label: 'Cafe', note: '', cost: 12 },
			{ label: 'Market', note: 'Outdoor', cost: null }
		],
		closesAt: null
	};

	it('replaces the details and options and rotates the code, keeping the id and host', () => {
		const db = openDatabase(':memory:');
		const event = createEvent(db, input, hash);
		const updated = updateEvent(db, event, edit);
		expect(updated.id).toBe(event.id);
		expect(updated.code).not.toBe(event.code);
		expect(updated.code).toMatch(/^[0-9a-hj-kmnp-tv-z]{10}$/);
		expect(updated.hostTokenHash).toBe(hash);
		expect(updated).toMatchObject({
			title: 'Sunday brunch',
			context: 'Late start',
			currency: 'USD',
			state: 'open',
			closesAt: null
		});
		expect(findEventByCode(db, event.code)).toBeUndefined();
		expect(findEventByCode(db, updated.code)?.id).toBe(event.id);
		expect(
			listOptions(db, event.id).map((o) => [o.position, o.label, o.note, o.costPerPerson])
		).toEqual([
			[0, 'Cafe', '', 12],
			[1, 'Market', 'Outdoor', null]
		]);
	});

	it('stores the auto-close time as a UTC instant', () => {
		const db = openDatabase(':memory:');
		const event = createEvent(db, input, hash);
		const updated = updateEvent(db, event, { ...edit, closesAt: '2030-01-01T10:00:00+02:00' });
		expect(updated.closesAt).toBe('2030-01-01T08:00:00.000Z');
	});

	it('refuses once anyone has submitted, even from a stale snapshot', () => {
		const db = openDatabase(':memory:');
		const event = createEvent(db, input, hash);
		const ids = listOptions(db, event.id).map((o) => o.id);
		submitResponse(
			db,
			event,
			ids,
			'b'.repeat(64),
			{ name: 'Ana', ranking: [ids[0]], vetoes: [], budget: null, opinion: '', suggestion: '' },
			{ autoApprove: false }
		);
		expect(() => updateEvent(db, event, edit)).toThrow(/already submitted/);
		expect(findEventByCode(db, event.code)?.title).toBe('Saturday night');
		expect(listOptions(db, event.id)).toHaveLength(2);
	});

	it('refuses after submissions have stopped', () => {
		const db = openDatabase(':memory:');
		const event = createEvent(db, input, hash);
		stopSubmissions(db, event);
		expect(() => updateEvent(db, event, edit)).toThrow(/closed/);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/server/events.test.ts`
Expected: FAIL because `updateEvent` is not exported.

- [ ] **Step 3: Implement `updateEvent`**

In `src/lib/server/events.ts`, change the drizzle import to `import { and, asc, count, eq, lte } from 'drizzle-orm';` and the schema import to `import { events, options, participants, type EventRow, type OptionRow } from './db/schema';`.
Add after `createEvent`:

```ts
/**
 * Replaces the event's details and options and rotates its code, so the old link stops working.
 * Allowed only while the event is open and nobody has submitted.
 * The guard reads the live row inside the transaction, so a submission that lands during body
 * parsing is honoured, and the host token hash is untouched so the creating device stays the host.
 */
export function updateEvent(db: Db, event: EventRow, input: CreateEventInput): EventRow {
	return db.transaction((tx) => {
		const current = getEventById(tx, event.id);
		if (current.state !== 'open') throw conflict('Submissions are closed');
		const submitted =
			tx
				.select({ n: count() })
				.from(participants)
				.where(eq(participants.eventId, current.id))
				.get()?.n ?? 0;
		if (submitted > 0) throw conflict('Someone has already submitted, so the event cannot change');
		tx.delete(options).where(eq(options.eventId, current.id)).run();
		tx.insert(options)
			.values(
				input.options.map((o, position) => ({
					id: newId(),
					eventId: current.id,
					position,
					label: o.label,
					note: o.note,
					costPerPerson: o.cost
				}))
			)
			.run();
		tx.update(events)
			.set({
				code: newEventCode(),
				title: input.title,
				context: input.context,
				currency: input.currency,
				closesAt: input.closesAt ? toIso(input.closesAt) : null
			})
			.where(eq(events.id, current.id))
			.run();
		return getEventById(tx, current.id);
	});
}
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `npx vitest run src/lib/server/events.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Write the failing API test**

Append inside the `test.describe('events API', ...)` block of `e2e/api.e2e.ts`:

```ts
	test('the host can edit the event until the first submission, which rotates the link', async ({
		request
	}) => {
		const hostToken = token();
		const code = await createEventApi(request, hostToken);
		const body = {
			title: 'Sunday brunch',
			context: '',
			currency: 'USD',
			options: [
				{ label: 'Cafe', note: '', cost: 12 },
				{ label: 'Market', note: '', cost: null }
			],
			closesAt: null
		};

		const stranger = await request.put(`/api/events/${code}`, { data: body });
		expect(stranger.status()).toBe(403);

		const edited = await request.put(`/api/events/${code}`, {
			headers: { 'x-host-token': hostToken },
			data: body
		});
		expect(edited.status()).toBe(200);
		const { code: next } = (await edited.json()) as { code: string };
		expect(next).toMatch(/^[0-9a-hj-kmnp-tv-z]{10}$/);
		expect(next).not.toBe(code);
		expect((await request.get(`/api/events/${code}`)).status()).toBe(404);

		const view = await viewApi(request, next, { 'x-host-token': hostToken });
		expect(view.status).toBe(200);
		expect(view.body.role).toBe('host');
		expect(view.body.event.title).toBe('Sunday brunch');
		expect(view.body.event.currency).toBe('USD');
		expect((view.body.event.options as { label: string }[]).map((o) => o.label)).toEqual([
			'Cafe',
			'Market'
		]);

		const ids = await optionIds(request, next);
		const submitted = await submitApi(request, next, token(), { name: 'Ana', ranking: [ids[0]] });
		expect(submitted.status()).toBe(201);
		const locked = await request.put(`/api/events/${next}`, {
			headers: { 'x-host-token': hostToken },
			data: body
		});
		expect(locked.status()).toBe(409);
		expect((await locked.json()).message).toMatch(/already submitted/);
	});
```

- [ ] **Step 6: Implement the route**

In `src/routes/api/events/[code]/+server.ts`, add the imports `import { setClosesAt, updateEvent } from '$lib/server/events';` (replacing the existing `setClosesAt` import line), `import { enforce } from '$lib/server/ratelimit';`, and `import { createEventInput, patchEventInput } from '$lib/shared/validation';` (replacing the existing validation import). Then add:

```ts
/** Edits the whole event and rotates its code. Only while open and before the first submission. */
export const PUT: RequestHandler = async ({ params, request, getClientAddress }) => {
	try {
		enforce(`create:${getClientAddress()}`, 20, 3_600_000);
		const db = getDb();
		const event = loadEventOr404(db, params.code);
		requireHost(event, request);
		const input = await readJson(request, createEventInput);
		if (input.closesAt && Date.parse(input.closesAt) <= Date.now()) {
			throw badRequest('The auto-close time has to be in the future');
		}
		const updated = updateEvent(db, event, input);
		return json({ code: updated.code });
	} catch (e) {
		raise(e);
	}
};
```

- [ ] **Step 7: Run lint, check, unit tests, and the API e2e file**

Run: `npm run lint && npm run check && npx vitest run && npx playwright test e2e/api.e2e.ts`
Expected: all green. The e2e command builds the app and starts the server on port 4173 by itself.

- [ ] **Step 8: Commit**

```bash
git add src/lib/server/events.ts src/lib/server/events.test.ts "src/routes/api/events/[code]/+server.ts" e2e/api.e2e.ts
git commit -m "Let the host edit an event until the first submission, rotating its code"
```

---

### Task 2: Edit page, shared form, and entry points

**Files:**
- Create: `src/lib/components/EventForm.svelte`
- Create: `src/lib/client/datetime.ts`
- Create: `src/routes/e/[code]/edit/+page.ts`
- Create: `src/routes/e/[code]/edit/+page.svelte`
- Modify: `src/routes/+page.svelte`
- Modify: `src/lib/client/tokens.ts`
- Modify: `src/lib/components/LinkScreen.svelte`
- Modify: `src/lib/components/HostView.svelte`
- Modify: `src/app.css`
- Test: `src/lib/client/tokens.test.ts`
- Test: `e2e/create.e2e.ts`

**Interfaces:**
- Consumes: `PUT /api/events/{code}` from Task 1 returning `{ code }`; `api()` and `ApiError` from `$lib/client/api`; `EventPageView` and `EventView` from `$lib/shared/types`; `createEventInput` and `CreateEventInput` from `$lib/shared/validation`.
- Produces: `EventForm` component with props `{ initial?: EventView | null; submitLabel: string; busyLabel: string; oncancel?: () => void; onsubmit: (input: CreateEventInput) => Promise<void> }`; `moveToken(from, to, role)` in `$lib/client/tokens`; `toLocalInput(iso)` in `$lib/client/datetime`.

- [ ] **Step 1: Write the failing token test**

Add `moveToken` to the import in `src/lib/client/tokens.test.ts` and append inside the describe block:

```ts
	it('moveToken re-keys a token to the new code and clears the old one', () => {
		setToken('old', 'host', 'h'.repeat(64));
		moveToken('old', 'new', 'host');
		expect(getToken('new', 'host')).toBe('h'.repeat(64));
		expect(getToken('old', 'host')).toBeNull();
		moveToken('none', 'other', 'host');
		expect(getToken('other', 'host')).toBeNull();
	});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/client/tokens.test.ts`
Expected: FAIL because `moveToken` is not exported.

- [ ] **Step 3: Add `moveToken` and the datetime helper**

Append to `src/lib/client/tokens.ts`:

```ts
/** Re-keys a token when an event's code changes, so the device keeps its role under the new link. */
export function moveToken(from: string, to: string, role: TokenRole): void {
	const token = getToken(from, role);
	if (!token) return;
	setToken(to, role, token);
	try {
		localStorage.removeItem(key(from, role));
	} catch {
		// Nothing to clean up when storage is unavailable.
	}
}
```

Create `src/lib/client/datetime.ts`:

```ts
/** ISO instant to the local wall-clock format a datetime-local input expects, or '' for null. */
export function toLocalInput(iso: string | null): string {
	if (!iso) return '';
	const d = new Date(iso);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
```

In `src/lib/components/HostView.svelte`, delete the local `toLocal` function, add `import { toLocalInput } from '$lib/client/datetime';`, and change the seed line to `let closesLocal = $state(untrack(() => toLocalInput(view.event.closesAt)));`.

- [ ] **Step 4: Run the token test to verify it passes**

Run: `npx vitest run src/lib/client/tokens.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the shared form component**

Create `src/lib/components/EventForm.svelte`. The markup is the current form from `src/routes/+page.svelte` with the state seeded from `initial` and the submit handled by the `onsubmit` prop.

```svelte
<script lang="ts">
	import { untrack } from 'svelte';
	import { ApiError } from '$lib/client/api';
	import { toLocalInput } from '$lib/client/datetime';
	import { CURRENCIES, LIMITS, type Currency } from '$lib/shared/constants';
	import type { EventView } from '$lib/shared/types';
	import { createEventInput, type CreateEventInput } from '$lib/shared/validation';

	let {
		initial = null,
		submitLabel,
		busyLabel,
		oncancel,
		onsubmit
	}: {
		initial?: EventView | null;
		submitLabel: string;
		busyLabel: string;
		oncancel?: () => void;
		onsubmit: (input: CreateEventInput) => Promise<void>;
	} = $props();

	type OptionDraft = { id: string; label: string; note: string; cost: string };
	const blank = (): OptionDraft => ({ id: crypto.randomUUID(), label: '', note: '', cost: '' });
	const seed = untrack(() => initial);

	let title = $state(seed?.title ?? '');
	let context = $state(seed?.context ?? '');
	let currency = $state<Currency>((seed?.currency as Currency | undefined) ?? 'EUR');
	let options = $state<OptionDraft[]>(
		seed
			? seed.options.map((o) => ({
					id: crypto.randomUUID(),
					label: o.label,
					note: o.note,
					cost: o.cost === null ? '' : String(o.cost)
				}))
			: [blank(), blank()]
	);
	let closesAtLocal = $state(toLocalInput(seed?.closesAt ?? null));
	let error = $state('');
	let busy = $state(false);

	function addOption() {
		if (options.length < LIMITS.maxOptions) options.push(blank());
	}

	function removeOption(index: number) {
		if (options.length > LIMITS.minOptions) options.splice(index, 1);
	}

	function payload() {
		return {
			title,
			context,
			currency,
			options: options.map((o) => ({
				label: o.label,
				note: o.note,
				cost: o.cost.trim() === '' ? null : Number(o.cost)
			})),
			closesAt: closesAtLocal ? new Date(closesAtLocal).toISOString() : null
		};
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		if (options.some((o) => o.cost.trim() !== '' && Number.isNaN(Number(o.cost)))) {
			error = 'Cost has to be a number';
			return;
		}
		const parsed = createEventInput.safeParse(payload());
		if (!parsed.success) {
			error = parsed.error.issues[0]?.message ?? 'Check the form';
			return;
		}
		if (parsed.data.closesAt && Date.parse(parsed.data.closesAt) <= Date.now()) {
			error = 'The auto-close time has to be in the future';
			return;
		}
		busy = true;
		try {
			await onsubmit(parsed.data);
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Something went wrong, try again';
		} finally {
			busy = false;
		}
	}
</script>

<form onsubmit={submit} novalidate>
	<label for="title">What are you deciding?</label>
	<input
		id="title"
		bind:value={title}
		maxlength={LIMITS.title}
		placeholder="Saturday night in Barcelona"
	/>

	<label for="context">Context <span class="muted">optional</span></label>
	<input
		id="context"
		bind:value={context}
		maxlength={LIMITS.context}
		placeholder="Dinner plans for the group, budget around 30 euros"
	/>

	<label for="currency">Currency</label>
	<select id="currency" bind:value={currency}>
		{#each CURRENCIES as c (c)}
			<option value={c}>{c}</option>
		{/each}
	</select>

	<h2>Options</h2>
	{#each options as option, i (option.id)}
		<div class="card">
			<label for={`label-${option.id}`}>Option {i + 1}</label>
			<input
				id={`label-${option.id}`}
				bind:value={option.label}
				maxlength={LIMITS.optionLabel}
				placeholder="Tapas crawl in El Born"
			/>
			<label for={`note-${option.id}`}>Note <span class="muted">optional</span></label>
			<input
				id={`note-${option.id}`}
				bind:value={option.note}
				maxlength={LIMITS.optionNote}
				placeholder="Central, easy to split into tables"
			/>
			<label for={`cost-${option.id}`}>Cost per person <span class="muted">optional</span></label>
			<input
				id={`cost-${option.id}`}
				bind:value={option.cost}
				inputmode="decimal"
				placeholder="25"
			/>
			{#if options.length > LIMITS.minOptions}
				<button
					type="button"
					class="btn-danger"
					style="margin-top:10px"
					onclick={() => removeOption(i)}>Remove option</button
				>
			{/if}
		</div>
	{/each}
	{#if options.length < LIMITS.maxOptions}
		<button type="button" onclick={addOption}>Add option</button>
	{/if}

	<label for="closes">Auto-close submissions at <span class="muted">optional</span></label>
	<input id="closes" type="datetime-local" bind:value={closesAtLocal} />

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	<div class="actions" style="margin-top:16px">
		{#if oncancel}
			<button type="button" onclick={oncancel} disabled={busy}>Cancel</button>
		{/if}
		<button type="submit" class="btn-primary" disabled={busy}>
			{busy ? busyLabel : submitLabel}
		</button>
	</div>
</form>
```

Replace the whole of `src/routes/+page.svelte` with:

```svelte
<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api } from '$lib/client/api';
	import { newToken, setToken } from '$lib/client/tokens';
	import EventForm from '$lib/components/EventForm.svelte';
	import type { CreateEventInput } from '$lib/shared/validation';

	async function create(input: CreateEventInput) {
		const hostToken = newToken();
		const { code } = await api<{ code: string }>('/api/events', {
			method: 'POST',
			body: input,
			headers: { 'x-host-token': hostToken }
		});
		setToken(code, 'host', hostToken);
		await goto(resolve('/e/[code]?created=1', { code }));
	}
</script>

<main>
	<h1>DecisionMaker</h1>
	<EventForm submitLabel="Create event" busyLabel="Creating" onsubmit={create} />
</main>
```

- [ ] **Step 6: Create the edit route**

Create `src/routes/e/[code]/edit/+page.ts`:

```ts
// Roles come from browser storage, which the server cannot see, so this page renders on the client only.
export const ssr = false;
```

Create `src/routes/e/[code]/edit/+page.svelte`:

```svelte
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { api, ApiError } from '$lib/client/api';
	import { moveToken } from '$lib/client/tokens';
	import EventForm from '$lib/components/EventForm.svelte';
	import type { EventPageView } from '$lib/shared/types';
	import type { CreateEventInput } from '$lib/shared/validation';

	const code = $derived(page.params.code ?? '');
	const fromLink = $derived(page.url.searchParams.get('from') === 'link');
	let view = $state<EventPageView | null>(null);
	let error = $state('');

	const back = () => goto(resolve(fromLink ? '/e/[code]?created=1' : '/e/[code]', { code }));

	onMount(async () => {
		try {
			const loaded = await api<EventPageView>(`/api/events/${code}`, { code });
			const editable =
				loaded.role === 'host' &&
				loaded.event.state === 'open' &&
				loaded.host?.submittedCount === 0;
			if (!editable) {
				await goto(resolve('/e/[code]', { code }));
				return;
			}
			view = loaded;
		} catch (err) {
			error =
				err instanceof ApiError && err.status === 404
					? 'This event does not exist.'
					: 'Could not load the event. Check your connection and try again.';
		}
	});

	async function save(input: CreateEventInput) {
		const { code: next } = await api<{ code: string }>(`/api/events/${code}`, {
			method: 'PUT',
			body: input,
			code
		});
		moveToken(code, next, 'host');
		await goto(resolve('/e/[code]?created=1', { code: next }));
	}
</script>

<svelte:head>
	<title>Edit event</title>
</svelte:head>

<main>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{:else if !view}
		<p class="muted">Loading</p>
	{:else}
		<h1>Edit event</h1>
		<p class="small muted">Saving makes a new link. The old one stops working.</p>
		<EventForm
			initial={view.event}
			submitLabel="Save"
			busyLabel="Saving"
			oncancel={back}
			onsubmit={save}
		/>
	{/if}
</main>
```

- [ ] **Step 7: Add the entry points and the button style**

In `src/lib/components/LinkScreen.svelte`, insert before `<h1>Your event is ready</h1>`:

```svelte
<button
	type="button"
	class="link-btn"
	onclick={() => goto(resolve('/e/[code]/edit?from=link', { code }))}
>
	← Edit event
</button>
```

In `src/lib/components/HostView.svelte`, add `import { goto } from '$app/navigation';` and `import { resolve } from '$app/paths';`, and directly after `<LinkCard {code} />` inside the `{#if host && event.state === 'open'}` block insert:

```svelte
	{#if host.submittedCount === 0}
		<button
			type="button"
			class="btn-block"
			onclick={() => goto(resolve('/e/[code]/edit', { code }))}
		>
			Edit event
		</button>
	{/if}
```

Append to `src/app.css`:

```css
.link-btn {
	background: none;
	border: none;
	padding: 0;
	min-height: 0;
	color: var(--accent);
	font-weight: 600;
	margin-bottom: 12px;
}
```

- [ ] **Step 8: Write the end-to-end test**

Append to `e2e/create.e2e.ts` inside the describe block, and extend the helpers import to `import { newDevice, submitViaUi } from './helpers';`:

```ts
	test('editing from the link screen replaces the options and rotates the link', async ({
		page,
		browser
	}) => {
		await page.goto('/');
		await page.getByLabel('What are you deciding?').fill('Lunch');
		await page.getByLabel('Option 1').fill('A');
		await page.getByLabel('Option 2').fill('B');
		await page.getByRole('button', { name: 'Create event' }).click();
		await expect(page).toHaveURL(/\?created=1$/);
		const first = new URL(page.url()).pathname.split('/').pop() as string;

		await page.getByRole('button', { name: 'Edit event' }).click();
		await expect(page).toHaveURL(new RegExp(`/e/${first}/edit`));
		await expect(page.getByLabel('What are you deciding?')).toHaveValue('Lunch');
		await expect(page.getByLabel('Option 2')).toHaveValue('B');
		await page.getByLabel('What are you deciding?').fill('Late lunch');
		await page.getByLabel('Option 2').fill('Beach');
		await page.getByRole('button', { name: 'Add option' }).click();
		await page.getByLabel('Option 3').fill('Cafe');
		await page.getByRole('button', { name: 'Save' }).click();

		await expect(page).toHaveURL(/\?created=1$/);
		const second = new URL(page.url()).pathname.split('/').pop() as string;
		expect(second).not.toBe(first);
		await expect(page.getByRole('heading', { name: 'Your event is ready' })).toBeVisible();
		await expect(page.getByLabel('Share this link')).toHaveValue(new RegExp(`/e/${second}$`));
		await page.getByRole('button', { name: 'Continue to host view' }).click();
		await expect(page.getByRole('heading', { name: 'Late lunch' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Edit event' })).toBeVisible();

		const old = await newDevice(browser);
		await old.page.goto(`/e/${first}`);
		await expect(old.page.getByText('This event does not exist.')).toBeVisible();
		await old.context.close();

		await submitViaUi(browser, second, { name: 'Ana', rank: ['Cafe'] });
		await page.reload();
		await expect(page.getByText('1 submitted')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Edit event' })).toHaveCount(0);

		await page.goto(`/e/${second}/edit`);
		await expect(page).toHaveURL(new RegExp(`/e/${second}$`));
	});
```

- [ ] **Step 9: Run everything**

Run: `npm run lint && npm run check && npx vitest run && npm run test:e2e`
Expected: all green, including the existing create, host, participant, story, and suppression scenarios.

- [ ] **Step 10: Commit**

```bash
git add src/lib/components/EventForm.svelte src/lib/client/datetime.ts "src/routes/e/[code]/edit/+page.ts" "src/routes/e/[code]/edit/+page.svelte" src/routes/+page.svelte src/lib/client/tokens.ts src/lib/client/tokens.test.ts src/lib/components/LinkScreen.svelte src/lib/components/HostView.svelte src/app.css e2e/create.e2e.ts
git commit -m "Add the edit page with a back arrow on the link screen and an edit button in the host view"
```
