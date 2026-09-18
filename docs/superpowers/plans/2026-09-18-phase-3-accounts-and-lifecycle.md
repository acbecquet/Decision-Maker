# Phase 3 Accounts and Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A host can sign in by email magic link and reach their events from any device, events created while signed in belong to the account, the host can delete an event, expired unowned events are swept, and the link screen offers a QR code and the phone's share sheet.

**Architecture:** Magic links and sessions are hashed tokens in the existing `magic_links` and `sessions` tables; the session travels in an httpOnly cookie that a server hook resolves into `locals.accountId`, and every host check accepts either the host token or account ownership.
Mail goes through a `Mailer` interface with a Resend implementation and an in-memory sink that the test server exposes through one guarded endpoint.
Delete and the expiry sweep are plain repository functions; the sweep runs on the existing minute tick.

**Tech Stack:** SvelteKit 2, Svelte 5, TypeScript, Drizzle on better-sqlite3, zod 4, `resend` 6, `qrcode` 1.5, Vitest, Playwright.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-09-17-decision-maker-design.md`, sections 5 (account session), 6.1 (QR and share sheet), 6.5 (delete), 6.6 (housekeeping), 12 (tables), 14 (limits).
- A magic link is single use and expires after fifteen minutes. A session lasts ninety days. Both tokens are 256-bit values stored only as SHA-256 hashes and compared through hashes.
- The session cookie is named `dm_session`, httpOnly, sameSite lax, path `/`, secure when the request is https. No other cookie exists; participants never get one.
- The one link renders the host view when the request carries a valid host token or a session that owns the event. Every host-only route accepts either.
- Events created while signed in carry `account_id`. On sign-in the client sends the host tokens it holds and the server attaches the matching unowned events to the account.
- Rate limits: five magic-link sends per hour per address and twenty per hour per IP, through `enforce`.
- Expiry: ninety days after publish, or after creation if never published (already set); the sweep deletes expired events with no account. Deleting an event removes everything, including the report.
- Mail: `RESEND_API_KEY` selects Resend; `ALLOW_MAIL_SINK=1` selects the in-memory sink and enables `GET /api/test/mail`; with neither, sign-in answers 503. The sender is `MAIL_FROM`, default `DecisionMaker <onboarding@resend.dev>`. Keys are never logged.
- Copy rule: no explanatory prose that states the obvious. The sign-in page has no pitch. The delete dialog carries exactly one sentence: "Everything is removed, including the report."
- Navigation uses `goto(resolve(...))`; `$state` seeded from props through `untrack`; no em dashes; commit messages carry no co-author or generated-by lines.
- `npm run lint`, `npm run check`, `npx vitest run`, and `npm run test:e2e` must pass before a task is done. Never stop a server with `taskkill //IM node.exe`; stop by PID only.

---

### Task 1: Magic links, sessions, claiming, and the mailer

**Files:**
- Create: `src/lib/server/auth.ts`
- Create: `src/lib/server/mail.ts`
- Modify: `package.json` (dependency `resend`)
- Modify: `.env.example`
- Test: `src/lib/server/auth.test.ts`
- Test: `src/lib/server/mail.test.ts`

**Interfaces:**
- Consumes: `accounts`, `magicLinks`, `sessions`, `events` tables; `sha256Hex`, `isTokenShape` from `./crypto`; `addDays` from `./events`.
- Produces: `createMagicLink(db, email, now?): { token: string; email: string }`, `redeemMagicLink(db, token, now?): { sessionToken: string; accountId: string; email: string }`, `accountIdForSession(db, sessionToken, now?): string | null`, `endSession(db, sessionToken)`, `claimEvents(db, accountId, hostTokens): number`, `listAccountEvents(db, accountId): AccountEvent[]`, constants `MAGIC_LINK_TTL_MS`, `SESSION_TTL_DAYS`, `SESSION_COOKIE`; `Mailer`, `getMailer(env)`, `mailSink`, `normalizeEmail`.

- [ ] **Step 1: Install and document**

Run: `npm install resend@^6.28.0`

Append to `.env.example`:

```
# Magic-link email. With RESEND_API_KEY unset and ALLOW_MAIL_SINK unset, sign-in is unavailable.
# RESEND_API_KEY=
# MAIL_FROM=DecisionMaker <onboarding@resend.dev>
# Set to 1 to keep magic-link mail in memory and expose it at GET /api/test/mail (tests only).
# ALLOW_MAIL_SINK=1
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/server/auth.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
	accountIdForSession,
	claimEvents,
	createMagicLink,
	endSession,
	listAccountEvents,
	redeemMagicLink
} from './auth';
import { sha256Hex } from './crypto';
import { accounts, events, magicLinks } from './db/schema';
import { getEventById, listOptions } from './events';
import { submitResponse } from './participants';
import { HOST_HASH, makeDb, makeEvent, response } from './test-utils';

const t0 = new Date('2026-09-18T10:00:00.000Z');
const later = (ms: number) => new Date(t0.getTime() + ms);

describe('magic links and sessions', () => {
	it('creates a hashed single-use link that signs in once and creates the account', () => {
		const db = makeDb();
		const { token, email } = createMagicLink(db, '  Charlie@Example.com ', t0);
		expect(token).toMatch(/^[0-9a-f]{64}$/);
		expect(email).toBe('charlie@example.com');
		const row = db.select().from(magicLinks).get()!;
		expect(row.tokenHash).toBe(sha256Hex(token));
		expect(row.expiresAt).toBe('2026-09-18T10:15:00.000Z');
		expect(row.usedAt).toBeNull();

		const session = redeemMagicLink(db, token, later(60_000));
		expect(session.sessionToken).toMatch(/^[0-9a-f]{64}$/);
		expect(session.email).toBe('charlie@example.com');
		expect(db.select().from(accounts).all()).toHaveLength(1);
		expect(accountIdForSession(db, session.sessionToken, later(120_000))).toBe(session.accountId);
		expect(() => redeemMagicLink(db, token, later(120_000))).toThrow(/already been used/);
	});

	it('rejects expired, unknown, and malformed links', () => {
		const db = makeDb();
		const { token } = createMagicLink(db, 'a@b.co', t0);
		expect(() => redeemMagicLink(db, token, later(15 * 60_000 + 1))).toThrow(/expired/);
		expect(() => redeemMagicLink(db, 'f'.repeat(64), t0)).toThrow(/not valid/);
		expect(() => redeemMagicLink(db, 'short', t0)).toThrow(/not valid/);
	});

	it('reuses the account for the same email and expires sessions after ninety days', () => {
		const db = makeDb();
		const first = redeemMagicLink(db, createMagicLink(db, 'a@b.co', t0).token, t0);
		const second = redeemMagicLink(db, createMagicLink(db, 'A@B.CO', t0).token, t0);
		expect(second.accountId).toBe(first.accountId);
		expect(accountIdForSession(db, first.sessionToken, later(89 * 86_400_000))).toBe(first.accountId);
		expect(accountIdForSession(db, first.sessionToken, later(90 * 86_400_000 + 1))).toBeNull();
		expect(accountIdForSession(db, 'not-a-token', t0)).toBeNull();
		endSession(db, second.sessionToken);
		expect(accountIdForSession(db, second.sessionToken, t0)).toBeNull();
		expect(accountIdForSession(db, first.sessionToken, t0)).toBe(first.accountId);
	});
});

describe('claiming and listing events', () => {
	it('attaches unowned events whose host token matches and lists them newest first', () => {
		const db = makeDb();
		const mine = makeEvent(db, { title: 'Mine' });
		const other = makeEvent(db, { title: 'Theirs' });
		const hostToken = 'c'.repeat(64);
		db.update(events).set({ hostTokenHash: sha256Hex(hostToken), createdAt: '2026-09-18T11:00:00.000Z' }).where(eq(events.id, mine.id)).run();
		const { accountId } = redeemMagicLink(db, createMagicLink(db, 'a@b.co', t0).token, t0);
		expect(claimEvents(db, accountId, [hostToken, 'garbage', 'd'.repeat(64)])).toBe(1);
		expect(getEventById(db, mine.id).accountId).toBe(accountId);
		expect(getEventById(db, other.id).accountId).toBeNull();
		expect(claimEvents(db, accountId, [hostToken])).toBe(0);

		const ids = listOptions(db, mine.id).map((o) => o.id);
		submitResponse(db, mine, ids, 'e'.repeat(64), response('Ana', [ids[0]]), { autoApprove: false });
		const owned = makeEvent(db, { title: 'Owned' });
		db.update(events).set({ accountId, createdAt: '2026-09-18T12:00:00.000Z' }).where(eq(events.id, owned.id)).run();
		expect(listAccountEvents(db, accountId)).toEqual([
			{ code: owned.code, title: 'Owned', state: 'open', submittedCount: 0, createdAt: '2026-09-18T12:00:00.000Z' },
			{ code: mine.code, title: 'Mine', state: 'open', submittedCount: 1, createdAt: '2026-09-18T11:00:00.000Z' }
		]);
		expect(HOST_HASH).toHaveLength(64);
	});

	it('does not move an event that another account already owns', () => {
		const db = makeDb();
		const event = makeEvent(db);
		const hostToken = 'c'.repeat(64);
		db.update(events).set({ hostTokenHash: sha256Hex(hostToken) }).where(eq(events.id, event.id)).run();
		const a = redeemMagicLink(db, createMagicLink(db, 'a@b.co', t0).token, t0);
		const b = redeemMagicLink(db, createMagicLink(db, 'b@b.co', t0).token, t0);
		expect(claimEvents(db, a.accountId, [hostToken])).toBe(1);
		expect(claimEvents(db, b.accountId, [hostToken])).toBe(0);
		expect(getEventById(db, event.id).accountId).toBe(a.accountId);
	});
});
```

