# Link Carries The Title Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The link a host shares reads `/e/<code>/<title-as-slug>` and, when pasted into a messenger, unfurls with the event title, so people see what they are deciding on before they open it, while every existing `/e/<code>` link keeps working unchanged.

**Architecture:** The event route gains an optional trailing segment that the server ignores; a small shared `slugify` builds the segment from the title for the share card only.
The event page becomes server-rendered for its shell so its HTML carries the document title, the Open Graph title, and the canonical URL from a server load that reads only the event title by code; the interactive view still loads on the client with the visitor's tokens, exactly as today.

**Tech Stack:** SvelteKit 2 (optional route parameters, `+page.server.ts`), Svelte 5, Vitest, Playwright.

## Global Constraints

- Design spec section 6.8 (added 2026-09-21) is the source of truth; section 4 lists the pages.
- Nothing may break an existing link: `/e/<code>` resolves as before, there is no redirect, tokens in browser storage are untouched, and a wrong or stale slug is ignored. The live event `dcyh44h2fb` is in use while this ships.
- The preview is the title alone: no description, no image, no site name; a code that matches no event carries no Open Graph tags and the document title `DecisionMaker`.
- Privacy holds: the server load reads only the event title; the page never renders roster or answers on the server.
- Copy rule: no explanatory prose that states the obvious.
- No em dashes; commit messages carry no co-author or generated-by lines.
- `npm run lint`, `npm run check`, `npx vitest run`, and `npm run test:e2e` pass before the task is done. Never stop a server with `taskkill //IM node.exe`; stop by PID only.

---

### Task 1: The slug in the link and the title in the page's HTML

**Files:**
- Create: `src/lib/shared/slug.ts`
- Create: `src/lib/shared/slug.test.ts`
- Move: `src/routes/e/[code]/+page.svelte` to `src/routes/e/[code]/[[slug]]/+page.svelte` (with `git mv`)
- Delete: `src/routes/e/[code]/+page.ts`
- Create: `src/routes/e/[code]/[[slug]]/+page.server.ts`
- Modify: `src/lib/components/LinkCard.svelte`
- Modify: every `resolve('/e/[code]...')` call site listed in Step 4
- Test: `e2e/preview.e2e.ts` (new), `e2e/create.e2e.ts`

**Interfaces:**
- Consumes: `findEventByCode(db, code): EventRow | undefined` from `src/lib/server/events.ts`; `getDb()` from `src/lib/server/db`; `page.params.code` in the page.
- Produces: `slugify(title: string): string` in `src/lib/shared/slug.ts`; page data `{ preview: { title: string; url: string } | null }` for the event page.

- [ ] **Step 1: Write the failing unit test**

Create `src/lib/shared/slug.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { slugify } from './slug';

describe('slugify', () => {
	it('lowercases, drops accents, and joins words with single hyphens', () => {
		expect(slugify('Axis Powers Themed Dinner Date + Dishes')).toBe(
			'axis-powers-themed-dinner-date-dishes'
		);
		expect(slugify('  Café  Central!  ')).toBe('cafe-central');
	});

	it('cuts long titles at 60 characters without a dangling hyphen', () => {
		const slug = slugify('word '.repeat(30));
		expect(slug.length).toBeLessThanOrEqual(60);
		expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
	});

	it('gives nothing for a title with no letters or digits it can keep', () => {
		expect(slugify('日本語')).toBe('');
		expect(slugify('---')).toBe('');
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/shared/slug.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the slug**

Create `src/lib/shared/slug.ts`:

```ts
/**
 * The readable segment a shared link carries after the code: the title lowercased, accents
 * stripped, anything but letters and digits collapsed to single hyphens, cut at 60 characters.
 * The server never reads it; the code alone identifies the event.
 */
export function slugify(title: string): string {
	return title
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60)
		.replace(/-+$/, '');
}
```

Run: `npx vitest run src/lib/shared/slug.test.ts`
Expected: PASS.

- [ ] **Step 4: The optional segment on the event route**

Move the page with `git mv src/routes/e/[code]/+page.svelte src/routes/e/[code]/[[slug]]/+page.svelte` and delete `src/routes/e/[code]/+page.ts` (the file that set `ssr = false`); the edit route under `src/routes/e/[code]/edit/` stays where it is and keeps its own `+page.ts`.

The route id changes from `/e/[code]` to `/e/[code]/[[slug]]`, so update every `resolve('/e/[code]', { code })` and `resolve('/e/[code]?created=1', { code })` call to `resolve('/e/[code]/[[slug]]', { code })` and `resolve('/e/[code]/[[slug]]?created=1', { code })`, leaving the slug out so internal navigation stays `/e/<code>`:

- `src/lib/components/CreateEvent.svelte`
- `src/lib/components/HomeScreen.svelte`
- `src/lib/components/LinkScreen.svelte` (the "Continue to host view" button only; the edit link keeps `/e/[code]/edit?from=link`)
- `src/routes/auth/openrouter/callback/+page.svelte` (two calls)
- `src/routes/e/[code]/edit/+page.svelte` (three calls)

If `npm run check` rejects the omitted optional parameter, pass `slug: undefined` explicitly; whatever satisfies the generated types with the rendered path staying `/e/<code>`.

- [ ] **Step 5: The title in the HTML**

Create `src/routes/e/[code]/[[slug]]/+page.server.ts`:

```ts
import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { findEventByCode } from '$lib/server/events';
import { slugify } from '$lib/shared/slug';

