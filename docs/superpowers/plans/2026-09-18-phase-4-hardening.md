# Phase 4 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the live test on a hardened build: a content security policy, an installable manifest, network failures that read as such, a storage check before an event is created, phone-width chart labels that wrap instead of truncating, denser ranking rows, and a CI that cancels superseded runs.

**Architecture:** Headers come from SvelteKit's own CSP support so its boot script keeps working; the manifest and icon are static files; the client fetch wrapper turns transport failures into one `ApiError` with status 0; layout fixes are CSS only.

**Tech Stack:** SvelteKit 2, Svelte 5, TypeScript, Vitest, Playwright, GitHub Actions.

## Global Constraints

- Design spec section 14.8: a content security policy allows scripts and styles from the app's own origin only. Inline `style` attributes are used throughout the components, so `style-src` also allows `'unsafe-inline'`; the browser-side OpenRouter key exchange needs `connect-src https://openrouter.ai`.
- Every existing end-to-end scenario keeps passing under the policy, including the analysis flow and the OpenRouter callback page.
- Copy rule: no explanatory prose that states the obvious.
- No em dashes; commit messages carry no co-author or generated-by lines.
- `npm run lint`, `npm run check`, `npx vitest run`, and `npm run test:e2e` must pass before a task is done. Never stop a server with `taskkill //IM node.exe`; stop by PID only.
- Out of scope, deliberately: running the container as a non-root user (the Fly volume is root-owned and privilege dropping needs a restart-safe entrypoint change that should not land on the day of the live test) and the backup restore drill (no bucket until the Fly organization has a payment card).

---

### Task 1: Security policy, manifest, and resilient fetch

**Files:**
- Modify: `vite.config.ts`
- Modify: `src/app.html`
- Create: `static/manifest.webmanifest`
- Create: `static/icon.svg`
- Modify: `static/robots.txt`
- Modify: `src/lib/client/api.ts`
- Modify: `src/lib/client/tokens.ts`
- Modify: `src/routes/+page.svelte`
- Modify: `.github/workflows/ci.yml`
- Test: `src/lib/client/api.test.ts`
- Test: `src/lib/client/tokens.test.ts`
- Test: `e2e/headers.e2e.ts`

**Interfaces:**
- Produces: `ApiError` with `status: 0` for transport failures; `storageAvailable(): boolean` in `$lib/client/tokens`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/client/api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

const respond = (status: number, body: string | null, type = 'application/json') =>
	vi.fn(async () => new Response(body, { status, headers: type ? { 'content-type': type } : {} }));

describe('api', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('returns parsed JSON and undefined for 204', async () => {
		vi.stubGlobal('fetch', respond(200, '{"ok":true}'));
		expect(await api('/x')).toEqual({ ok: true });
		vi.stubGlobal('fetch', respond(204, null, ''));
		expect(await api('/x', { method: 'DELETE' })).toBeUndefined();
	});

	it('uses the server message, then the status text, for failures', async () => {
		vi.stubGlobal('fetch', respond(409, '{"message":"Closing is final"}'));
		await expect(api('/x')).rejects.toMatchObject({ status: 409, message: 'Closing is final' });
		vi.stubGlobal('fetch', respond(502, '<html>bad gateway</html>', 'text/html'));
		const err = await api('/x').catch((e) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect(err.status).toBe(502);
	});

	it('turns a transport failure into a status 0 error with a plain message', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
		await expect(api('/x')).rejects.toMatchObject({
			status: 0,
			message: 'Could not reach the server. Check your connection and try again.'
		});
	});
});
```

Append inside the describe block of `src/lib/client/tokens.test.ts` (add `storageAvailable` to the import):

```ts
	it('storageAvailable reports whether the browser lets us keep tokens', () => {
		expect(storageAvailable()).toBe(true);
		Object.defineProperty(globalThis, 'localStorage', {
			value: { setItem() { throw new Error('blocked'); }, removeItem() {}, getItem() { return null; } },
			configurable: true
		});
		expect(storageAvailable()).toBe(false);
	});
```

Create `e2e/headers.e2e.ts`:

```ts
import { expect, test } from '@playwright/test';

test('pages carry a content security policy and a manifest', async ({ request }) => {
	const home = await request.get('/');
	const csp = home.headers()['content-security-policy'] ?? '';
	expect(csp).toContain("default-src 'self'");
	expect(csp).toMatch(/script-src 'self'/);
	expect(csp).toContain("style-src 'self' 'unsafe-inline'");
	expect(csp).toContain("connect-src 'self' https://openrouter.ai");
	expect(csp).toContain("frame-ancestors 'none'");
	expect(await home.text()).toContain('rel="manifest"');
	const manifest = await request.get('/manifest.webmanifest');
	expect(manifest.status()).toBe(200);
	expect((await manifest.json()).display).toBe('standalone');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/client`
Expected: FAIL (transport case and `storageAvailable`).

- [ ] **Step 3: Implement**

In `src/lib/client/api.ts`, wrap the `fetch` call:

```ts
	let res: Response;
	try {
		res = await fetch(path, { ...same options as today... });
	} catch {
		throw new ApiError(0, 'Could not reach the server. Check your connection and try again.');
	}
	if (res.status === 204) return undefined as T;
```

keeping the existing error handling for non-ok responses.

Append to `src/lib/client/tokens.ts`:

```ts
/** True when this browser lets the app keep a token, which the host link depends on. */
export function storageAvailable(): boolean {
	try {
		localStorage.setItem('dm:probe', '1');
		localStorage.removeItem('dm:probe');
		return true;
	} catch {
		return false;
	}
}
```

In `src/routes/+page.svelte`, at the start of `create()`, before any request:

```ts
		if (!storageAvailable()) {
			throw new ApiError(0, 'This browser blocks site storage, so it cannot keep the host link. Allow storage or use another browser.');
		}
```

(`EventForm` shows an `ApiError` message as the form error; import `ApiError` and `storageAvailable`.)

In `vite.config.ts`, add next to `adapter: adapter(),` inside the `sveltekit({ ... })` options:

```ts
			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
					'style-src': ['self', 'unsafe-inline'],
					'img-src': ['self', 'data:'],
					'connect-src': ['self', 'https://openrouter.ai'],
					'frame-ancestors': ['none'],
					'base-uri': ['self'],
					'form-action': ['self']
				}
			},