Create `src/lib/server/mail.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getMailer, mailSink, magicLinkMessage, normalizeEmail } from './mail';

describe('mail', () => {
	it('normalizes addresses', () => {
		expect(normalizeEmail('  Charlie@Example.COM ')).toBe('charlie@example.com');
	});

	it('picks the sink only when allowed, and nothing when unconfigured', () => {
		expect(getMailer({})).toBeNull();
		expect(getMailer({ ALLOW_MAIL_SINK: '1' })?.id).toBe('sink');
		expect(getMailer({ RESEND_API_KEY: 're_x' })?.id).toBe('resend');
		expect(getMailer({ RESEND_API_KEY: 're_x', ALLOW_MAIL_SINK: '1' })?.id).toBe('resend');
	});

	it('keeps sink messages in memory, newest first per address', async () => {
		const sink = getMailer({ ALLOW_MAIL_SINK: '1' })!;
		await sink.sendMagicLink('a@b.co', 'https://x.test/signin/callback?token=1');
		await sink.sendMagicLink('a@b.co', 'https://x.test/signin/callback?token=2');
		await sink.sendMagicLink('c@b.co', 'https://x.test/signin/callback?token=3');
		expect(mailSink.latest('a@b.co')?.url).toBe('https://x.test/signin/callback?token=2');
		expect(mailSink.latest('nobody@b.co')).toBeNull();
	});

	it('writes a plain message with the link and the expiry', () => {
		const { subject, text, html } = magicLinkMessage('https://x.test/signin/callback?token=abc');
		expect(subject).toBe('Sign in to DecisionMaker');
		expect(text).toContain('https://x.test/signin/callback?token=abc');
		expect(text).toContain('15 minutes');
		expect(html).toContain('href="https://x.test/signin/callback?token=abc"');
	});
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/server/auth.test.ts src/lib/server/mail.test.ts`
Expected: FAIL, modules missing.

- [ ] **Step 4: Write the auth module**

Create `src/lib/server/auth.ts`:

```ts
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { isTokenShape, newId, sha256Hex } from './crypto';
import type { DbLike } from './db';
import { accounts, events, magicLinks, participants, sessions } from './db/schema';
import { badRequest } from './errors';
import { addDays } from './events';
import { normalizeEmail } from './mail';
import type { EventState } from '$lib/shared/types';
import { randomBytes } from 'node:crypto';

export const MAGIC_LINK_TTL_MS = 15 * 60_000;
export const SESSION_TTL_DAYS = 90;
export const SESSION_COOKIE = 'dm_session';

export type AccountEvent = {
	code: string;
	title: string;
	state: EventState;
	submittedCount: number;
	createdAt: string;
};

const newSecret = () => randomBytes(32).toString('hex');

/** Stores the hash of a fresh single-use token for the address and returns the token for the mailer. */
export function createMagicLink(db: DbLike, rawEmail: string, now = new Date()): { token: string; email: string } {
	const email = normalizeEmail(rawEmail);
	const token = newSecret();
	db.insert(magicLinks)
		.values({
			tokenHash: sha256Hex(token),
			email,
			expiresAt: new Date(now.getTime() + MAGIC_LINK_TTL_MS).toISOString()
		})
		.run();
	return { token, email };
}

/** Marks the link used, creates the account on first sign-in, and opens a ninety-day session. */
export function redeemMagicLink(
	db: DbLike,
	token: string,
	now = new Date()
): { sessionToken: string; accountId: string; email: string } {
	if (!isTokenShape(token)) throw badRequest('This sign-in link is not valid');
	const link = db.select().from(magicLinks).where(eq(magicLinks.tokenHash, sha256Hex(token))).get();
	if (!link) throw badRequest('This sign-in link is not valid');
	if (link.usedAt) throw badRequest('This sign-in link has already been used');
	if (link.expiresAt <= now.toISOString()) throw badRequest('This sign-in link has expired');
	const nowIso = now.toISOString();
	db.update(magicLinks).set({ usedAt: nowIso }).where(eq(magicLinks.tokenHash, link.tokenHash)).run();
	let account = db.select().from(accounts).where(eq(accounts.email, link.email)).get();
	if (!account) {
		db.insert(accounts).values({ id: newId(), email: link.email, createdAt: nowIso }).run();
		account = db.select().from(accounts).where(eq(accounts.email, link.email)).get()!;
	}
	const sessionToken = newSecret();
	db.insert(sessions)
		.values({
			tokenHash: sha256Hex(sessionToken),
			accountId: account.id,
			expiresAt: addDays(now, SESSION_TTL_DAYS).toISOString()
		})
		.run();
	return { sessionToken, accountId: account.id, email: account.email };
}

/** The account behind a session cookie value, or null when missing, malformed, unknown, or expired. */
export function accountIdForSession(db: DbLike, sessionToken: string | undefined, now = new Date()): string | null {
	if (!isTokenShape(sessionToken)) return null;
	const row = db.select().from(sessions).where(eq(sessions.tokenHash, sha256Hex(sessionToken))).get();
	if (!row || row.expiresAt <= now.toISOString()) return null;
	return row.accountId;
}

export function endSession(db: DbLike, sessionToken: string | undefined): void {
	if (!isTokenShape(sessionToken)) return;
	db.delete(sessions).where(eq(sessions.tokenHash, sha256Hex(sessionToken))).run();
}

/** Attaches every unowned event whose host token is among the given ones. Returns how many moved. */
export function claimEvents(db: DbLike, accountId: string, hostTokens: string[]): number {
	let claimed = 0;
	for (const token of hostTokens) {
		if (!isTokenShape(token)) continue;
		claimed += db
			.update(events)
			.set({ accountId })
			.where(and(eq(events.hostTokenHash, sha256Hex(token)), isNull(events.accountId)))
			.run().changes;
	}
	return claimed;
}

/** The account's events, newest first, with how many people have submitted. */
export function listAccountEvents(db: DbLike, accountId: string): AccountEvent[] {
	return db
		.select({
			code: events.code,
			title: events.title,
			state: events.state,
			submittedCount: sql<number>`(${db.select({ n: count() }).from(participants).where(eq(participants.eventId, events.id))})`,
			createdAt: events.createdAt
		})
		.from(events)
		.where(eq(events.accountId, accountId))
		.orderBy(desc(events.createdAt))
		.all();
}
```