/**
 * The title alone, for the tab and for the card a messenger renders from the link. Who the
 * visitor is still comes from browser storage on the client, so nothing else is rendered here.
 */
export const load: PageServerLoad = ({ params, url }) => {
	const event = findEventByCode(getDb(), params.code);
	if (!event) return { preview: null };
	const slug = slugify(event.title);
	return {
		preview: {
			title: event.title,
			url: `${url.origin}/e/${event.code}${slug ? `/${slug}` : ''}`
		}
	};
};
```

In the moved `+page.svelte`, take the data prop and render the head from it:

```svelte
	let { data } = $props();
```

```svelte
<svelte:head>
	<title>{view?.event.title ?? data.preview?.title ?? 'DecisionMaker'}</title>
	{#if data.preview}
		<meta property="og:type" content="website" />
		<meta property="og:title" content={data.preview.title} />
		<meta property="og:url" content={data.preview.url} />
	{/if}
</svelte:head>
```

Everything else in the page stays as it is; `onMount(load)` still fetches the view with the visitor's tokens, and the server renders only the "Loading" state around the head.

- [ ] **Step 6: The share card**

In `src/lib/components/LinkCard.svelte` import `slugify` from `$lib/shared/slug` and build the URL with the segment:

```ts
	const slug = $derived(slugify(title));
	const url = $derived(`${location.origin}/e/${code}${slug ? `/${slug}` : ''}`);
```

- [ ] **Step 7: The e2e scenarios**

Update `e2e/create.e2e.ts`: the two share-link assertions become `new RegExp(\`/e/${code}/saturday-night-in-barcelona$\`)` and `new RegExp(\`/e/${second}/late-lunch$\`)`; the URL assertions on the page itself stay `/e/<code>$` because internal navigation carries no slug.

Create `e2e/preview.e2e.ts`:

```ts
import { expect, test } from '@playwright/test';
import { createEventApi, newDevice, token } from './helpers';

test('the shared link carries the title and unfurls with it, and the bare link still works', async ({
	browser,
	request
}) => {
	const code = await createEventApi(request, token(), { title: 'Fall of the Axis dinner' });
	const slug = 'fall-of-the-axis-dinner';

	for (const path of [`/e/${code}/${slug}`, `/e/${code}`, `/e/${code}/some-stale-slug`]) {
		const res = await request.get(path);
		expect(res.status()).toBe(200);
		const html = await res.text();
		expect(html).toContain('<title>Fall of the Axis dinner</title>');
		expect(html).toContain('<meta property="og:title" content="Fall of the Axis dinner"');
		expect(html).toContain(
			\`<meta property="og:url" content="${test.info().project.use.baseURL}/e/${code}/${slug}"\`
		);
		expect(html).not.toContain('og:description');
	}

	const missing = await request.get('/e/nosuchcode1/whatever');
	expect(missing.status()).toBe(200);
	const missingHtml = await missing.text();
	expect(missingHtml).toContain('<title>DecisionMaker</title>');
	expect(missingHtml).not.toContain('og:title');

	const phone = await newDevice(browser);
	await phone.page.goto(\`/e/${code}/${slug}\`);
	await expect(phone.page.getByRole('heading', { name: 'Fall of the Axis dinner' })).toBeVisible();
	await expect(phone.page.getByLabel('Your name')).toBeVisible();
	await phone.context.close();
});
```

If the participant form's name field is labelled differently, use the label `e2e/helpers.ts`'s `submitViaUi` fills; the point is that the page at the slug URL is the working participant page.

- [ ] **Step 8: Run everything**

Run: `npx playwright test e2e/preview.e2e.ts e2e/create.e2e.ts`
Expected: PASS.

Run: `npm run lint && npm run check && npx vitest run && npm run test:e2e`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add src/lib/shared/slug.ts src/lib/shared/slug.test.ts src/routes/e src/lib/components/LinkCard.svelte src/lib/components/CreateEvent.svelte src/lib/components/HomeScreen.svelte src/lib/components/LinkScreen.svelte src/routes/auth/openrouter/callback/+page.svelte e2e/preview.e2e.ts e2e/create.e2e.ts
git commit -m "Carry the event title in the shared link and in the page's own HTML"
```

## Deviations after review

The task review changed the code in these ways, and the code is the source of truth over the steps above.

- The three `?created=1` navigations keep `resolve('/e/[code]?created=1', { code })`: with the optional slug as the last segment, `resolve('/e/[code]/[[slug]]?created=1', ...)` renders `/e/<code>/?created=1`, and the lint rule against navigation without `resolve()` rejects composing the query by hand.
- `eventPath(code, title)` in `src/lib/shared/slug.ts` holds the one rule for the shared path and leaves the segment out when the slug is empty or collides with a sibling route such as `edit`; the server load and the share card both use it.
- The share card reads the origin from `page.url` rather than `location`, since the page is now server-rendered.
- `slugify` spells `ß`, `æ`, `ø`, `œ`, `ð`, `þ`, `ł`, and `đ` out before decomposition, so they survive in the link.
- The preview scenario refuses redirects, so a canonicalising redirect could never pass as a working bare link; it rules out image and site-name tags as well as the description, checks there is exactly one `<title>`, and covers a title that slugifies to `edit`.
- The QR code encodes the bare link (spec section 6.8).
- Recorded and left alone: the host's copied link and QR differ by the slug; every client navigation to an event page now costs one small server read for the title.