```

If the plugin rejects a top-level `csp`, nest it as `kit: { csp: { ... } }` in the same object and keep `adapter` where it is only if that still builds; `npm run build` followed by a curl of `http://localhost:4173/` from the e2e server shows the header. `mode: 'auto'` lets SvelteKit add a hash or nonce for its own boot script; do not add `'unsafe-inline'` to `script-src`.

Create `static/manifest.webmanifest`:

```json
{
	"name": "DecisionMaker",
	"short_name": "DecisionMaker",
	"start_url": "/",
	"display": "standalone",
	"background_color": "#f7f6f3",
	"theme_color": "#2f6fdb",
	"icons": [{ "src": "/icon.svg", "sizes": "any", "type": "image/svg+xml" }]
}
```

Copy `src/lib/assets/favicon.svg` to `static/icon.svg`. In `src/app.html` add inside `<head>` before `%sveltekit.head%`:

```html
		<link rel="manifest" href="/manifest.webmanifest" />
		<meta name="theme-color" content="#2f6fdb" />
```

Replace `static/robots.txt` with:

```
# Event links are private to their group. Crawlers stay out of them.
User-agent: *
Disallow: /e/
Disallow: /signin
Disallow: /me
```

In `.github/workflows/ci.yml`, add after `permissions:` block:

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

- [ ] **Step 4: Run every gate**

Run: `npm run lint && npm run check && npx vitest run && npm run test:e2e`
Expected: green. If any e2e scenario fails under the policy, the console shows the blocked directive; fix the directive, never the scenario.

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts src/app.html static/manifest.webmanifest static/icon.svg static/robots.txt src/lib/client/api.ts src/lib/client/api.test.ts src/lib/client/tokens.ts src/lib/client/tokens.test.ts src/routes/+page.svelte .github/workflows/ci.yml e2e/headers.e2e.ts
git commit -m "Add a content security policy, a manifest, a storage check, and plain network errors"
```

---

### Task 2: Phone-width layout fixes

**Files:**
- Modify: `src/app.css`
- Modify: `src/lib/components/RankingWidget.svelte`
- Test: `e2e/participant.e2e.ts` (one assertion)

**Interfaces:** none new.

- [ ] **Step 1: Fix the chart labels**

In `src/app.css`, replace the `.bar .name` rule with:

```css
.bar .name {
	flex: 0 0 38%;
	color: var(--muted);
	line-height: 1.2;
	overflow-wrap: anywhere;
}
```

and add `align-items: center;` already present on `.bar` (keep). Labels now wrap onto a second line instead of truncating at 120px.

- [ ] **Step 2: Tighten the ranking rows**

Append to `src/app.css`:

```css
.row .icon-btn {
	min-width: 36px;
	padding: 0 6px;
}

.row .veto {
	padding: 0 8px;
}

@media (max-width: 380px) {
	.row {
		gap: 4px;
		padding: 8px 8px;
	}
}
```

In `src/lib/components/RankingWidget.svelte`, give the ranked row's label span `class="grow"` a `style="line-height:1.25"` so a wrapped label stays compact, and keep everything else as it is.

- [ ] **Step 3: Assert the wrap in the participant scenario**

In `e2e/participant.e2e.ts`, after the ranked list is visible in the existing submit scenario, add:

```ts
		const label = page.getByTestId('ranked').getByText('Tapas crawl', { exact: false }).first();
		await expect(label).toBeVisible();
		expect((await label.boundingBox())?.width ?? 0).toBeGreaterThan(60);
```

- [ ] **Step 4: Run every gate**

Run: `npm run lint && npm run check && npx vitest run && npm run test:e2e`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/app.css src/lib/components/RankingWidget.svelte e2e/participant.e2e.ts
git commit -m "Wrap chart labels and tighten ranking rows at phone width"
```

## Deviations after review

The task reviews changed the code in these ways, and the code is the source of truth over the steps above.

- `storageAvailable()` treats a failed cleanup of its probe key as harmless: only a failed write means storage is unavailable, so the check cannot misreport after a successful write.
- `allHostTokens()` stops at the sign-in limit of 200 tokens, which is now the shared constant `MAX_HOST_TOKENS_PER_SIGNIN` that the session route validates against, so a device holding more still signs in.
- The header scenario also asserts the nonce on `script-src`, the absence of `'unsafe-inline'` there, and the `img-src`, `base-uri`, and `form-action` directives.