If the correlated subquery for `submittedCount` does not type or run cleanly with the installed drizzle, replace it with a second query that counts participants grouped by `eventId` and merge the numbers in code; the returned shape must not change.

- [ ] **Step 5: Write the mailer**

Create `src/lib/server/mail.ts`:

```ts
import { Resend } from 'resend';
import { MAGIC_LINK_TTL_MS } from './auth';

export type Mailer = {
	readonly id: 'resend' | 'sink';
	sendMagicLink(to: string, url: string): Promise<void>;
};

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const DEFAULT_FROM = 'DecisionMaker <onboarding@resend.dev>';

export function magicLinkMessage(url: string): { subject: string; text: string; html: string } {
	const minutes = MAGIC_LINK_TTL_MS / 60_000;
	return {
		subject: 'Sign in to DecisionMaker',
		text: `Tap to sign in: ${url}\n\nThe link works once and expires in ${minutes} minutes.`,
		html: `<p><a href="${url}">Sign in to DecisionMaker</a></p><p>The link works once and expires in ${minutes} minutes.</p>`
	};
}

type SinkMessage = { to: string; url: string; at: number };
const messages: SinkMessage[] = [];

/** In-memory mail for tests and demos. Exposed through GET /api/test/mail when ALLOW_MAIL_SINK=1. */
export const mailSink = {
	latest(to: string): SinkMessage | null {
		const address = normalizeEmail(to);
		return [...messages].reverse().find((m) => m.to === address) ?? null;
	},
	clear() {
		messages.length = 0;
	}
};

const sinkMailer: Mailer = {
	id: 'sink',
	async sendMagicLink(to, url) {
		messages.push({ to: normalizeEmail(to), url, at: Date.now() });
	}
};

function resendMailer(apiKey: string, from: string): Mailer {
	const resend = new Resend(apiKey);
	return {
		id: 'resend',
		async sendMagicLink(to, url) {
			const { subject, text, html } = magicLinkMessage(url);
			const { error } = await resend.emails.send({ from, to: [to], subject, text, html });
			if (error) throw new Error(`Resend refused the message: ${error.message}`);
		}
	};
}

/** Resend when a key is configured, the sink when allowed, otherwise null (sign-in unavailable). */
export function getMailer(env: NodeJS.ProcessEnv = process.env): Mailer | null {
	if (env.RESEND_API_KEY) return resendMailer(env.RESEND_API_KEY, env.MAIL_FROM || DEFAULT_FROM);
	if (env.ALLOW_MAIL_SINK === '1') return sinkMailer;
	return null;
}
```

`auth.ts` imports `normalizeEmail` from `mail.ts` and `mail.ts` imports `MAGIC_LINK_TTL_MS` from `auth.ts`; both are used only inside functions, so the cycle is harmless. If the linter objects, move `MAGIC_LINK_TTL_MS` into `mail.ts` and re-export it from `auth.ts`.

- [ ] **Step 6: Run the tests to verify they pass, then every gate**

Run: `npx vitest run src/lib/server/auth.test.ts src/lib/server/mail.test.ts`
Expected: PASS.

Run: `npm run lint && npm run check && npx vitest run`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .env.example src/lib/server/auth.ts src/lib/server/auth.test.ts src/lib/server/mail.ts src/lib/server/mail.test.ts
git commit -m "Add magic links, sessions, event claiming, and the Resend mailer with a test sink"
```

---

### Task 2: Session cookie, account ownership, and the auth routes

**Files:**
- Modify: `src/app.d.ts`
- Modify: `src/hooks.server.ts`
- Modify: `src/lib/server/roles.ts`
- Modify: `src/lib/server/views.ts`
- Modify: `src/lib/server/events.ts` (`createEvent` takes an optional `accountId`)
- Modify: `src/lib/shared/validation.ts`
- Modify: every route that calls `requireHost`, `isHost`, `buildEventPageView`, or `buildReportView`
- Create: `src/routes/api/auth/magic-link/+server.ts`
- Create: `src/routes/api/auth/session/+server.ts`
- Create: `src/routes/api/auth/signout/+server.ts`
- Create: `src/routes/api/me/+server.ts`
- Create: `src/routes/api/me/claim/+server.ts`
- Create: `src/routes/api/test/mail/+server.ts`
- Modify: `playwright.config.ts` (`ALLOW_MAIL_SINK: '1'`)
- Test: `src/lib/server/roles.test.ts`
- Test: `e2e/api.e2e.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: `App.Locals = { accountId: string | null }`; `isHost(event, request, accountId?)` and `requireHost(event, request, accountId?)`; `buildEventPageView(db, event, request, accountId?)`; `buildReportView(db, event, request, accountId?)`; `createEvent(db, input, hostTokenHash, accountId?, now?)`; routes `POST /api/auth/magic-link` `{ email }`, `POST /api/auth/session` `{ token, hostTokens }`, `POST /api/auth/signout`, `GET /api/me`, `POST /api/me/claim` `{ hostTokens }`, `GET /api/test/mail?to=`.

- [ ] **Step 1: Write the failing role test**

Append to `src/lib/server/roles.test.ts` (extend its imports as needed: `isHost`, `sha256Hex`, `makeDb`, `makeEvent`, `events`, `eq`):

```ts
describe('isHost with an account session', () => {
	it('accepts the owning account without a token and rejects other accounts', () => {
		const db = makeDb();
		const event = makeEvent(db);
		db.update(events).set({ accountId: 'acc-1' }).where(eq(events.id, event.id)).run();
		const owned = { ...event, accountId: 'acc-1' };
		const bare = new Request('http://x.test/');
		expect(isHost(owned, bare, 'acc-1')).toBe(true);
		expect(isHost(owned, bare, 'acc-2')).toBe(false);
		expect(isHost(owned, bare, null)).toBe(false);
		expect(isHost({ ...event, accountId: null }, bare, 'acc-1')).toBe(false);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/server/roles.test.ts`
Expected: FAIL, `isHost` ignores the third argument.

- [ ] **Step 3: Thread the account through roles, views, and hooks**

In `src/app.d.ts`, replace the commented `Locals` line with:

```ts
		interface Locals {
			accountId: string | null;
		}
```

In `src/lib/server/roles.ts`:

```ts
/** A host is the device holding the host token, or a signed-in account that owns the event. */
export function isHost(event: EventRow, request: Request, accountId: string | null = null): boolean {
	if (accountId && event.accountId === accountId) return true;
	const token = tokenFromHeader(request, 'x-host-token');
	return token !== null && safeEqualHex(sha256Hex(token), event.hostTokenHash);
}

export function requireHost(event: EventRow, request: Request, accountId: string | null = null): void {
	if (!isHost(event, request, accountId)) throw forbidden('Host only');
}
```

In `src/lib/server/views.ts`, give `buildEventPageView` and `buildReportView` a fourth parameter `accountId: string | null = null` and pass it to every `isHost` call inside them.

In `src/lib/server/events.ts`, change the signature to `createEvent(db, input, hostTokenHash, accountId: string | null = null, now = new Date())` and set `accountId` on the inserted row. Check every caller (`src/routes/api/events/+server.ts`, `src/lib/server/test-utils.ts`, `src/lib/server/events.test.ts`) still compiles; the create route passes `locals.accountId`.

In `src/hooks.server.ts`, resolve the session before the request runs:

```ts
import { accountIdForSession, SESSION_COOKIE } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.accountId = accountIdForSession(getDb(), event.cookies.get(SESSION_COOKIE));
	const response = await resolve(event);
	...existing headers...
};
```

In every route handler that calls `requireHost(event, request)`, `isHost(event, request)`, `buildEventPageView(db, x, request)`, or `buildReportView(db, x, request)`, add `locals` to the destructured handler argument and pass `locals.accountId` as the extra argument. The routes are: `api/events/[code]/+server.ts` (GET, PATCH, PUT), `.../responses/+server.ts` (POST uses `isHost`, PUT uses the page view), `.../close`, `.../participants/[id]`, `.../roster/approve-all`, `.../models`, `.../analysis` (POST and GET), `.../report`, `.../publish`.

- [ ] **Step 4: Add the validation and the routes**

Append to `src/lib/shared/validation.ts`:

```ts
const hostTokens = z.array(z.string()).max(200).default([]);

export const magicLinkInput = z.object({
	email: z.string().trim().toLowerCase().email('Enter an email address').max(254)
});

export const sessionInput = z.object({ token: z.string().min(1), hostTokens });

export const claimInput = z.object({ hostTokens });
```

Create `src/routes/api/auth/magic-link/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createMagicLink } from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import { AppError } from '$lib/server/errors';
import { raise, readJson } from '$lib/server/http';
import { getMailer } from '$lib/server/mail';
import { enforce } from '$lib/server/ratelimit';
import { magicLinkInput } from '$lib/shared/validation';

export const POST: RequestHandler = async ({ request, url, getClientAddress }) => {
	try {
		const mailer = getMailer();
		if (!mailer) throw new AppError(503, 'Sign-in is not set up on this server');
		const input = await readJson(request, magicLinkInput);
		enforce(`magic:ip:${getClientAddress()}`, 20, 3_600_000);
		enforce(`magic:addr:${input.email}`, 5, 3_600_000);
		const { token, email } = createMagicLink(getDb(), input.email);
		const link = new URL('/signin/callback', process.env.ORIGIN ?? url.origin);
		link.searchParams.set('token', token);
		try {
			await mailer.sendMagicLink(email, link.href);
		} catch (e) {
			console.error('magic link mail failed', e instanceof Error ? e.message : e);
			throw new AppError(502, 'Could not send the email, try again');
		}
		return json({ ok: true });
	} catch (e) {
		raise(e);
	}
};
```

Create `src/routes/api/auth/session/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { claimEvents, redeemMagicLink, SESSION_COOKIE, SESSION_TTL_DAYS } from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import { raise, readJson } from '$lib/server/http';
import { sessionInput } from '$lib/shared/validation';

/** Turns a magic-link token into a session cookie and attaches the events this device hosts. */
export const POST: RequestHandler = async ({ request, cookies, url }) => {
	try {
		const db = getDb();
		const input = await readJson(request, sessionInput);
		const session = redeemMagicLink(db, input.token);
		cookies.set(SESSION_COOKIE, session.sessionToken, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: url.protocol === 'https:',
			maxAge: SESSION_TTL_DAYS * 86_400
		});
		const claimed = claimEvents(db, session.accountId, input.hostTokens);
		return json({ email: session.email, claimed });
	} catch (e) {
		raise(e);
	}
};
```

Create `src/routes/api/auth/signout/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { endSession, SESSION_COOKIE } from '$lib/server/auth';
import { getDb } from '$lib/server/db';

export const POST: RequestHandler = ({ cookies }) => {
	endSession(getDb(), cookies.get(SESSION_COOKIE));
	cookies.delete(SESSION_COOKIE, { path: '/' });
	return json({ ok: true });
};
```

Create `src/routes/api/me/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { listAccountEvents } from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import { accounts } from '$lib/server/db/schema';
import { AppError } from '$lib/server/errors';
import { raise } from '$lib/server/http';

export const GET: RequestHandler = ({ locals }) => {
	try {
		if (!locals.accountId) throw new AppError(401, 'Not signed in');
		const db = getDb();
		const account = db.select().from(accounts).where(eq(accounts.id, locals.accountId)).get();
		if (!account) throw new AppError(401, 'Not signed in');
		return json({ email: account.email, events: listAccountEvents(db, account.id) });
	} catch (e) {
		raise(e);
	}
};
```

Create `src/routes/api/me/claim/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { claimEvents } from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import { AppError } from '$lib/server/errors';
import { raise, readJson } from '$lib/server/http';
import { claimInput } from '$lib/shared/validation';

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		if (!locals.accountId) throw new AppError(401, 'Not signed in');
		const input = await readJson(request, claimInput);
		return json({ claimed: claimEvents(getDb(), locals.accountId, input.hostTokens) });
	} catch (e) {
		raise(e);
	}
};
```

Create `src/routes/api/test/mail/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { AppError } from '$lib/server/errors';
import { raise } from '$lib/server/http';
import { mailSink } from '$lib/server/mail';

/** The last magic-link mail sent to an address. Exists only on servers that run with the mail sink. */
export const GET: RequestHandler = ({ url }) => {
	try {
		if (process.env.ALLOW_MAIL_SINK !== '1') throw new AppError(404, 'Not found');
		const to = url.searchParams.get('to') ?? '';
		const message = mailSink.latest(to);
		if (!message) throw new AppError(404, 'No mail for that address');
		return json({ to: message.to, url: message.url });
	} catch (e) {
		raise(e);
	}
};
```

In `playwright.config.ts`, add `ALLOW_MAIL_SINK: '1'` to the `webServer.env` block.

- [ ] **Step 5: Write the API end-to-end test**

Append to `e2e/api.e2e.ts`:

```ts
test.describe('accounts API', () => {
	test('signs in by magic link, claims the device events, owns new ones, and signs out', async ({ request, playwright }) => {
		const hostToken = token();
		const code = await createEventApi(request, hostToken);
		const email = `host-${code}@example.test`;

		expect((await request.get('/api/me')).status()).toBe(401);
		const sent = await request.post('/api/auth/magic-link', { data: { email: ` ${email.toUpperCase()} ` } });
		expect(sent.status()).toBe(200);
		const mail = await request.get(`/api/test/mail?to=${encodeURIComponent(email)}`);
		expect(mail.status()).toBe(200);
		const link = new URL((await mail.json()).url);
		expect(link.pathname).toBe('/signin/callback');
		const magic = link.searchParams.get('token')!;
		expect(magic).toMatch(/^[0-9a-f]{64}$/);

		const session = await request.post('/api/auth/session', { data: { token: magic, hostTokens: [hostToken, 'junk'] } });
		expect(session.status()).toBe(200);
		expect(await session.json()).toEqual({ email, claimed: 1 });
		expect((await request.post('/api/auth/session', { data: { token: magic, hostTokens: [] } })).status()).toBe(400);

		const me = await request.get('/api/me');
		expect(me.status()).toBe(200);
		const body = await me.json();
		expect(body.email).toBe(email);
		expect(body.events.map((e: { code: string }) => e.code)).toEqual([code]);

		const asAccount = await request.get(`/api/events/${code}`);
		expect((await asAccount.json()).role).toBe('host');

		const owned = await request.post('/api/events', {
			headers: { 'x-host-token': token() },
			data: { title: 'Owned', currency: 'EUR', options: [{ label: 'a' }, { label: 'b' }] }
		});
		expect(owned.status()).toBe(201);
		const { code: ownedCode } = await owned.json();
		expect(((await (await request.get('/api/me')).json()).events as { code: string }[]).map((e) => e.code)).toEqual([ownedCode, code]);

		const fresh = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
		expect((await fresh.get(`/api/events/${ownedCode}`)).status()).toBe(200);
		expect((await (await fresh.get(`/api/events/${ownedCode}`)).json()).role).toBe('participant');
		await fresh.dispose();

		expect((await request.post('/api/auth/signout')).status()).toBe(200);
		expect((await request.get('/api/me')).status()).toBe(401);
		expect((await (await request.get(`/api/events/${code}`)).json()).role).toBe('participant');
	});

	test('sign-in input is validated and unknown links are refused', async ({ request }) => {
		expect((await request.post('/api/auth/magic-link', { data: { email: 'nope' } })).status()).toBe(400);
		expect((await request.post('/api/auth/session', { data: { token: 'f'.repeat(64), hostTokens: [] } })).status()).toBe(400);
		expect((await request.get('/api/test/mail?to=nobody@example.test')).status()).toBe(404);
	});
});
```

- [ ] **Step 6: Run every gate**

Run: `npm run lint && npm run check && npx vitest run && npx playwright test e2e/api.e2e.ts`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/app.d.ts src/hooks.server.ts src/lib/server/roles.ts src/lib/server/roles.test.ts src/lib/server/views.ts src/lib/server/events.ts src/lib/shared/validation.ts src/routes/api playwright.config.ts e2e/api.e2e.ts
git commit -m "Resolve the session cookie into an account that counts as host, with sign-in routes"
```

---
### Task 3: Sign-in, callback, and my-events pages

**Files:**
- Modify: `src/lib/client/tokens.ts`
- Create: `src/routes/signin/+page.ts`
- Create: `src/routes/signin/+page.svelte`
- Create: `src/routes/signin/callback/+page.ts`
- Create: `src/routes/signin/callback/+page.svelte`
- Create: `src/routes/me/+page.ts`
- Create: `src/routes/me/+page.svelte`
- Modify: `src/routes/+page.svelte`
- Test: `src/lib/client/tokens.test.ts`
- Test: `e2e/accounts.e2e.ts`

**Interfaces:**
- Consumes: the auth routes from Task 2; `AccountEvent` shape `{ code, title, state, submittedCount, createdAt }`.
- Produces: `allHostTokens(): string[]` in `$lib/client/tokens`; pages `/signin`, `/signin/callback`, `/me`; a "My events" link on the home page.

- [ ] **Step 1: Write the failing token test**

Append inside the describe block of `src/lib/client/tokens.test.ts` (add `allHostTokens` to the import). The `MemoryStorage` class in that file needs `key(i)` and `length` for this test; add them:

```ts
	key(index: number) {
		return [...this.map.keys()][index] ?? null;
	}
	get length() {
		return this.map.size;
	}
```

and the test:

```ts
	it('allHostTokens returns every stored host token and nothing else', () => {
		setToken('one', 'host', 'a'.repeat(64));
		setToken('two', 'host', 'b'.repeat(64));
		setToken('two', 'participant', 'c'.repeat(64));
		localStorage.setItem('unrelated', 'x');
		expect(allHostTokens().sort()).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
	});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/client/tokens.test.ts`
Expected: FAIL, `allHostTokens` is not exported.

- [ ] **Step 3: Add the helper**

Append to `src/lib/client/tokens.ts`:

```ts
/** Every host token this device holds, so a sign-in can attach those events to the account. */
export function allHostTokens(): string[] {
	const tokens: string[] = [];
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (!k || !k.startsWith('dm:') || !k.endsWith(':host')) continue;
			const value = localStorage.getItem(k);
			if (value) tokens.push(value);
		}
	} catch {
		// Storage unavailable: nothing to claim.
	}
	return tokens;
}
```

- [ ] **Step 4: Write the pages**

Create `src/routes/signin/+page.ts` and `src/routes/signin/callback/+page.ts` and `src/routes/me/+page.ts`, each containing:

```ts
export const ssr = false;
```

Create `src/routes/signin/+page.svelte`:

```svelte
<script lang="ts">
	import { api, ApiError } from '$lib/client/api';

	let email = $state('');
	let sent = $state(false);
	let busy = $state(false);
	let error = $state('');

	async function send(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		busy = true;
		try {
			await api('/api/auth/magic-link', { method: 'POST', body: { email } });
			sent = true;
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Something went wrong, try again';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Sign in</title>
</svelte:head>

<main>
	{#if sent}
		<h1>Check your email</h1>
		<p class="muted">The link works once and expires in 15 minutes.</p>
	{:else}
		<h1>Sign in</h1>
		<form onsubmit={send} novalidate>
			<label for="email">Email</label>
			<input id="email" type="email" bind:value={email} autocomplete="email" inputmode="email" />
			{#if error}
				<p class="error" role="alert">{error}</p>
			{/if}
			<button type="submit" class="btn-primary btn-block" style="margin-top:16px" disabled={busy}>
				{busy ? 'Sending' : 'Send link'}
			</button>
		</form>
	{/if}
</main>
```

Create `src/routes/signin/callback/+page.svelte`:

```svelte
<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { api, ApiError } from '$lib/client/api';
	import { allHostTokens } from '$lib/client/tokens';

	const token = $derived(page.url.searchParams.get('token') ?? '');
	let busy = $state(false);
	let error = $state('');

	async function finish() {
		error = '';
		busy = true;
		try {
			await api('/api/auth/session', { method: 'POST', body: { token, hostTokens: allHostTokens() } });
			await goto(resolve('/me'));
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Something went wrong, try again';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Sign in</title>
</svelte:head>

<main>
	<h1>Sign in</h1>
	{#if !token}
		<p class="error" role="alert">This sign-in link is not valid.</p>
	{:else}
		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}
		<button type="button" class="btn-primary btn-block" onclick={finish} disabled={busy}>
			{busy ? 'Signing in' : 'Finish signing in'}
		</button>
	{/if}
</main>
```

Create `src/routes/me/+page.svelte`:

```svelte
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api, ApiError } from '$lib/client/api';
	import type { EventState } from '$lib/shared/types';

	type Row = { code: string; title: string; state: EventState; submittedCount: number; createdAt: string };
	let email = $state('');
	let rows = $state<Row[] | null>(null);
	let error = $state('');

	const pill: Record<EventState, string> = { open: 'pill-success', closed: 'pill-warn', published: '' };
	const label: Record<EventState, string> = { open: 'Open', closed: 'Closed', published: 'Published' };

	onMount(async () => {
		try {
			const me = await api<{ email: string; events: Row[] }>('/api/me');
			email = me.email;
			rows = me.events;
		} catch (err) {
			if (err instanceof ApiError && err.status === 401) await goto(resolve('/signin'));
			else error = 'Could not load your events. Check your connection and try again.';
		}
	});

	async function signOut() {
		await api('/api/auth/signout', { method: 'POST' });
		await goto(resolve('/'));
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
	{:else if rows === null}
		<p class="muted">Loading</p>
	{:else if rows.length === 0}
		<p class="muted">No events yet.</p>
	{:else}
		<ul style="list-style:none;padding:0;margin:0" data-testid="my-events">
			{#each rows as row (row.code)}
				<li class="card" style="margin:8px 0">
					<a href={resolve('/e/[code]', { code: row.code })} style="text-decoration:none;color:inherit">
						<strong>{row.title}</strong>
					</a>
					<p style="margin:6px 0 0">
						<span class={`pill ${pill[row.state]}`}>{label[row.state]}</span>
						<span class="muted small" style="margin-left:8px">{row.submittedCount} submitted</span>
					</p>
				</li>
			{/each}
		</ul>
	{/if}
	<div class="actions" style="margin-top:16px">
		<button type="button" class="btn-primary" onclick={() => goto(resolve('/'))}>New event</button>
		<button type="button" onclick={signOut}>Sign out</button>
	</div>
</main>
```

In `src/routes/+page.svelte`, add after the `<EventForm ... />` line:

```svelte
	<p class="small" style="margin-top:24px"><a href={resolve('/me')}>My events</a></p>
```

- [ ] **Step 5: Write the end-to-end scenario**

Create `e2e/accounts.e2e.ts`:

```ts
import { expect, test } from '@playwright/test';
import { createEventApi, newDevice, token } from './helpers';

test('a host signs in by magic link, sees the event on another device, and signs out', async ({ browser, request }) => {
	const hostToken = token();
	const code = await createEventApi(request, hostToken, { title: 'Sunday brunch' });
	const email = `ui-${code}@example.test`;

	const phone = await newDevice(browser);
	await phone.context.addInitScript(([key, value]) => localStorage.setItem(key, value), [`dm:${code}:host`, hostToken]);
	await phone.page.goto('/me');
	await expect(phone.page).toHaveURL(/\/signin$/);
	await phone.page.getByLabel('Email').fill(email);
	await phone.page.getByRole('button', { name: 'Send link' }).click();
	await expect(phone.page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

	const mail = await request.get(`/api/test/mail?to=${encodeURIComponent(email)}`);
	expect(mail.status()).toBe(200);
	const link = new URL((await mail.json()).url);
	await phone.page.goto(link.pathname + link.search);
	await phone.page.getByRole('button', { name: 'Finish signing in' }).click();
	await expect(phone.page).toHaveURL(/\/me$/);
	await expect(phone.page.getByText(email)).toBeVisible();
	const list = phone.page.getByTestId('my-events');
	await expect(list.getByRole('listitem')).toHaveCount(1);
	await expect(list).toContainText('Sunday brunch');
	await expect(list).toContainText('0 submitted');

	const laptop = await browser.newContext({ baseURL: test.info().project.use.baseURL });
	await laptop.addCookies(await phone.context.cookies());
	const laptopPage = await laptop.newPage();
	await laptopPage.goto(`/e/${code}`);
	await expect(laptopPage.getByRole('heading', { name: 'Names' })).toBeVisible();
	await expect(laptopPage.getByRole('button', { name: 'Close submissions' })).toBeVisible();
	await laptop.close();

	await phone.page.getByRole('button', { name: 'Sign out' }).click();
	await expect(phone.page).toHaveURL(/\/$/);
	await phone.page.goto('/me');
	await expect(phone.page).toHaveURL(/\/signin$/);
	await phone.context.close();
});

test('a used link is refused with a plain message', async ({ browser, request }) => {
	const email = `used-${token().slice(0, 8)}@example.test`;
	await request.post('/api/auth/magic-link', { data: { email } });
	const link = new URL((await (await request.get(`/api/test/mail?to=${encodeURIComponent(email)}`)).json()).url);
	const magic = link.searchParams.get('token');
	expect((await request.post('/api/auth/session', { data: { token: magic, hostTokens: [] } })).status()).toBe(200);

	const { page, context } = await newDevice(browser);
	await page.goto(link.pathname + link.search);
	await page.getByRole('button', { name: 'Finish signing in' }).click();
	await expect(page.getByRole('alert')).toContainText('already been used');
	await context.close();
});
```

- [ ] **Step 6: Run every gate**

Run: `npm run lint && npm run check && npx vitest run && npm run test:e2e`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/client/tokens.ts src/lib/client/tokens.test.ts src/routes/signin src/routes/me src/routes/+page.svelte e2e/accounts.e2e.ts
git commit -m "Add the sign-in, callback, and my-events pages"
```

---

### Task 4: Delete an event and sweep expired ones

**Files:**
- Modify: `src/lib/server/events.ts`
- Modify: `src/hooks.server.ts`
- Modify: `src/routes/api/events/[code]/+server.ts` (add `DELETE`)
- Modify: `src/lib/client/tokens.ts`
- Create: `src/lib/components/DeleteDialog.svelte`
- Modify: `src/lib/components/HostView.svelte`
- Test: `src/lib/server/events.test.ts`
- Test: `src/lib/client/tokens.test.ts`
- Test: `e2e/api.e2e.ts`
- Test: `e2e/host.e2e.ts`

**Interfaces:**
- Produces: `deleteEvent(db, event): void`, `deleteExpiredEvents(db, now?): number`, `DELETE /api/events/{code}` (204), `clearEventTokens(code)`, a "Delete event" button in every host state.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/server/events.test.ts` (extend the import with `deleteEvent`, `deleteExpiredEvents`; import `submitResponse` is already there from the edit task; import `participants`, `responses`, `options`, `events` from `./db/schema` and `eq` from `drizzle-orm`):

```ts
describe('deleteEvent and deleteExpiredEvents', () => {
	it('removes the event with its options, participants, and responses', () => {
		const db = openDatabase(':memory:');
		const event = createEvent(db, input, hash);
		const ids = listOptions(db, event.id).map((o) => o.id);
		submitResponse(db, event, ids, 'b'.repeat(64), { name: 'Ana', ranking: [ids[0]], vetoes: [], budget: null, opinion: 'x', suggestion: '' }, { autoApprove: false });
		deleteEvent(db, event);
		expect(findEventByCode(db, event.code)).toBeUndefined();
		expect(db.select().from(options).where(eq(options.eventId, event.id)).all()).toEqual([]);
		expect(db.select().from(participants).where(eq(participants.eventId, event.id)).all()).toEqual([]);
		expect(db.select().from(responses).all()).toEqual([]);
	});

	it('sweeps expired events that no account owns and leaves the rest', () => {
		const db = openDatabase(':memory:');
		const now = new Date('2026-09-18T12:00:00.000Z');
		const stale = createEvent(db, input, hash, null, new Date('2026-06-01T00:00:00.000Z'));
		const owned = createEvent(db, input, hash, 'acc-1', new Date('2026-06-01T00:00:00.000Z'));
		const fresh = createEvent(db, input, hash, null, new Date('2026-09-01T00:00:00.000Z'));
		expect(deleteExpiredEvents(db, now)).toBe(1);
		expect(findEventByCode(db, stale.code)).toBeUndefined();
		expect(findEventByCode(db, owned.code)).toBeDefined();
		expect(findEventByCode(db, fresh.code)).toBeDefined();
		expect(deleteExpiredEvents(db, now)).toBe(0);
	});
});
```

The `createEvent(db, input, hash, accountId, now)` signature comes from Task 2 of this plan.

Append inside the describe block of `src/lib/client/tokens.test.ts` (add `clearEventTokens` to the import):

```ts
	it('clearEventTokens removes both roles for one event only', () => {
		setToken('abc', 'host', 'a'.repeat(64));
		setToken('abc', 'participant', 'b'.repeat(64));
		setToken('xyz', 'host', 'c'.repeat(64));
		clearEventTokens('abc');
		expect(getToken('abc', 'host')).toBeNull();
		expect(getToken('abc', 'participant')).toBeNull();
		expect(getToken('xyz', 'host')).toBe('c'.repeat(64));
	});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/server/events.test.ts src/lib/client/tokens.test.ts`
Expected: FAIL, functions missing.

- [ ] **Step 3: Implement the server side**

Append to `src/lib/server/events.ts` (add `isNull` to the drizzle import):

```ts
/** Removes the event and, through cascades, its options, participants, responses, points, and jobs. */
export function deleteEvent(db: DbLike, event: EventRow): void {
	db.delete(events).where(eq(events.id, event.id)).run();
}

/** Deletes events past their expiry that no account owns. Returns how many were removed. */
export function deleteExpiredEvents(db: DbLike, now = new Date()): number {
	return db
		.delete(events)
		.where(and(lte(events.expiresAt, now.toISOString()), isNull(events.accountId)))
		.run().changes;
}
```

In `src/hooks.server.ts`, import `deleteExpiredEvents` and call it inside the tick after `closeDueEvents(db)`.

Add to `src/routes/api/events/[code]/+server.ts`:

```ts
export const DELETE: RequestHandler = ({ params, request, locals }) => {
	try {
		const db = getDb();
		const event = loadEventOr404(db, params.code);
		requireHost(event, request, locals.accountId);
		deleteEvent(db, event);
		return new Response(null, { status: 204 });
	} catch (e) {
		raise(e);
	}
};
```

(with `deleteEvent` added to the events import).

Append to `src/lib/client/tokens.ts`:

```ts
/** Forgets both roles for an event, after the host deletes it. */
export function clearEventTokens(code: string): void {
	try {
		localStorage.removeItem(key(code, 'host'));
		localStorage.removeItem(key(code, 'participant'));
	} catch {
		// Nothing stored, nothing to forget.
	}
}
```

- [ ] **Step 4: Add the dialog and the button**

Create `src/lib/components/DeleteDialog.svelte`:

```svelte
<script lang="ts">
	let { onconfirm }: { onconfirm: () => Promise<boolean> } = $props();

	let dialog: HTMLDialogElement | undefined = $state();
	let busy = $state(false);
	let failed = $state(false);

	export function open() {
		failed = false;
		dialog?.showModal();
	}

	async function confirm() {
		busy = true;
		failed = false;
		try {
			const ok = await onconfirm();
			if (ok) dialog?.close();
			else failed = true;
		} finally {
			busy = false;
		}
	}
</script>

<dialog bind:this={dialog} aria-labelledby="delete-dialog-title">
	<h2 id="delete-dialog-title" style="margin-top:0">Delete this event?</h2>
	<p>Everything is removed, including the report.</p>
	<div class="stack">
		<button type="button" class="btn-block btn-danger" disabled={busy} onclick={confirm}>Delete</button>
		<button type="button" class="btn-block" disabled={busy} onclick={() => dialog?.close()}>Go back</button>
	</div>
	{#if failed}
		<p class="error" role="alert">Could not delete. Check your connection and try again.</p>
	{/if}
</dialog>
```

In `src/lib/components/HostView.svelte`: import `DeleteDialog`, `clearEventTokens` from `$lib/client/tokens`, and add state `let deleteDialog: ReturnType<typeof DeleteDialog> | undefined = $state();` plus:

```ts
	async function remove(): Promise<boolean> {
		try {
			await api(`/api/events/${code}`, { method: 'DELETE', code });
			clearEventTokens(code);
			await goto(resolve('/'));
			return true;
		} catch {
			return false;
		}
	}
```

At the very end of the markup (after the CloseDialog block) add, so it renders in every host state:

```svelte
{#if host}
	<button type="button" class="btn-block btn-danger" style="margin-top:32px" onclick={() => deleteDialog?.open()}>
		Delete event
	</button>
	<DeleteDialog bind:this={deleteDialog} onconfirm={remove} />
{/if}
```

`api()` with `method: 'DELETE'` and a 204 response: `res.json()` would throw on an empty body, so in `src/lib/client/api.ts` return `undefined as T` when `res.status === 204`.

- [ ] **Step 5: Write the end-to-end checks**

Append to the `events API` describe block in `e2e/api.e2e.ts`:

```ts
	test('the host can delete the event, after which the link is gone', async ({ request }) => {
		const hostToken = token();
		const code = await createEventApi(request, hostToken);
		expect((await request.delete(`/api/events/${code}`)).status()).toBe(403);
		expect((await request.delete(`/api/events/${code}`, { headers: { 'x-host-token': hostToken } })).status()).toBe(204);
		expect((await request.get(`/api/events/${code}`)).status()).toBe(404);
	});
```

Append to `e2e/host.e2e.ts` inside its describe block (it already imports `createEventApi`, `openAsHost`, `token`):

```ts
	test('deleting from the host view lands on the home page and kills the link', async ({ browser, request }) => {
		const hostToken = token();
		const code = await createEventApi(request, hostToken);
		const { page, context } = await openAsHost(browser, code, hostToken);
		await page.getByRole('button', { name: 'Delete event' }).click();
		await expect(page.getByRole('dialog')).toContainText('including the report');
		await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
		await expect(page).toHaveURL(/\/$/);
		await page.goto(`/e/${code}`);
		await expect(page.getByText('This event does not exist.')).toBeVisible();
		await context.close();
	});
```

- [ ] **Step 6: Run every gate**

Run: `npm run lint && npm run check && npx vitest run && npm run test:e2e`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/events.ts src/lib/server/events.test.ts src/hooks.server.ts "src/routes/api/events/[code]/+server.ts" src/lib/client/tokens.ts src/lib/client/tokens.test.ts src/lib/client/api.ts src/lib/components/DeleteDialog.svelte src/lib/components/HostView.svelte e2e/api.e2e.ts e2e/host.e2e.ts
git commit -m "Let the host delete an event and sweep expired unowned events"
```

---

### Task 5: QR code and share sheet on the link card

**Files:**
- Create: `src/lib/client/qr.ts`
- Modify: `src/lib/components/LinkCard.svelte`
- Modify: `src/lib/components/LinkScreen.svelte`
- Modify: `src/lib/components/HostView.svelte`
- Modify: `src/app.css`
- Modify: `package.json` (`qrcode`, `@types/qrcode`)
- Test: `src/lib/client/qr.test.ts`
- Test: `e2e/create.e2e.ts`

**Interfaces:**
- Produces: `qrSvg(text): Promise<string>`; `LinkCard` takes a `title` prop and shows the QR code and, when the browser offers it, a Share button.

- [ ] **Step 1: Install**

Run: `npm install qrcode@^1.5.4 && npm install -D @types/qrcode@^1.5.6`

- [ ] **Step 2: Write the failing test**

Create `src/lib/client/qr.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { qrSvg } from './qr';

describe('qrSvg', () => {
	it('renders an inline SVG for the link', async () => {
		const svg = await qrSvg('https://decision-maker-cb.fly.dev/e/abcdefghjk');
		expect(svg.startsWith('<svg')).toBe(true);
		expect(svg).toContain('viewBox');
		expect(svg).not.toContain('<script');
	});
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/lib/client/qr.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 4: Implement**

Create `src/lib/client/qr.ts`:

```ts
import QRCode from 'qrcode';

/** An SVG string for the text, generated locally so the link never leaves the device to be drawn. */
export function qrSvg(text: string): Promise<string> {
	return QRCode.toString(text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
}
```

Replace `src/lib/components/LinkCard.svelte` with:

```svelte
<script lang="ts">
	import { onMount } from 'svelte';
	import { qrSvg } from '$lib/client/qr';

	let { code, title }: { code: string; title: string } = $props();

	const url = $derived(`${location.origin}/e/${code}`);
	let input: HTMLInputElement | undefined = $state();
	let status = $state<'idle' | 'copied' | 'failed'>('idle');
	let svg = $state('');
	const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

	onMount(async () => {
		svg = await qrSvg(url);
	});

	async function copy() {
		try {
			await navigator.clipboard.writeText(url);
			status = 'copied';
		} catch {
			input?.select();
			status = 'failed';
		}
	}

	async function share() {
		try {
			await navigator.share({ title, url });
		} catch {
			// Cancelled or unavailable; the link and QR code remain.
		}
	}
</script>

<div class="card">
	<label for="event-link">Share this link</label>
	<input id="event-link" bind:this={input} readonly value={url} onfocus={(e) => e.currentTarget.select()} />
	<div class="actions">
		<button type="button" onclick={copy}>{status === 'copied' ? 'Copied' : 'Copy link'}</button>
		{#if canShare}
			<button type="button" onclick={share}>Share</button>
		{/if}
	</div>
	{#if status === 'failed'}
		<p class="small error" role="alert">
			Copying is not available here, so the link is selected for you to copy by hand.
		</p>
	{/if}
	{#if svg}
		<div class="qr" data-testid="qr">{@html svg}</div>
	{/if}
</div>
```

Keep whatever the current `LinkCard.svelte` does for the copy fallback if it differs from the above in wording; the wording in the file today is the source of truth for that message.

In `src/lib/components/LinkScreen.svelte` pass the title: `<LinkCard {code} {title} />`. In `src/lib/components/HostView.svelte` pass `title={event.title}`.

Append to `src/app.css`:

```css
.qr {
	margin: 12px auto 0;
	width: 160px;
}

.qr svg {
	display: block;
	width: 100%;
	height: auto;
	background: #fff;
	padding: 6px;
	border-radius: 6px;
}
```

- [ ] **Step 5: Extend the end-to-end test**

In `e2e/create.e2e.ts`, in the first test right after the `Share this link` value assertion, add:

```ts
		await expect(page.getByTestId('qr').locator('svg')).toBeVisible();
```

- [ ] **Step 6: Run every gate**

Run: `npm run lint && npm run check && npx vitest run && npm run test:e2e`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/client/qr.ts src/lib/client/qr.test.ts src/lib/components/LinkCard.svelte src/lib/components/LinkScreen.svelte src/lib/components/HostView.svelte src/app.css e2e/create.e2e.ts
git commit -m "Show a QR code and the share sheet on the link card"
```
