# DecisionMaker Phase 1 Implementation Plan: Walking Skeleton

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed, always-on DecisionMaker where a host creates an event with costed options and shares one link, participants rank the options with vetoes and a private budget limit from device-locked browsers, the host approves names and closes submissions, and the host then sees suppressed tallies, all verified by a Playwright harness, with the fake-provider seam in place for Phase 2.

**Architecture:** One SvelteKit application serves the mobile web pages and a JSON API from a single Node process, with all state in one SQLite file managed by Drizzle migrations. Roles are resolved from 256-bit tokens held in browser storage and sent as request headers, never from URLs. The event page is a client-rendered view that fetches a role-aware view model, so the same link shows the host view on the creating device and the participant view everywhere else. Aggregates are computed by pure code at close time and stored frozen on the event row.

**Tech Stack:** Node 24, SvelteKit 2 with Svelte 5 runes and adapter-node, TypeScript, Drizzle ORM 0.45 over better-sqlite3 13, zod 4, Vitest 4, Playwright 1.6x, Docker, Fly.io, Litestream.

**Spec:** `docs/superpowers/specs/2026-09-17-decision-maker-design.md`. Section numbers below refer to it.

## Global Constraints

Copied from the spec. Every task's requirements implicitly include this section.

- Title at most 80 characters, context at most 200, option label at most 80, option note at most 120, between 2 and 12 options, cost a non-negative number with at most two decimals, currency an ISO 4217 code from the fixed list in `src/lib/shared/constants.ts`.
- Name at most 40 characters, opinion at most 2,000, suggestion at most 200, ranking requires at least one ranked option.
- Event codes are ten characters from the alphabet `0123456789abcdefghjkmnpqrstvwxyz`.
- Tokens are 256-bit random values as 64 lowercase hex characters, stored only as SHA-256 hex, sent in the headers `x-host-token` and `x-participant-token`, never in URLs, never logged, compared in constant time.
- Below five approved responses no per-option breakdown is shown to anyone. Any cost count below three is never displayed, and zero, one, and two are rendered identically (nothing).
- Closing is final. There is no reopen. After the roster is final the roster is read-only.
- Roster rows carry no timestamps and are sorted by name.
- While open the host sees only the submitted count, never per-option numbers.
- The host's own response is auto-approved.
- Rate limits: 10 submissions per minute per IP per event, 20 event creations per hour per IP.
- Each event expires 90 days after creation (publish changes this in Phase 2).
- No API route returns a response row to anyone but the participant who wrote it. The only read-all function lives in `src/lib/server/analysis/responses.ts`.
- UI copy is sentence case, no exclamation marks, no em dashes anywhere in the repo, and commit messages carry no co-author line.
- Every task ends green on `npm run lint`, `npm run check`, and `npm run test:unit -- --run`. Tasks that add e2e tests also end green on `npm run test:e2e`.
- Never kill processes with `taskkill /IM node.exe`; stop servers by PID.

## File Structure

```
.gitattributes                               LF line endings for every text file
.env.example                                 DATABASE_URL, ORIGIN, ALLOW_FAKE_PROVIDER
package.json                                 scripts: dev, build, start, check, lint, format, test:unit, test:e2e, db:generate
vite.config.ts                               SvelteKit plugin, adapter-node, Vitest project (scaffolded)
playwright.config.ts                         e2e dir, phone viewport, webServer = node build on 4173
drizzle.config.ts                            sqlite dialect, schema path (scaffolded)
drizzle/                                     generated SQL migrations, committed
src/app.html                                 document shell (scaffolded)
src/app.css                                  design tokens and base styles
src/hooks.server.ts                          init: open db and start auto-close tick; handle: security headers
src/lib/shared/constants.ts                  limits, rules, currency list, code alphabet
src/lib/shared/types.ts                      view models and aggregate types shared by server and client
src/lib/shared/validation.ts                 zod schemas shared by server and client
src/lib/shared/money.ts                      currency formatting
src/lib/server/db/index.ts                   openDatabase, getDb, Db and DbLike types
src/lib/server/db/schema.ts                  the nine tables
src/lib/server/crypto.ts                     sha256Hex, safeEqualHex, isTokenShape, newEventCode, newId
src/lib/server/errors.ts                     AppError and constructors
src/lib/server/http.ts                       readJson, raise
src/lib/server/events.ts                     event and option repository
src/lib/server/participants.ts               participant repository, write-only responses for routes
src/lib/server/close.ts                      finalizeRoster
src/lib/server/roles.ts                      token header parsing, isHost, requireHost, participantFromRequest
src/lib/server/ratelimit.ts                  in-memory sliding window limiter
src/lib/server/views.ts                      buildEventPageView, loadEventOr404
src/lib/server/analysis/responses.ts         readApprovedResponses (the only read-all)
src/lib/server/analysis/aggregate.ts         stage 2 math and presentTallies
src/lib/server/analysis/provider.ts          ModelProvider interface and registry
src/lib/server/analysis/fake.ts              fake provider
src/lib/client/tokens.ts                     localStorage token store
src/lib/client/api.ts                        fetch wrapper that attaches token headers
src/lib/components/PrivacyNotice.svelte
src/lib/components/RankingWidget.svelte
src/lib/components/BudgetChips.svelte
src/lib/components/ResponseForm.svelte
src/lib/components/SubmittedCard.svelte
src/lib/components/ParticipantView.svelte
src/lib/components/LinkCard.svelte
src/lib/components/LinkScreen.svelte
src/lib/components/Roster.svelte
src/lib/components/TalliesView.svelte
src/lib/components/CloseDialog.svelte
src/lib/components/HostView.svelte
src/routes/+layout.svelte                    imports app.css
src/routes/+page.svelte                      home: create event
src/routes/e/[code]/+page.ts                 ssr = false
src/routes/e/[code]/+page.svelte             event page: fetch view, pick host or participant view
src/routes/api/health/+server.ts
src/routes/api/events/+server.ts             POST create
src/routes/api/events/[code]/+server.ts      GET view, PATCH closesAt
src/routes/api/events/[code]/responses/+server.ts             POST submit, PUT edit
src/routes/api/events/[code]/participants/[id]/+server.ts     PATCH status
src/routes/api/events/[code]/roster/approve-all/+server.ts    POST
src/routes/api/events/[code]/close/+server.ts                 POST
e2e/reset-db.mjs                             deletes the e2e database before the server starts
e2e/helpers.ts                               API and browser helpers
e2e/api.e2e.ts                               API-level scenarios
e2e/create.e2e.ts, participant.e2e.ts, host.e2e.ts, story.e2e.ts, device-lock.e2e.ts, suppression.e2e.ts, autoclose.e2e.ts
deploy/Dockerfile, deploy/entrypoint.sh, deploy/litestream.yml, fly.toml, .dockerignore
.github/workflows/ci.yml
```

Unit tests sit next to the file they test as `*.test.ts`. End-to-end tests live in `e2e/` as `*.e2e.ts`.

---

### Task 1: Scaffold the project in place

**Files:**

- Create (scaffolded): `package.json`, `vite.config.ts`, `tsconfig.json`, `drizzle.config.ts`, `eslint.config.js`, `prettier.config.js`, `.prettierignore`, `.npmrc`, `src/app.html`, `src/app.d.ts`, `src/routes/+layout.svelte`, `src/routes/+page.svelte`, `src/lib/server/db/index.ts`, `src/lib/server/db/schema.ts`, `static/robots.txt`
- Create: `.gitattributes`, `playwright.config.ts` (replace scaffolded), `e2e/reset-db.mjs`, `README.md` (replace scaffolded), `.env.example` (replace scaffolded), `.env`
- Modify: `.gitignore` (scaffolder overwrites it), `package.json`
- Delete: `src/routes/demo/`, `src/lib/vitest-examples/`, `src/lib/index.ts`

**Interfaces:**

- Produces: the npm scripts `dev`, `build`, `start`, `check`, `lint`, `format`, `test:unit`, `test:e2e`, `db:generate` that every later task runs.

- [ ] **Step 1: Run the scaffolder inside the repo**

Run from `N:\decision-maker`:

```bash
npx --yes sv@0.17.0 create . --template minimal --types ts --add prettier eslint vitest="usages:unit" playwright drizzle="database:sqlite+client:better-sqlite3" sveltekit-adapter="adapter:node" --no-download-check --no-dir-check --install npm
```

Expected: the output ends with `Project created`, `Successfully setup add-ons: prettier, eslint, vitest, playwright, sveltekit-adapter, drizzle`, and `You're all set!`. The existing `CLAUDE.md`, `docs/`, and `.git` are untouched. `.gitignore` is overwritten by the scaffolder.

- [ ] **Step 2: Delete the demo files**

```bash
rm -rf src/routes/demo src/lib/vitest-examples src/lib/index.ts
```

- [ ] **Step 3: Restore the ignore rules and add line-ending normalization**

Append to `.gitignore`:

```
# DecisionMaker
data/
e2e/.tmp/
.superpowers/
playwright-report/
```

Create `.gitattributes`:

```
* text=auto eol=lf
*.png binary
*.jpg binary
*.ico binary
```

- [ ] **Step 4: Set the package identity and scripts**

In `package.json` set `"name": "decision-maker"`, add an `engines` block, add a `start` script, and change `test:e2e` so it does not download browsers on every run. The relevant parts of the file must read:

```json
{
	"name": "decision-maker",
	"private": true,
	"version": "0.1.0",
	"type": "module",
	"engines": {
		"node": ">=24"
	},
	"scripts": {
		"dev": "vite dev",
		"build": "vite build",
		"start": "node build",
		"preview": "vite preview",
		"prepare": "svelte-kit sync || echo ''",
		"check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
		"check:watch": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json --watch",
		"lint": "prettier --check . && eslint .",
		"format": "prettier --write .",
		"test:unit": "vitest",
		"test": "npm run test:unit -- --run && npm run test:e2e",
		"test:e2e": "playwright test",
		"db:push": "drizzle-kit push",
		"db:generate": "drizzle-kit generate",
		"db:migrate": "drizzle-kit migrate",
		"db:studio": "drizzle-kit studio"
	}
}
```

Keep the scaffolded `devDependencies` and `dependencies` exactly as generated, then add zod:

```bash
npm install zod@^4
```

- [ ] **Step 5: Write the environment files**

Replace `.env.example` with:

```
# Path of the SQLite file. Created on first start.
DATABASE_URL=data/dev.db
# Public origin of the app, used for absolute links.
ORIGIN=http://localhost:5173
# Set to 1 to allow the fake model provider (dev, tests, demos only).
ALLOW_FAKE_PROVIDER=1
```

Create `.env` with the same content. `.env` is ignored by git.

- [ ] **Step 6: Replace the Playwright config**

Replace `playwright.config.ts` with:

```ts
import { defineConfig } from '@playwright/test';

const port = 4173;

export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/*.e2e.ts',
	fullyParallel: false,
	workers: 1,
	timeout: 30_000,
	expect: { timeout: 5_000 },
	reporter: [['list'], ['html', { open: 'never' }]],
	use: {
		baseURL: `http://localhost:${port}`,
		browserName: 'chromium',
		viewport: { width: 390, height: 844 },
		deviceScaleFactor: 3,
		isMobile: true,
		hasTouch: true,
		screenshot: 'only-on-failure',
		trace: 'retain-on-failure'
	},
	webServer: {
		command: 'node e2e/reset-db.mjs && npm run build && node build',
		port,
		reuseExistingServer: false,
		timeout: 180_000,
		env: {
			PORT: String(port),
			ORIGIN: `http://localhost:${port}`,
			DATABASE_URL: 'e2e/.tmp/e2e.db',
			ALLOW_FAKE_PROVIDER: '1',
			NODE_ENV: 'production'
		}
	}
});
```

Create `e2e/reset-db.mjs`:

```js
import { mkdirSync, rmSync } from 'node:fs';

mkdirSync('e2e/.tmp', { recursive: true });
for (const name of ['e2e.db', 'e2e.db-wal', 'e2e.db-shm']) {
	rmSync(`e2e/.tmp/${name}`, { force: true });
}
```

- [ ] **Step 7: Replace the README**

Replace `README.md` with:

````markdown
# DecisionMaker

A small web app that helps a group make a decision without anyone stepping on anyone's toes.
A host creates an event with options and shares one link.
Participants rank the options, set a private budget limit, and write an opinion.
A language model rewrites every opinion to strip out who wrote it, then produces a report with the best option, runner-up, worst, unexpected option, charts, and anonymized themes.

The design lives in `docs/superpowers/specs/2026-09-17-decision-maker-design.md`.

## Develop

```sh
npm install
npx playwright install chromium
cp .env.example .env
npm run dev
```
````

## Check

```sh
npm run lint
npm run check
npm run test:unit -- --run
npm run test:e2e
```

The end-to-end suite builds the app, starts it on port 4173 with a fresh SQLite file under `e2e/.tmp/`, and drives it in a phone-sized Chromium.

## Database

Schema changes go in `src/lib/server/db/schema.ts`, then `npm run db:generate` writes a migration into `drizzle/`.
Migrations run automatically when the server starts.

````

- [ ] **Step 8: Install browsers, format, and verify**

```bash
npx playwright install chromium
npm run format
npm run lint
npm run check
npx vitest run --passWithNoTests
npm run build
````

Expected: `lint` prints no style issues, `check` ends with `0 ERRORS 0 WARNINGS`, vitest reports no test files without failing, and `build` finishes without errors.

Smoke test the production build in a second shell, then stop it by PID:

```bash
PORT=4190 ORIGIN=http://localhost:4190 DATABASE_URL=data/smoke.db node build & echo $! > .smoke.pid
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4190/
kill $(cat .smoke.pid); rm .smoke.pid
```

Expected: `200`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Scaffold SvelteKit app with Drizzle, Vitest, and Playwright"
```

---

### Task 2: Shared types, schema, database module, and health route

**Files:**

- Create: `src/lib/shared/types.ts`
- Create: `src/lib/server/db/schema.ts` (replace scaffolded)
- Create: `src/lib/server/db/index.ts` (replace scaffolded)
- Create: `src/lib/server/db/db.test.ts`
- Create: `src/routes/api/health/+server.ts`
- Create: `drizzle/0000_*.sql` and `drizzle/meta/*` (generated)

**Interfaces:**

- Produces: `openDatabase(url, migrationsFolder?) => Db`, `getDb() => Db`, types `Db`, `Tx`, `DbLike`, the table objects `accounts`, `magicLinks`, `sessions`, `events`, `options`, `participants`, `responses`, `anonymizedPoints`, `analysisJobs`, row types `EventRow`, `OptionRow`, `ParticipantRow`, `ResponseRow`, and every type in `src/lib/shared/types.ts`.

- [ ] **Step 1: Write the shared types**

Create `src/lib/shared/types.ts`:

```ts
export type EventState = 'open' | 'closed' | 'published';
export type ParticipantStatus = 'pending' | 'approved' | 'rejected';
export type PointType = 'reason' | 'condition' | 'constraint' | 'suggestion' | 'cost';
export type Budget = { kind: 'limit'; amount: number } | { kind: 'no_limit' } | null;

export type OptionCount = { optionId: string; count: number };
/** ranks[i] is how many approved participants ranked the option at position i + 1. */
export type RankRow = { optionId: string; ranks: number[]; unranked: number };
export type BordaRow = { optionId: string; score: number };
export type CostAggregateRow = { optionId: string; cost: number; overBudget: number };

/** Raw aggregates, computed at close and stored on the event. Never sent to a client as is. */
export type Aggregates = {
	approvedCount: number;
	firstChoice: OptionCount[];
	rankMatrix: RankRow[];
	vetoes: OptionCount[];
	borda: BordaRow[];
	condorcetWinner: string | null;
	cost: { answered: number; rows: CostAggregateRow[] } | null;
};

/** A cost count is null whenever it is below the display threshold. */
export type CostRow = { optionId: string; cost: number; overBudget: number | null };

/** Aggregates after the suppression rules. This is what hosts and reports see. */
export type PresentedTallies = {
	approvedCount: number;
	breakdown: null | {
		firstChoice: OptionCount[];
		rankMatrix: RankRow[];
		vetoes: OptionCount[];
		borda: BordaRow[];
		condorcetWinner: string | null;
		cost: null | { answered: number | null; rows: CostRow[] };
	};
};

export type OptionView = { id: string; label: string; note: string; cost: number | null };

export type EventView = {
	code: string;
	title: string;
	context: string;
	currency: string;
	state: EventState;
	rosterFinal: boolean;
	closesAt: string | null;
	closedAt: string | null;
	options: OptionView[];
};

export type MineView = {
	name: string;
	ranking: string[];
	vetoes: string[];
	budget: Budget;
	opinion: string;
	suggestion: string;
};

export type RosterRow = { id: string; name: string; status: ParticipantStatus; duplicate: boolean };

export type HostView = {
	submittedCount: number;
	pendingCount: number;
	roster: RosterRow[];
	tallies: PresentedTallies | null;
};

export type EventPageView = {
	role: 'host' | 'participant';
	event: EventView;
	mine: MineView | null;
	host: HostView | null;
};
```

- [ ] **Step 2: Write the schema**

Replace `src/lib/server/db/schema.ts` with:

```ts
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { Aggregates, EventState, ParticipantStatus, PointType } from '../../shared/types';

export const accounts = sqliteTable('accounts', {
	id: text('id').primaryKey(),
	email: text('email').notNull().unique(),
	createdAt: text('created_at').notNull()
});

export const magicLinks = sqliteTable('magic_links', {
	tokenHash: text('token_hash').primaryKey(),
	email: text('email').notNull(),
	expiresAt: text('expires_at').notNull(),
	usedAt: text('used_at')
});

export const sessions = sqliteTable('sessions', {
	tokenHash: text('token_hash').primaryKey(),
	accountId: text('account_id')
		.notNull()
		.references(() => accounts.id, { onDelete: 'cascade' }),
	expiresAt: text('expires_at').notNull()
});

export const events = sqliteTable('events', {
	id: text('id').primaryKey(),
	code: text('code').notNull().unique(),
	title: text('title').notNull(),
	context: text('context').notNull().default(''),
	currency: text('currency').notNull(),
	state: text('state').$type<EventState>().notNull().default('open'),
	rosterFinal: integer('roster_final', { mode: 'boolean' }).notNull().default(false),
	hostTokenHash: text('host_token_hash').notNull(),
	accountId: text('account_id').references(() => accounts.id, { onDelete: 'set null' }),
	closesAt: text('closes_at'),
	closedAt: text('closed_at'),
	publishedAt: text('published_at'),
	expiresAt: text('expires_at').notNull(),
	provider: text('provider'),
	model: text('model'),
	promptVersion: text('prompt_version'),
	aggregates: text('aggregates', { mode: 'json' }).$type<Aggregates>(),
	report: text('report', { mode: 'json' }).$type<unknown>(),
	createdAt: text('created_at').notNull()
});

export const options = sqliteTable(
	'options',
	{
		id: text('id').primaryKey(),
		eventId: text('event_id')
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		position: integer('position').notNull(),
		label: text('label').notNull(),
		note: text('note').notNull().default(''),
		costPerPerson: real('cost_per_person')
	},
	(t) => [index('options_event_idx').on(t.eventId)]
);

export const participants = sqliteTable(
	'participants',
	{
		id: text('id').primaryKey(),
		eventId: text('event_id')
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		displayName: text('display_name').notNull(),
		deviceTokenHash: text('device_token_hash').notNull(),
		status: text('status').$type<ParticipantStatus>().notNull().default('pending'),
		createdAt: text('created_at').notNull()
	},
	(t) => [uniqueIndex('participants_event_device_idx').on(t.eventId, t.deviceTokenHash)]
);

export const responses = sqliteTable('responses', {
	participantId: text('participant_id')
		.primaryKey()
		.references(() => participants.id, { onDelete: 'cascade' }),
	ranking: text('ranking', { mode: 'json' }).$type<string[]>().notNull(),
	vetoes: text('vetoes', { mode: 'json' }).$type<string[]>().notNull(),
	budgetKind: text('budget_kind').$type<'limit' | 'no_limit'>(),
	budgetAmount: real('budget_amount'),
	opinion: text('opinion').notNull().default(''),
	suggestion: text('suggestion').notNull().default(''),
	updatedAt: text('updated_at').notNull()
});

export const anonymizedPoints = sqliteTable(
	'anonymized_points',
	{
		id: text('id').primaryKey(),
		eventId: text('event_id')
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		participantId: text('participant_id')
			.notNull()
			.references(() => participants.id, { onDelete: 'cascade' }),
		text: text('text').notNull(),
		type: text('type').$type<PointType>().notNull(),
		optionIds: text('option_ids', { mode: 'json' }).$type<string[]>().notNull(),
		model: text('model').notNull()
	},
	(t) => [index('anonymized_points_event_idx').on(t.eventId)]
);

export const analysisJobs = sqliteTable('analysis_jobs', {
	id: text('id').primaryKey(),
	eventId: text('event_id')
		.notNull()
		.references(() => events.id, { onDelete: 'cascade' }),
	status: text('status').$type<'running' | 'succeeded' | 'failed'>().notNull(),
	stage: text('stage'),
	done: integer('done').notNull().default(0),
	total: integer('total').notNull().default(0),
	error: text('error'),
	startedAt: text('started_at').notNull(),
	finishedAt: text('finished_at')
});

export type EventRow = typeof events.$inferSelect;
export type OptionRow = typeof options.$inferSelect;
export type ParticipantRow = typeof participants.$inferSelect;
export type ResponseRow = typeof responses.$inferSelect;
```

The schema imports types with a relative path on purpose: `drizzle-kit` loads this file outside Vite and cannot resolve `$lib`.

- [ ] **Step 3: Write the database module**

Replace `src/lib/server/db/index.ts` with:

```ts
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Repository functions accept either the database or a transaction handle. */
export type DbLike = Db | Tx;

/** Opens (creating if needed) a SQLite database in WAL mode and applies pending migrations. */
export function openDatabase(url: string, migrationsFolder = 'drizzle'): Db {
	if (url !== ':memory:') mkdirSync(dirname(url), { recursive: true });
	const client = new Database(url);
	client.pragma('journal_mode = WAL');
	client.pragma('foreign_keys = ON');
	client.pragma('busy_timeout = 5000');
	const db = drizzle(client, { schema });
	migrate(db, { migrationsFolder });
	return db;
}

let instance: Db | undefined;

/** The process-wide database, opened lazily from DATABASE_URL. */
export function getDb(): Db {
	if (!instance) {
		const url = process.env.DATABASE_URL;
		if (!url) throw new Error('DATABASE_URL is not set');
		instance = openDatabase(url);
	}
	return instance;
}
```

- [ ] **Step 4: Generate the first migration**

```bash
npm run db:generate
```

Expected: `9 tables` listed and `Your SQL migration file ➜ drizzle\0000_<three words>.sql`. The folder `drizzle/` now holds that SQL file and `meta/0000_snapshot.json` plus `meta/_journal.json`. Commit all of them.

- [ ] **Step 5: Write the failing database test**

Create `src/lib/server/db/db.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { openDatabase } from './index';
import { participants } from './schema';

const expectedTables = [
	'accounts',
	'magic_links',
	'sessions',
	'events',
	'options',
	'participants',
	'responses',
	'anonymized_points',
	'analysis_jobs'
];

describe('openDatabase', () => {
	it('migrates every table into a fresh database', () => {
		const db = openDatabase(':memory:');
		const rows = db.all<{ name: string }>(
			sql`select name from sqlite_master where type = 'table' order by name`
		);
		const names = rows.map((r) => r.name);
		for (const table of expectedTables) expect(names).toContain(table);
	});

	it('enforces foreign keys', () => {
		const db = openDatabase(':memory:');
		expect(() =>
			db
				.insert(participants)
				.values({
					id: 'p1',
					eventId: 'missing',
					displayName: 'Alex',
					deviceTokenHash: 'x',
					createdAt: new Date().toISOString()
				})
				.run()
		).toThrow(/FOREIGN KEY/);
	});
});
```

- [ ] **Step 6: Run the test**

```bash
npx vitest run src/lib/server/db
```

Expected: both tests pass. If the migration step was skipped the first test fails with a missing table, which is the failure this test exists to catch.

- [ ] **Step 7: Add the health route**

Create `src/routes/api/health/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';

export const GET: RequestHandler = () => {
	getDb().get(sql`select 1`);
	return json({ ok: true });
};
```

- [ ] **Step 8: Verify and commit**

```bash
npm run format && npm run lint && npm run check && npx vitest run
git add -A
git commit -m "Add shared types, database schema, first migration, and health route"
```

---

### Task 3: Shared constants, validation schemas, and money formatting

**Files:**

- Create: `src/lib/shared/constants.ts`
- Create: `src/lib/shared/validation.ts`
- Create: `src/lib/shared/validation.test.ts`
- Create: `src/lib/shared/money.ts`
- Create: `src/lib/shared/money.test.ts`

**Interfaces:**

- Produces: `CURRENCIES`, `LIMITS`, `RULES`, `EVENT_CODE_ALPHABET`, `EVENT_CODE_LENGTH`, `EVENT_TTL_DAYS`; zod schemas `createEventInput`, `optionInput`, `responseInput`, `editResponseInput`, `closeInput`, `patchEventInput`, `participantStatusInput`; inferred types `CreateEventInput`, `ResponseInput`, `EditResponseInput`; `checkOptionRefs(ranking, vetoes, optionIds) => string | null`; `formatMoney(amount, currency, locale?) => string`.

- [ ] **Step 1: Write the constants**

Create `src/lib/shared/constants.ts`:

```ts
export const CURRENCIES = [
	'EUR',
	'USD',
	'GBP',
	'CHF',
	'SEK',
	'NOK',
	'DKK',
	'PLN',
	'CZK',
	'HUF',
	'JPY',
	'AUD',
	'CAD',
	'NZD',
	'MXN',
	'BRL',
	'INR',
	'CNY',
	'ZAR',
	'AED'
] as const;
export type Currency = (typeof CURRENCIES)[number];

export const LIMITS = {
	title: 80,
	context: 200,
	optionLabel: 80,
	optionNote: 120,
	minOptions: 2,
	maxOptions: 12,
	name: 40,
	opinion: 2000,
	suggestion: 200,
	maxCost: 1_000_000
} as const;

export const RULES = {
	/** Below this many approved responses, no per-option breakdown is shown to anyone. */
	minBreakdownResponses: 5,
	/** Cost counts below this are never displayed. */
	minCostCount: 3
} as const;

export const EVENT_CODE_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
export const EVENT_CODE_LENGTH = 10;
export const TOKEN_HEX_LENGTH = 64;
export const EVENT_TTL_DAYS = 90;
```

- [ ] **Step 2: Write the failing validation tests**

Create `src/lib/shared/validation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { checkOptionRefs, createEventInput, editResponseInput, responseInput } from './validation';

const validEvent = {
	title: 'Saturday night',
	context: '',
	currency: 'EUR',
	options: [
		{ label: 'Tapas', note: '', cost: 25 },
		{ label: 'Beach', note: 'bring towels', cost: null }
	],
	closesAt: null
};

describe('createEventInput', () => {
	it('accepts a valid event and applies defaults', () => {
		const result = createEventInput.safeParse({
			title: '  Saturday night ',
			currency: 'EUR',
			options: [{ label: 'Tapas' }, { label: 'Beach' }]
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.title).toBe('Saturday night');
			expect(result.data.context).toBe('');
			expect(result.data.options[0]).toEqual({ label: 'Tapas', note: '', cost: null });
			expect(result.data.closesAt).toBeNull();
		}
	});

	it('rejects fewer than two options', () => {
		const result = createEventInput.safeParse({ ...validEvent, options: [validEvent.options[0]] });
		expect(result.success).toBe(false);
	});

	it('rejects more than two decimals in a cost', () => {
		const result = createEventInput.safeParse({
			...validEvent,
			options: [{ label: 'A', cost: 12.345 }, { label: 'B' }]
		});
		expect(result.success).toBe(false);
	});

	it('rejects an unknown currency', () => {
		expect(createEventInput.safeParse({ ...validEvent, currency: 'XXX' }).success).toBe(false);
	});

	it('rejects a title over 80 characters', () => {
		expect(createEventInput.safeParse({ ...validEvent, title: 'x'.repeat(81) }).success).toBe(
			false
		);
	});
});

describe('responseInput', () => {
	it('requires a name and at least one ranked option', () => {
		expect(responseInput.safeParse({ name: '', ranking: ['a'] }).success).toBe(false);
		expect(responseInput.safeParse({ name: 'Alex', ranking: [] }).success).toBe(false);
	});

	it('applies defaults for the optional fields', () => {
		const result = responseInput.safeParse({ name: 'Alex', ranking: ['a'] });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual({
				name: 'Alex',
				ranking: ['a'],
				vetoes: [],
				budget: null,
				opinion: '',
				suggestion: ''
			});
		}
	});

	it('accepts both budget shapes', () => {
		expect(
			responseInput.safeParse({ name: 'A', ranking: ['a'], budget: { kind: 'limit', amount: 30 } })
				.success
		).toBe(true);
		expect(
			responseInput.safeParse({ name: 'A', ranking: ['a'], budget: { kind: 'no_limit' } }).success
		).toBe(true);
		expect(
			responseInput.safeParse({ name: 'A', ranking: ['a'], budget: { kind: 'limit' } }).success
		).toBe(false);
	});

	it('caps the opinion at 2000 characters', () => {
		expect(
			responseInput.safeParse({ name: 'A', ranking: ['a'], opinion: 'x'.repeat(2001) }).success
		).toBe(false);
	});

	it('edit input has no name', () => {
		const result = editResponseInput.safeParse({ name: 'ignored', ranking: ['a'] });
		expect(result.success).toBe(true);
		if (result.success) expect('name' in result.data).toBe(false);
	});
});

describe('checkOptionRefs', () => {
	it('returns null for a clean ranking', () => {
		expect(checkOptionRefs(['a', 'b'], ['c'], ['a', 'b', 'c'])).toBeNull();
	});

	it('flags repeats and unknown ids', () => {
		expect(checkOptionRefs(['a', 'a'], [], ['a', 'b'])).toMatch(/repeats/);
		expect(checkOptionRefs(['a', 'z'], [], ['a', 'b'])).toMatch(/unknown/);
		expect(checkOptionRefs(['a'], ['z'], ['a', 'b'])).toMatch(/unknown/);
	});
});
```

- [ ] **Step 3: Run the tests to see them fail**

```bash
npx vitest run src/lib/shared/validation.test.ts
```

Expected: FAIL, `Cannot find module './validation'`.

- [ ] **Step 4: Write the validation module**

Create `src/lib/shared/validation.ts`:

```ts
import { z } from 'zod';
import { CURRENCIES, LIMITS } from './constants';

const trimmed = (max: number) => z.string().trim().max(max, `At most ${max} characters`);

const twoDecimals = (n: number) => Math.round(n * 100) / 100 === n;

export const money = z
	.number()
	.min(0, 'Cost cannot be negative')
	.max(LIMITS.maxCost, 'Cost is too large')
	.refine(twoDecimals, 'Use at most two decimals');

const isoInstant = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Not a valid date');

export const optionInput = z.object({
	label: trimmed(LIMITS.optionLabel).min(1, 'Every option needs a label'),
	note: trimmed(LIMITS.optionNote).default(''),
	cost: money.nullable().default(null)
});

export const createEventInput = z.object({
	title: trimmed(LIMITS.title).min(1, 'Enter a title'),
	context: trimmed(LIMITS.context).default(''),
	currency: z.enum(CURRENCIES, 'Pick a currency'),
	options: z
		.array(optionInput)
		.min(LIMITS.minOptions, 'Add at least two options')
		.max(LIMITS.maxOptions, `At most ${LIMITS.maxOptions} options`),
	closesAt: isoInstant.nullable().default(null)
});

export const budgetInput = z
	.union([
		z.object({ kind: z.literal('limit'), amount: money }),
		z.object({ kind: z.literal('no_limit') })
	])
	.nullable();

export const responseInput = z.object({
	name: trimmed(LIMITS.name).min(1, 'Enter your name'),
	ranking: z.array(z.string().min(1)).min(1, 'Rank at least one option').max(LIMITS.maxOptions),
	vetoes: z.array(z.string().min(1)).max(LIMITS.maxOptions).default([]),
	budget: budgetInput.default(null),
	opinion: trimmed(LIMITS.opinion).default(''),
	suggestion: trimmed(LIMITS.suggestion).default('')
});

export const editResponseInput = responseInput.omit({ name: true });

export const closeInput = z.object({ pending: z.enum(['approve', 'reject']) });

export const patchEventInput = z.object({ closesAt: isoInstant.nullable() });

export const participantStatusInput = z.object({ status: z.enum(['approved', 'rejected']) });

export type CreateEventInput = z.infer<typeof createEventInput>;
export type ResponseInput = z.infer<typeof responseInput>;
export type EditResponseInput = z.infer<typeof editResponseInput>;

/** Returns a problem description, or null when every id refers to a known option exactly once. */
export function checkOptionRefs(
	ranking: string[],
	vetoes: string[],
	optionIds: string[]
): string | null {
	const known = new Set(optionIds);
	if (new Set(ranking).size !== ranking.length) return 'Ranking repeats an option';
	if (ranking.some((id) => !known.has(id))) return 'Ranking refers to an unknown option';
	if (vetoes.some((id) => !known.has(id))) return 'Veto refers to an unknown option';
	return null;
}
```

- [ ] **Step 5: Run the validation tests**

```bash
npx vitest run src/lib/shared/validation.test.ts
```

Expected: all pass.

- [ ] **Step 6: Write the failing money test**

Create `src/lib/shared/money.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatMoney } from './money';

describe('formatMoney', () => {
	it('drops the decimals for whole amounts', () => {
		expect(formatMoney(25, 'EUR', 'en')).toBe('€25');
	});

	it('keeps two decimals otherwise', () => {
		expect(formatMoney(12.5, 'USD', 'en')).toBe('$12.50');
	});

	it('handles zero-decimal currencies', () => {
		expect(formatMoney(1500, 'JPY', 'en')).toBe('¥1,500');
	});
});
```

- [ ] **Step 7: Write the money module**

Create `src/lib/shared/money.ts`:

```ts
/** Formats an amount in the event's currency, hiding decimals for whole numbers. */
export function formatMoney(amount: number, currency: string, locale?: string): string {
	const whole = Number.isInteger(amount);
	return new Intl.NumberFormat(locale, {
		style: 'currency',
		currency,
		minimumFractionDigits: whole ? 0 : 2,
		maximumFractionDigits: whole ? 0 : 2
	}).format(amount);
}
```

- [ ] **Step 8: Run, verify, and commit**

```bash
npx vitest run src/lib/shared
npm run format && npm run lint && npm run check
git add -A
git commit -m "Add shared constants, validation schemas, and money formatting"
```

---

### Task 4: Server crypto, errors, and HTTP helpers

**Files:**

- Create: `src/lib/server/crypto.ts`
- Create: `src/lib/server/crypto.test.ts`
- Create: `src/lib/server/errors.ts`
- Create: `src/lib/server/http.ts`

**Interfaces:**

- Produces: `sha256Hex(input) => string`, `safeEqualHex(a, b) => boolean`, `isTokenShape(value) => value is string`, `newEventCode() => string`, `newId() => string`; `class AppError extends Error { status: number }` with constructors `badRequest`, `forbidden`, `notFound`, `conflict`, `tooMany`; `readJson(request, schema) => Promise<T>` and `raise(e) => never`.

- [ ] **Step 1: Write the failing crypto test**

Create `src/lib/server/crypto.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EVENT_CODE_ALPHABET, EVENT_CODE_LENGTH } from '$lib/shared/constants';
import { isTokenShape, newEventCode, newId, safeEqualHex, sha256Hex } from './crypto';

describe('sha256Hex', () => {
	it('hashes deterministically to 64 hex characters', () => {
		const a = sha256Hex('hello');
		expect(a).toMatch(/^[0-9a-f]{64}$/);
		expect(sha256Hex('hello')).toBe(a);
		expect(sha256Hex('hello!')).not.toBe(a);
	});
});

describe('safeEqualHex', () => {
	it('compares equal-length strings and rejects mismatched lengths', () => {
		expect(safeEqualHex('abcd', 'abcd')).toBe(true);
		expect(safeEqualHex('abcd', 'abce')).toBe(false);
		expect(safeEqualHex('abcd', 'abc')).toBe(false);
		expect(safeEqualHex('', '')).toBe(false);
	});
});

describe('isTokenShape', () => {
	it('accepts only 64 lowercase hex characters', () => {
		expect(isTokenShape('a'.repeat(64))).toBe(true);
		expect(isTokenShape('A'.repeat(64))).toBe(false);
		expect(isTokenShape('a'.repeat(63))).toBe(false);
		expect(isTokenShape(null)).toBe(false);
	});
});

describe('newEventCode', () => {
	it('uses only the code alphabet at the right length and does not repeat', () => {
		const codes = new Set<string>();
		for (let i = 0; i < 200; i++) {
			const code = newEventCode();
			expect(code).toHaveLength(EVENT_CODE_LENGTH);
			for (const ch of code) expect(EVENT_CODE_ALPHABET).toContain(ch);
			codes.add(code);
		}
		expect(codes.size).toBe(200);
	});
});

describe('newId', () => {
	it('returns a uuid', () => {
		expect(newId()).toMatch(/^[0-9a-f-]{36}$/);
	});
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
npx vitest run src/lib/server/crypto.test.ts
```

Expected: FAIL, `Cannot find module './crypto'`.

- [ ] **Step 3: Write the crypto module**

Create `src/lib/server/crypto.ts`:

```ts
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { EVENT_CODE_ALPHABET, EVENT_CODE_LENGTH } from '$lib/shared/constants';

export function sha256Hex(input: string): string {
	return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Constant-time comparison of two strings of equal length. Unequal lengths are simply false. */
export function safeEqualHex(a: string, b: string): boolean {
	if (a.length === 0 || a.length !== b.length) return false;
	return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export function isTokenShape(value: string | null | undefined): value is string {
	return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/** Ten characters from a 32-symbol alphabet: 32 divides 256, so a byte maps evenly. */
export function newEventCode(): string {
	const bytes = randomBytes(EVENT_CODE_LENGTH);
	let out = '';
	for (const b of bytes) out += EVENT_CODE_ALPHABET[b % EVENT_CODE_ALPHABET.length];
	return out;
}

export function newId(): string {
	return crypto.randomUUID();
}
```

- [ ] **Step 4: Run the crypto tests**

```bash
npx vitest run src/lib/server/crypto.test.ts
```

Expected: all pass.

- [ ] **Step 5: Write the errors module**

Create `src/lib/server/errors.ts`:

```ts
/** An error that maps directly to an HTTP status. The message is safe to show to the caller. */
export class AppError extends Error {
	constructor(
		public readonly status: number,
		message: string
	) {
		super(message);
		this.name = 'AppError';
	}
}

export const badRequest = (message: string) => new AppError(400, message);
export const forbidden = (message: string) => new AppError(403, message);
export const notFound = (message: string) => new AppError(404, message);
export const conflict = (message: string) => new AppError(409, message);
export const tooMany = (message: string) => new AppError(429, message);
```

- [ ] **Step 6: Write the HTTP helpers**

Create `src/lib/server/http.ts`:

```ts
import { error } from '@sveltejs/kit';
import type { z } from 'zod';
import { AppError, badRequest } from './errors';

/** Parses a JSON body against a schema. Throws a 400 AppError with the first issue's message. */
export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw badRequest('Body must be JSON');
	}
	const result = schema.safeParse(body);
	if (!result.success) throw badRequest(result.error.issues[0]?.message ?? 'Invalid input');
	return result.data;
}

/** Converts an AppError into a SvelteKit HTTP error and rethrows anything else. */
export function raise(e: unknown): never {
	if (e instanceof AppError) error(e.status, e.message);
	throw e;
}
```

- [ ] **Step 7: Verify and commit**

```bash
npm run format && npm run lint && npm run check && npx vitest run
git add -A
git commit -m "Add server crypto, error types, and HTTP helpers"
```

---

### Task 5: Event repository

**Files:**

- Create: `src/lib/server/events.ts`
- Create: `src/lib/server/events.test.ts`
- Create: `src/lib/server/test-utils.ts`

**Interfaces:**

- Consumes: `Db`, `DbLike`, `events`, `options`, `EventRow`, `OptionRow` (Task 2); `newEventCode`, `newId`, `conflict`, `notFound` (Task 4); `CreateEventInput` (Task 3).
- Produces: `createEvent(db: Db, input: CreateEventInput, hostTokenHash: string, now?: Date) => EventRow`, `getEventById(db: DbLike, id) => EventRow`, `findEventByCode(db: DbLike, code) => EventRow | undefined`, `listOptions(db: DbLike, eventId) => OptionRow[]`, `setClosesAt(db: DbLike, event, closesAt: string | null) => EventRow`, `stopSubmissions(db: DbLike, event, now?) => EventRow`, `closeDueEvents(db: DbLike, now?) => number`, `refreshState(db: DbLike, event, now?) => EventRow`, `toEventView(event, options) => EventView`, `toIso(value) => string`, `addDays(date, days) => Date`. Test helpers `makeDb()`, `makeEvent(db, overrides?)`, `response(name, ranking, extra?)`, `HOST_HASH`.

- [ ] **Step 1: Write the test helpers**

Create `src/lib/server/test-utils.ts`:

```ts
import { openDatabase, type Db } from './db';
import type { EventRow } from './db/schema';
import { createEvent } from './events';
import type { CreateEventInput, ResponseInput } from '$lib/shared/validation';

export const HOST_HASH = 'a'.repeat(64);

export function makeDb(): Db {
	return openDatabase(':memory:');
}

/** An event with four options: Tapas 25, Beach 15, Rooftop 45, Paella with no cost. */
export function makeEvent(db: Db, overrides: Partial<CreateEventInput> = {}): EventRow {
	return createEvent(
		db,
		{
			title: 'Saturday night',
			context: '',
			currency: 'EUR',
			options: [
				{ label: 'Tapas', note: '', cost: 25 },
				{ label: 'Beach', note: '', cost: 15 },
				{ label: 'Rooftop', note: '', cost: 45 },
				{ label: 'Paella', note: '', cost: null }
			],
			closesAt: null,
			...overrides
		},
		HOST_HASH
	);
}

export function response(
	name: string,
	ranking: string[],
	extra: Partial<ResponseInput> = {}
): ResponseInput {
	return { name, ranking, vetoes: [], budget: null, opinion: '', suggestion: '', ...extra };
}
```

- [ ] **Step 2: Write the failing event tests**

Create `src/lib/server/events.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EVENT_CODE_ALPHABET } from '$lib/shared/constants';
import { openDatabase } from './db';
import {
	closeDueEvents,
	createEvent,
	findEventByCode,
	listOptions,
	refreshState,
	setClosesAt,
	stopSubmissions,
	toEventView
} from './events';

const input = {
	title: 'Saturday night',
	context: 'Dinner',
	currency: 'EUR' as const,
	options: [
		{ label: 'Tapas', note: '', cost: 25 },
		{ label: 'Beach', note: 'towels', cost: null }
	],
	closesAt: null
};
const hash = 'a'.repeat(64);

describe('createEvent', () => {
	it('stores the event with a code, ordered options, and a 90-day expiry', () => {
		const db = openDatabase(':memory:');
		const now = new Date('2026-09-17T10:00:00.000Z');
		const event = createEvent(db, input, hash, now);
		expect(event.code).toHaveLength(10);
		for (const ch of event.code) expect(EVENT_CODE_ALPHABET).toContain(ch);
		expect(event.state).toBe('open');
		expect(event.rosterFinal).toBe(false);
		expect(event.hostTokenHash).toBe(hash);
		expect(event.expiresAt).toBe('2026-12-16T10:00:00.000Z');
		const opts = listOptions(db, event.id);
		expect(opts.map((o) => o.label)).toEqual(['Tapas', 'Beach']);
		expect(opts.map((o) => o.costPerPerson)).toEqual([25, null]);
		expect(findEventByCode(db, event.code)?.id).toBe(event.id);
	});

	it('normalizes closesAt to a UTC instant', () => {
		const db = openDatabase(':memory:');
		const event = createEvent(db, { ...input, closesAt: '2026-09-18T12:00:00+02:00' }, hash);
		expect(event.closesAt).toBe('2026-09-18T10:00:00.000Z');
	});
});

describe('setClosesAt', () => {
	it('updates while open and refuses once closed', () => {
		const db = openDatabase(':memory:');
		let event = createEvent(db, input, hash);
		event = setClosesAt(db, event, '2026-09-18T10:00:00.000Z');
		expect(event.closesAt).toBe('2026-09-18T10:00:00.000Z');
		event = setClosesAt(db, event, null);
		expect(event.closesAt).toBeNull();
		event = stopSubmissions(db, event);
		expect(() => setClosesAt(db, event, null)).toThrow(/already closed/);
	});
});

describe('auto-close', () => {
	it('closes only events whose deadline has passed and leaves the roster open', () => {
		const db = openDatabase(':memory:');
		const now = new Date('2026-09-17T10:00:00.000Z');
		const due = createEvent(db, { ...input, closesAt: '2026-09-17T09:59:00.000Z' }, hash, now);
		const later = createEvent(db, { ...input, closesAt: '2026-09-17T10:01:00.000Z' }, hash, now);
		const never = createEvent(db, input, hash, now);
		expect(closeDueEvents(db, now)).toBe(1);
		const closed = findEventByCode(db, due.code);
		expect(closed?.state).toBe('closed');
		expect(closed?.closedAt).toBe(now.toISOString());
		expect(closed?.rosterFinal).toBe(false);
		expect(findEventByCode(db, later.code)?.state).toBe('open');
		expect(findEventByCode(db, never.code)?.state).toBe('open');
		expect(closeDueEvents(db, now)).toBe(0);
	});

	it('refreshState closes lazily on read', () => {
		const db = openDatabase(':memory:');
		const event = createEvent(db, { ...input, closesAt: '2026-09-17T09:59:00.000Z' }, hash);
		expect(refreshState(db, event, new Date('2026-09-17T09:58:00.000Z')).state).toBe('open');
		expect(refreshState(db, event, new Date('2026-09-17T10:00:00.000Z')).state).toBe('closed');
	});
});

describe('toEventView', () => {
	it('exposes only public fields', () => {
		const db = openDatabase(':memory:');
		const event = createEvent(db, input, hash);
		const view = toEventView(event, listOptions(db, event.id));
		expect(Object.keys(view).sort()).toEqual([
			'closedAt',
			'closesAt',
			'code',
			'context',
			'currency',
			'options',
			'rosterFinal',
			'state',
			'title'
		]);
		expect(view.options[0]).toEqual({ id: expect.any(String), label: 'Tapas', note: '', cost: 25 });
	});
});
```

- [ ] **Step 3: Run it to see it fail**

```bash
npx vitest run src/lib/server/events.test.ts
```

Expected: FAIL, `Cannot find module './events'`.

- [ ] **Step 4: Write the event repository**

Create `src/lib/server/events.ts`:

```ts
import { and, asc, eq, lte } from 'drizzle-orm';
import type { Db, DbLike } from './db';
import { events, options, type EventRow, type OptionRow } from './db/schema';
import { newEventCode, newId } from './crypto';
import { conflict, notFound } from './errors';
import { EVENT_TTL_DAYS } from '$lib/shared/constants';
import type { EventView } from '$lib/shared/types';
import type { CreateEventInput } from '$lib/shared/validation';

export function addDays(date: Date, days: number): Date {
	return new Date(date.getTime() + days * 86_400_000);
}

/** Normalizes any parseable date string to a UTC ISO instant so string comparison is chronological. */
export function toIso(value: string): string {
	return new Date(value).toISOString();
}

export function createEvent(
	db: Db,
	input: CreateEventInput,
	hostTokenHash: string,
	now = new Date()
): EventRow {
	const id = newId();
	const code = newEventCode();
	db.transaction((tx) => {
		tx.insert(events)
			.values({
				id,
				code,
				title: input.title,
				context: input.context,
				currency: input.currency,
				hostTokenHash,
				closesAt: input.closesAt ? toIso(input.closesAt) : null,
				expiresAt: addDays(now, EVENT_TTL_DAYS).toISOString(),
				createdAt: now.toISOString()
			})
			.run();
		tx.insert(options)
			.values(
				input.options.map((o, position) => ({
					id: newId(),
					eventId: id,
					position,
					label: o.label,
					note: o.note,
					costPerPerson: o.cost
				}))
			)
			.run();
	});
	return getEventById(db, id);
}

export function getEventById(db: DbLike, id: string): EventRow {
	const row = db.select().from(events).where(eq(events.id, id)).get();
	if (!row) throw notFound('Event not found');
	return row;
}

export function findEventByCode(db: DbLike, code: string): EventRow | undefined {
	return db.select().from(events).where(eq(events.code, code)).get();
}

export function listOptions(db: DbLike, eventId: string): OptionRow[] {
	return db
		.select()
		.from(options)
		.where(eq(options.eventId, eventId))
		.orderBy(asc(options.position))
		.all();
}

export function setClosesAt(db: DbLike, event: EventRow, closesAt: string | null): EventRow {
	if (event.state !== 'open') throw conflict('Submissions are already closed');
	db.update(events)
		.set({ closesAt: closesAt ? toIso(closesAt) : null })
		.where(eq(events.id, event.id))
		.run();
	return getEventById(db, event.id);
}

/** Stops accepting submissions without finalizing the roster. Used by auto-close and by the close endpoint. */
export function stopSubmissions(db: DbLike, event: EventRow, now = new Date()): EventRow {
	if (event.state !== 'open') return event;
	db.update(events)
		.set({ state: 'closed', closedAt: now.toISOString() })
		.where(and(eq(events.id, event.id), eq(events.state, 'open')))
		.run();
	return getEventById(db, event.id);
}

/** Closes every open event whose auto-close time has passed. Returns how many it closed. */
export function closeDueEvents(db: DbLike, now = new Date()): number {
	const due = db
		.select()
		.from(events)
		.where(and(eq(events.state, 'open'), lte(events.closesAt, now.toISOString())))
		.all();
	for (const event of due) stopSubmissions(db, event, now);
	return due.length;
}

/** Applies a passed auto-close deadline on read, so it is honoured even between timer ticks. */
export function refreshState(db: DbLike, event: EventRow, now = new Date()): EventRow {
	if (event.state === 'open' && event.closesAt && event.closesAt <= now.toISOString()) {
		return stopSubmissions(db, event, now);
	}
	return event;
}

export function toEventView(event: EventRow, opts: OptionRow[]): EventView {
	return {
		code: event.code,
		title: event.title,
		context: event.context,
		currency: event.currency,
		state: event.state,
		rosterFinal: event.rosterFinal,
		closesAt: event.closesAt,
		closedAt: event.closedAt,
		options: opts.map((o) => ({ id: o.id, label: o.label, note: o.note, cost: o.costPerPerson }))
	};
}
```

- [ ] **Step 5: Run the tests, verify, commit**

```bash
npx vitest run src/lib/server/events.test.ts
npm run format && npm run lint && npm run check && npx vitest run
git add -A
git commit -m "Add event repository with auto-close and view mapping"
```

Expected: all event tests pass.

---

### Task 6: Participant repository and the single read-all function

**Files:**

- Create: `src/lib/server/participants.ts`
- Create: `src/lib/server/participants.test.ts`
- Create: `src/lib/server/analysis/responses.ts`

**Interfaces:**

- Consumes: Task 2 tables and row types, Task 3 `checkOptionRefs`, `ResponseInput`, `EditResponseInput`, Task 4 errors, Task 5 helpers.
- Produces: `findParticipantByDevice(db, eventId, deviceTokenHash) => ParticipantRow | undefined`, `getParticipant(db, id) => ParticipantRow`, `submitResponse(db: Db, event, optionIds, deviceTokenHash, input: ResponseInput, opts: { autoApprove: boolean; now?: Date }) => ParticipantRow`, `updateResponse(db, event, optionIds, participant, input: EditResponseInput, now?) => void`, `getMine(db, participant) => MineView`, `listRoster(db, eventId) => RosterRow[]`, `setParticipantStatus(db, event, participantId, status) => void`, `approveAllPending(db, event) => number`, `resolvePending(db, eventId, status) => number`, `countSubmitted(db, eventId) => number`, `countByStatus(db, eventId, status) => number`, `toBudget(kind, amount) => Budget`; and `readApprovedResponses(db, eventId) => ApprovedResponse[]` with `ApprovedResponse = { participantId; ranking; vetoes; budget; opinion; suggestion }`.

- [ ] **Step 1: Write the failing participant tests**

Create `src/lib/server/participants.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { events } from './db/schema';
import { listOptions, stopSubmissions } from './events';
import {
	approveAllPending,
	countByStatus,
	countSubmitted,
	findParticipantByDevice,
	getMine,
	listRoster,
	setParticipantStatus,
	submitResponse,
	updateResponse
} from './participants';
import { readApprovedResponses } from './analysis/responses';
import { makeDb, makeEvent, response } from './test-utils';

const device = (n: number) => n.toString(16).padStart(64, '0');

function setup() {
	const db = makeDb();
	const event = makeEvent(db);
	const ids = listOptions(db, event.id).map((o) => o.id);
	return { db, event, ids };
}

describe('submitResponse', () => {
	it('creates a pending participant with the response', () => {
		const { db, event, ids } = setup();
		const p = submitResponse(
			db,
			event,
			ids,
			device(1),
			response('Alex', [ids[0], ids[1]], {
				vetoes: [ids[3]],
				budget: { kind: 'limit', amount: 30 },
				opinion: 'Tapas is central',
				suggestion: 'Flamenco'
			}),
			{ autoApprove: false }
		);
		expect(p.status).toBe('pending');
		expect(p.displayName).toBe('Alex');
		expect(findParticipantByDevice(db, event.id, device(1))?.id).toBe(p.id);
		expect(getMine(db, p)).toEqual({
			name: 'Alex',
			ranking: [ids[0], ids[1]],
			vetoes: [ids[3]],
			budget: { kind: 'limit', amount: 30 },
			opinion: 'Tapas is central',
			suggestion: 'Flamenco'
		});
	});

	it('auto-approves when asked', () => {
		const { db, event, ids } = setup();
		const p = submitResponse(db, event, ids, device(1), response('Host', [ids[0]]), {
			autoApprove: true
		});
		expect(p.status).toBe('approved');
	});

	it('refuses a second submission from the same device', () => {
		const { db, event, ids } = setup();
		submitResponse(db, event, ids, device(1), response('Alex', [ids[0]]), { autoApprove: false });
		expect(() =>
			submitResponse(db, event, ids, device(1), response('Alex again', [ids[0]]), {
				autoApprove: false
			})
		).toThrow(/already submitted/);
	});

	it('refuses unknown or repeated option ids', () => {
		const { db, event, ids } = setup();
		expect(() =>
			submitResponse(db, event, ids, device(1), response('Alex', ['nope']), { autoApprove: false })
		).toThrow(/unknown option/);
		expect(() =>
			submitResponse(db, event, ids, device(2), response('Sam', [ids[0], ids[0]]), {
				autoApprove: false
			})
		).toThrow(/repeats/);
	});

	it('refuses once submissions are closed', () => {
		const { db, ids } = setup();
		const event = stopSubmissions(db, makeEvent(db));
		expect(() =>
			submitResponse(db, event, ids, device(1), response('Alex', [ids[0]]), { autoApprove: false })
		).toThrow(/closed/);
	});
});

describe('updateResponse', () => {
	it('changes the response in place while open and refuses after close', () => {
		const { db, event, ids } = setup();
		const p = submitResponse(db, event, ids, device(1), response('Alex', [ids[0]]), {
			autoApprove: false
		});
		updateResponse(db, event, ids, p, {
			ranking: [ids[1], ids[0]],
			vetoes: [],
			budget: { kind: 'no_limit' },
			opinion: 'Changed my mind',
			suggestion: ''
		});
		expect(getMine(db, p)).toMatchObject({
			name: 'Alex',
			ranking: [ids[1], ids[0]],
			budget: { kind: 'no_limit' },
			opinion: 'Changed my mind'
		});
		const closed = stopSubmissions(db, event);
		expect(() =>
			updateResponse(db, closed, ids, p, {
				ranking: [ids[0]],
				vetoes: [],
				budget: null,
				opinion: '',
				suggestion: ''
			})
		).toThrow(/closed/);
	});
});

describe('roster', () => {
	it('lists names sorted case-insensitively with duplicate markers and no timestamps', () => {
		const { db, event, ids } = setup();
		submitResponse(db, event, ids, device(1), response('zoe', [ids[0]]), { autoApprove: false });
		submitResponse(db, event, ids, device(2), response('Alex', [ids[0]]), { autoApprove: false });
		submitResponse(db, event, ids, device(3), response('alex ', [ids[0]]), { autoApprove: false });
		const roster = listRoster(db, event.id);
		expect(roster.map((r) => r.name)).toEqual(['Alex', 'alex', 'zoe']);
		expect(roster.map((r) => r.duplicate)).toEqual([true, true, false]);
		expect(Object.keys(roster[0]).sort()).toEqual(['duplicate', 'id', 'name', 'status']);
	});

	it('approves and rejects individually and in bulk while the roster is open', () => {
		const { db, event, ids } = setup();
		const a = submitResponse(db, event, ids, device(1), response('A', [ids[0]]), {
			autoApprove: false
		});
		submitResponse(db, event, ids, device(2), response('B', [ids[0]]), { autoApprove: false });
		submitResponse(db, event, ids, device(3), response('C', [ids[0]]), { autoApprove: false });
		setParticipantStatus(db, event, a.id, 'rejected');
		expect(countByStatus(db, event.id, 'rejected')).toBe(1);
		expect(approveAllPending(db, event)).toBe(2);
		expect(countByStatus(db, event.id, 'approved')).toBe(2);
		expect(countByStatus(db, event.id, 'pending')).toBe(0);
		expect(countSubmitted(db, event.id)).toBe(3);
		expect(() => setParticipantStatus(db, event, 'missing', 'approved')).toThrow(/not found/);
	});

	it('refuses status changes once the roster is final, even from a stale snapshot', () => {
		const { db, event, ids } = setup();
		const a = submitResponse(db, event, ids, device(1), response('A', [ids[0]]), {
			autoApprove: false
		});
		db.update(events).set({ rosterFinal: true }).where(eq(events.id, event.id)).run();
		expect(() => setParticipantStatus(db, event, a.id, 'approved')).toThrow(/final/);
		expect(() => approveAllPending(db, event)).toThrow(/final/);
		expect(countByStatus(db, event.id, 'pending')).toBe(1);
	});
});

describe('readApprovedResponses', () => {
	it('returns approved responses only, with budgets mapped', () => {
		const { db, event, ids } = setup();
		const a = submitResponse(
			db,
			event,
			ids,
			device(1),
			response('A', [ids[0]], { budget: { kind: 'limit', amount: 20 }, opinion: 'cheap' }),
			{ autoApprove: false }
		);
		submitResponse(db, event, ids, device(2), response('B', [ids[1]]), { autoApprove: false });
		setParticipantStatus(db, event, a.id, 'approved');
		const rows = readApprovedResponses(db, event.id);
		expect(rows).toEqual([
			{
				participantId: a.id,
				ranking: [ids[0]],
				vetoes: [],
				budget: { kind: 'limit', amount: 20 },
				opinion: 'cheap',
				suggestion: ''
			}
		]);
	});
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
npx vitest run src/lib/server/participants.test.ts
```

Expected: FAIL, `Cannot find module './participants'`.

- [ ] **Step 3: Write the participant repository**

Create `src/lib/server/participants.ts`:

```ts
import { and, asc, count, eq, sql } from 'drizzle-orm';
import type { Db, DbLike } from './db';
import { participants, responses, type EventRow, type ParticipantRow } from './db/schema';
import { newId } from './crypto';
import { badRequest, conflict, notFound } from './errors';
import { getEventById } from './events';
import type { Budget, MineView, ParticipantStatus, RosterRow } from '$lib/shared/types';
import {
	checkOptionRefs,
	type EditResponseInput,
	type ResponseInput
} from '$lib/shared/validation';

export function toBudget(kind: 'limit' | 'no_limit' | null, amount: number | null): Budget {
	if (kind === 'limit') return { kind: 'limit', amount: amount ?? 0 };
	if (kind === 'no_limit') return { kind: 'no_limit' };
	return null;
}

export function findParticipantByDevice(
	db: DbLike,
	eventId: string,
	deviceTokenHash: string
): ParticipantRow | undefined {
	return db
		.select()
		.from(participants)
		.where(
			and(eq(participants.eventId, eventId), eq(participants.deviceTokenHash, deviceTokenHash))
		)
		.get();
}

export function getParticipant(db: DbLike, id: string): ParticipantRow {
	const row = db.select().from(participants).where(eq(participants.id, id)).get();
	if (!row) throw notFound('Participant not found');
	return row;
}

function responseColumns(input: EditResponseInput, nowIso: string) {
	return {
		ranking: input.ranking,
		vetoes: input.vetoes,
		budgetKind: input.budget?.kind ?? null,
		budgetAmount: input.budget?.kind === 'limit' ? input.budget.amount : null,
		opinion: input.opinion,
		suggestion: input.suggestion,
		updatedAt: nowIso
	};
}

export function submitResponse(
	db: Db,
	event: EventRow,
	optionIds: string[],
	deviceTokenHash: string,
	input: ResponseInput,
	opts: { autoApprove: boolean; now?: Date }
): ParticipantRow {
	if (event.state !== 'open') throw conflict('Submissions are closed');
	const problem = checkOptionRefs(input.ranking, input.vetoes, optionIds);
	if (problem) throw badRequest(problem);
	if (findParticipantByDevice(db, event.id, deviceTokenHash)) {
		throw conflict('This device already submitted');
	}
	const id = newId();
	const nowIso = (opts.now ?? new Date()).toISOString();
	db.transaction((tx) => {
		tx.insert(participants)
			.values({
				id,
				eventId: event.id,
				displayName: input.name.trim(),
				deviceTokenHash,
				status: opts.autoApprove ? 'approved' : 'pending',
				createdAt: nowIso
			})
			.run();
		tx.insert(responses)
			.values({ participantId: id, ...responseColumns(input, nowIso) })
			.run();
	});
	return getParticipant(db, id);
}

export function updateResponse(
	db: DbLike,
	event: EventRow,
	optionIds: string[],
	participant: ParticipantRow,
	input: EditResponseInput,
	now = new Date()
): void {
	if (event.state !== 'open') throw conflict('Submissions are closed');
	const problem = checkOptionRefs(input.ranking, input.vetoes, optionIds);
	if (problem) throw badRequest(problem);
	db.update(responses)
		.set(responseColumns(input, now.toISOString()))
		.where(eq(responses.participantId, participant.id))
		.run();
}

/** The participant's own submission. The only path that returns response data to a client. */
export function getMine(db: DbLike, participant: ParticipantRow): MineView {
	const row = db.select().from(responses).where(eq(responses.participantId, participant.id)).get();
	if (!row) throw notFound('Response not found');
	return {
		name: participant.displayName,
		ranking: row.ranking,
		vetoes: row.vetoes,
		budget: toBudget(row.budgetKind, row.budgetAmount),
		opinion: row.opinion,
		suggestion: row.suggestion
	};
}

/** Names and statuses only, sorted by name, with no timestamps. */
export function listRoster(db: DbLike, eventId: string): RosterRow[] {
	const rows = db
		.select({ id: participants.id, name: participants.displayName, status: participants.status })
		.from(participants)
		.where(eq(participants.eventId, eventId))
		.orderBy(
			sql`lower(${participants.displayName})`,
			asc(participants.displayName),
			asc(participants.id)
		)
		.all();
	const seen = new Map<string, number>();
	for (const r of rows) {
		const key = r.name.trim().toLowerCase();
		seen.set(key, (seen.get(key) ?? 0) + 1);
	}
	return rows.map((r) => ({
		...r,
		duplicate: (seen.get(r.name.trim().toLowerCase()) ?? 0) > 1
	}));
}

export function setParticipantStatus(
	db: DbLike,
	event: EventRow,
	participantId: string,
	status: 'approved' | 'rejected'
): void {
	if (getEventById(db, event.id).rosterFinal) throw conflict('The roster is final');
	const result = db
		.update(participants)
		.set({ status })
		.where(and(eq(participants.id, participantId), eq(participants.eventId, event.id)))
		.run();
	if (result.changes === 0) throw notFound('Participant not found');
}

export function approveAllPending(db: DbLike, event: EventRow): number {
	if (getEventById(db, event.id).rosterFinal) throw conflict('The roster is final');
	return resolvePending(db, event.id, 'approved');
}

/** Moves every pending participant to the given status. Used by approve-all and by finalizeRoster. */
export function resolvePending(
	db: DbLike,
	eventId: string,
	status: 'approved' | 'rejected'
): number {
	return db
		.update(participants)
		.set({ status })
		.where(and(eq(participants.eventId, eventId), eq(participants.status, 'pending')))
		.run().changes;
}

export function countByStatus(db: DbLike, eventId: string, status: ParticipantStatus): number {
	return (
		db
			.select({ n: count() })
			.from(participants)
			.where(and(eq(participants.eventId, eventId), eq(participants.status, status)))
			.get()?.n ?? 0
	);
}

export function countSubmitted(db: DbLike, eventId: string): number {
	return (
		db.select({ n: count() }).from(participants).where(eq(participants.eventId, eventId)).get()
			?.n ?? 0
	);
}
```

- [ ] **Step 4: Write the read-all function**

Create `src/lib/server/analysis/responses.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import type { DbLike } from '../db';
import { participants, responses } from '../db/schema';
import { toBudget } from '../participants';
import type { Budget } from '$lib/shared/types';

export type ApprovedResponse = {
	participantId: string;
	ranking: string[];
	vetoes: string[];
	budget: Budget;
	opinion: string;
	suggestion: string;
};

/**
 * The only function that reads every response of an event.
 * Called by close-time aggregation and by the analysis job. Never call it from a route.
 */
export function readApprovedResponses(db: DbLike, eventId: string): ApprovedResponse[] {
	const rows = db
		.select({
			participantId: participants.id,
			ranking: responses.ranking,
			vetoes: responses.vetoes,
			budgetKind: responses.budgetKind,
			budgetAmount: responses.budgetAmount,
			opinion: responses.opinion,
			suggestion: responses.suggestion
		})
		.from(responses)
		.innerJoin(participants, eq(participants.id, responses.participantId))
		.where(and(eq(participants.eventId, eventId), eq(participants.status, 'approved')))
		.all();
	return rows.map((r) => ({
		participantId: r.participantId,
		ranking: r.ranking,
		vetoes: r.vetoes,
		budget: toBudget(r.budgetKind, r.budgetAmount),
		opinion: r.opinion,
		suggestion: r.suggestion
	}));
}
```

- [ ] **Step 5: Run the tests, verify, commit**

```bash
npx vitest run src/lib/server/participants.test.ts
npm run format && npm run lint && npm run check && npx vitest run
git add -A
git commit -m "Add participant repository and the single read-all responses function"
```

Expected: all participant tests pass.

---

### Task 7: Aggregation and suppression

**Files:**

- Create: `src/lib/server/analysis/aggregate.ts`
- Create: `src/lib/server/analysis/aggregate.test.ts`

**Interfaces:**

- Consumes: `Aggregates`, `PresentedTallies`, `Budget` (Task 2), `RULES` (Task 3).
- Produces: `aggregate(options: AggregateOption[], responses: AggregateResponse[]) => Aggregates` where `AggregateOption = { id: string; cost: number | null }` and `AggregateResponse = { ranking: string[]; vetoes: string[]; budget: Budget }`; `findCondorcetWinner(ids, responses) => string | null`; `presentTallies(agg: Aggregates) => PresentedTallies`.

- [ ] **Step 1: Write the failing aggregation tests**

Create `src/lib/server/analysis/aggregate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { aggregate, findCondorcetWinner, presentTallies } from './aggregate';
import type { Budget } from '$lib/shared/types';

const opts = [
	{ id: 'A', cost: 25 },
	{ id: 'B', cost: 15 },
	{ id: 'C', cost: 45 },
	{ id: 'D', cost: null }
];

const r = (ranking: string[], vetoes: string[] = [], budget: Budget = null) => ({
	ranking,
	vetoes,
	budget
});

const six = [
	r(['A', 'B', 'C', 'D'], [], { kind: 'limit', amount: 30 }),
	r(['A', 'C', 'B'], ['D'], { kind: 'limit', amount: 30 }),
	r(['B', 'A', 'C', 'D'], [], { kind: 'no_limit' }),
	r(['C', 'A', 'B', 'D'], [], { kind: 'limit', amount: 50 }),
	r(['A', 'B'], ['C', 'D'], { kind: 'limit', amount: 20 }),
	r(['B', 'A'])
];

describe('aggregate', () => {
	const agg = aggregate(opts, six);

	it('counts first choices in option order', () => {
		expect(agg.approvedCount).toBe(6);
		expect(agg.firstChoice).toEqual([
			{ optionId: 'A', count: 3 },
			{ optionId: 'B', count: 2 },
			{ optionId: 'C', count: 1 },
			{ optionId: 'D', count: 0 }
		]);
	});

	it('builds the rank matrix with unranked counted separately', () => {
		expect(agg.rankMatrix).toEqual([
			{ optionId: 'A', ranks: [3, 3, 0, 0], unranked: 0 },
			{ optionId: 'B', ranks: [2, 2, 2, 0], unranked: 0 },
			{ optionId: 'C', ranks: [1, 1, 2, 0], unranked: 2 },
			{ optionId: 'D', ranks: [0, 0, 0, 3], unranked: 3 }
		]);
	});

	it('counts vetoes', () => {
		expect(agg.vetoes.map((v) => v.count)).toEqual([0, 0, 1, 2]);
	});

	it('scores Borda with unranked as tied last', () => {
		expect(agg.borda).toEqual([
			{ optionId: 'A', score: 15 },
			{ optionId: 'B', score: 12 },
			{ optionId: 'C', score: 7 },
			{ optionId: 'D', score: 0 }
		]);
	});

	it('names the Condorcet winner', () => {
		expect(agg.condorcetWinner).toBe('A');
	});

	it('counts how many limits fall below each costed option', () => {
		expect(agg.cost).toEqual({
			answered: 5,
			rows: [
				{ optionId: 'A', cost: 25, overBudget: 1 },
				{ optionId: 'B', cost: 15, overBudget: 0 },
				{ optionId: 'C', cost: 45, overBudget: 3 }
			]
		});
	});

	it('has no cost block when no option has a cost', () => {
		const noCost = aggregate(
			opts.map((o) => ({ ...o, cost: null })),
			six
		);
		expect(noCost.cost).toBeNull();
	});
});

describe('findCondorcetWinner', () => {
	it('returns null for a cycle', () => {
		const cycle = [r(['A', 'B', 'C']), r(['B', 'C', 'A']), r(['C', 'A', 'B'])];
		expect(findCondorcetWinner(['A', 'B', 'C'], cycle)).toBeNull();
	});

	it('treats an unranked option as below every ranked one', () => {
		expect(findCondorcetWinner(['A', 'B'], [r(['A']), r(['A']), r(['B', 'A'])])).toBe('A');
	});
});

describe('presentTallies', () => {
	it('hides the whole breakdown below five approved responses', () => {
		const agg = aggregate(opts, six.slice(0, 4));
		expect(presentTallies(agg)).toEqual({ approvedCount: 4, breakdown: null });
	});

	it('hides cost counts below three, including zero', () => {
		const presented = presentTallies(aggregate(opts, six));
		expect(presented.breakdown?.cost).toEqual({
			answered: 5,
			rows: [
				{ optionId: 'A', cost: 25, overBudget: null },
				{ optionId: 'B', cost: 15, overBudget: null },
				{ optionId: 'C', cost: 45, overBudget: 3 }
			]
		});
	});

	it('hides the answered count when it is below three', () => {
		const few = [...six.slice(0, 2), r(['A']), r(['B']), r(['C'])];
		const presented = presentTallies(aggregate(opts, few));
		expect(presented.breakdown?.cost?.answered).toBeNull();
	});

	it('passes the other numbers through', () => {
		const presented = presentTallies(aggregate(opts, six));
		expect(presented.breakdown?.firstChoice[0]).toEqual({ optionId: 'A', count: 3 });
		expect(presented.breakdown?.condorcetWinner).toBe('A');
	});
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
npx vitest run src/lib/server/analysis/aggregate.test.ts
```

Expected: FAIL, `Cannot find module './aggregate'`.

- [ ] **Step 3: Write the aggregation module**

Create `src/lib/server/analysis/aggregate.ts`:

```ts
import { RULES } from '$lib/shared/constants';
import type { Aggregates, Budget, PresentedTallies } from '$lib/shared/types';

export type AggregateOption = { id: string; cost: number | null };
export type AggregateResponse = { ranking: string[]; vetoes: string[]; budget: Budget };

/** True when the response ranks a above b. An unranked option loses to any ranked one. */
function prefers(response: AggregateResponse, a: string, b: string): boolean {
	const ia = response.ranking.indexOf(a);
	const ib = response.ranking.indexOf(b);
	if (ia < 0) return false;
	if (ib < 0) return true;
	return ia < ib;
}

/** The option that beats every other option head to head, or null when there is none. */
export function findCondorcetWinner(ids: string[], responses: AggregateResponse[]): string | null {
	outer: for (const a of ids) {
		for (const b of ids) {
			if (a === b) continue;
			const ab = responses.filter((r) => prefers(r, a, b)).length;
			const ba = responses.filter((r) => prefers(r, b, a)).length;
			if (ab <= ba) continue outer;
		}
		return a;
	}
	return null;
}

/** Stage 2: pure arithmetic over approved responses. No model, no names. */
export function aggregate(opts: AggregateOption[], responses: AggregateResponse[]): Aggregates {
	const n = opts.length;
	const ids = opts.map((o) => o.id);

	const firstChoice = ids.map((id) => ({
		optionId: id,
		count: responses.filter((r) => r.ranking[0] === id).length
	}));

	const rankMatrix = ids.map((id) => {
		const ranks = new Array<number>(n).fill(0);
		let unranked = 0;
		for (const r of responses) {
			const i = r.ranking.indexOf(id);
			if (i < 0) unranked++;
			else ranks[i]++;
		}
		return { optionId: id, ranks, unranked };
	});

	const vetoes = ids.map((id) => ({
		optionId: id,
		count: responses.filter((r) => r.vetoes.includes(id)).length
	}));

	const borda = ids.map((id) => ({
		optionId: id,
		score: responses.reduce((sum, r) => {
			const i = r.ranking.indexOf(id);
			return sum + (i < 0 ? 0 : n - 1 - i);
		}, 0)
	}));

	const costed = opts.filter((o): o is { id: string; cost: number } => o.cost !== null);
	const cost =
		costed.length === 0
			? null
			: {
					answered: responses.filter((r) => r.budget !== null).length,
					rows: costed.map((o) => ({
						optionId: o.id,
						cost: o.cost,
						overBudget: responses.filter(
							(r) => r.budget?.kind === 'limit' && r.budget.amount < o.cost
						).length
					}))
				};

	return {
		approvedCount: responses.length,
		firstChoice,
		rankMatrix,
		vetoes,
		borda,
		condorcetWinner: findCondorcetWinner(ids, responses),
		cost
	};
}

const hideBelow = (value: number, floor: number): number | null => (value >= floor ? value : null);

/** Applies the suppression rules. Hosts and reports only ever see the result of this function. */
export function presentTallies(agg: Aggregates): PresentedTallies {
	if (agg.approvedCount < RULES.minBreakdownResponses) {
		return { approvedCount: agg.approvedCount, breakdown: null };
	}
	return {
		approvedCount: agg.approvedCount,
		breakdown: {
			firstChoice: agg.firstChoice,
			rankMatrix: agg.rankMatrix,
			vetoes: agg.vetoes,
			borda: agg.borda,
			condorcetWinner: agg.condorcetWinner,
			cost: agg.cost
				? {
						answered: hideBelow(agg.cost.answered, RULES.minCostCount),
						rows: agg.cost.rows.map((r) => ({
							optionId: r.optionId,
							cost: r.cost,
							overBudget: hideBelow(r.overBudget, RULES.minCostCount)
						}))
					}
				: null
		}
	};
}
```

- [ ] **Step 4: Run the tests, verify, commit**

```bash
npx vitest run src/lib/server/analysis/aggregate.test.ts
npm run format && npm run lint && npm run check && npx vitest run
git add -A
git commit -m "Add stage 2 aggregation and the suppression presenter"
```

Expected: all aggregation tests pass.

---

### Task 8: Finalizing the roster

**Files:**

- Create: `src/lib/server/close.ts`
- Create: `src/lib/server/close.test.ts`

**Interfaces:**

- Consumes: Task 5 `getEventById`, `listOptions`, `stopSubmissions`; Task 6 `resolvePending`, `readApprovedResponses`; Task 7 `aggregate`.
- Produces: `finalizeRoster(db: Db, event: EventRow, pending: 'approve' | 'reject', now?: Date) => EventRow`.

- [ ] **Step 1: Write the failing close tests**

Create `src/lib/server/close.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { finalizeRoster } from './close';
import { listOptions, stopSubmissions } from './events';
import {
	approveAllPending,
	countByStatus,
	setParticipantStatus,
	submitResponse
} from './participants';
import { makeDb, makeEvent, response } from './test-utils';

const device = (n: number) => n.toString(16).padStart(64, '0');

function withThree() {
	const db = makeDb();
	const event = makeEvent(db);
	const ids = listOptions(db, event.id).map((o) => o.id);
	const people = [1, 2, 3].map((n) =>
		submitResponse(db, event, ids, device(n), response(`P${n}`, [ids[n % ids.length]]), {
			autoApprove: false
		})
	);
	return { db, event, ids, people };
}

describe('finalizeRoster', () => {
	it('approves pending names, freezes aggregates, and makes the close final', () => {
		const { db, event, people } = withThree();
		setParticipantStatus(db, event, people[0].id, 'rejected');
		const now = new Date('2026-09-17T12:00:00.000Z');
		const closed = finalizeRoster(db, event, 'approve', now);
		expect(closed.state).toBe('closed');
		expect(closed.rosterFinal).toBe(true);
		expect(closed.closedAt).toBe(now.toISOString());
		expect(countByStatus(db, event.id, 'approved')).toBe(2);
		expect(countByStatus(db, event.id, 'rejected')).toBe(1);
		expect(closed.aggregates?.approvedCount).toBe(2);
	});

	it('can reject the pending names instead', () => {
		const { db, event, people } = withThree();
		setParticipantStatus(db, event, people[0].id, 'approved');
		const closed = finalizeRoster(db, event, 'reject');
		expect(countByStatus(db, event.id, 'approved')).toBe(1);
		expect(countByStatus(db, event.id, 'rejected')).toBe(2);
		expect(closed.aggregates?.approvedCount).toBe(1);
	});

	it('keeps the auto-close time when finalizing an already stopped event', () => {
		const { db, event } = withThree();
		const stoppedAt = new Date('2026-09-17T11:00:00.000Z');
		const stopped = stopSubmissions(db, event, stoppedAt);
		const closed = finalizeRoster(db, stopped, 'approve', new Date('2026-09-17T12:00:00.000Z'));
		expect(closed.closedAt).toBe(stoppedAt.toISOString());
		expect(closed.rosterFinal).toBe(true);
	});

	it('is a one-way door', () => {
		const { db, event, people } = withThree();
		const closed = finalizeRoster(db, event, 'approve');
		expect(() => finalizeRoster(db, closed, 'approve')).toThrow(/already closed/);
		expect(() => setParticipantStatus(db, closed, people[0].id, 'rejected')).toThrow(/final/);
		expect(() => approveAllPending(db, closed)).toThrow(/final/);
	});

	it('refuses a finalize made from a stale snapshot and keeps the first closedAt', () => {
		const { db, event } = withThree();
		const first = finalizeRoster(db, event, 'approve', new Date('2026-09-17T12:00:00.000Z'));
		expect(() =>
			finalizeRoster(db, event, 'approve', new Date('2026-09-17T13:00:00.000Z'))
		).toThrow(/already closed/);
		expect(getEventById(db, event.id).closedAt).toBe(first.closedAt);
		expect(getEventById(db, event.id).rosterFinal).toBe(true);
	});
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
npx vitest run src/lib/server/close.test.ts
```

Expected: FAIL, `Cannot find module './close'`.

- [ ] **Step 3: Write the close module**

Create `src/lib/server/close.ts`:

```ts
import { eq } from 'drizzle-orm';
import { aggregate } from './analysis/aggregate';
import { readApprovedResponses } from './analysis/responses';
import type { Db } from './db';
import { events, type EventRow } from './db/schema';
import { conflict } from './errors';
import { getEventById, listOptions } from './events';
import { resolvePending } from './participants';

/**
 * Finalizes the roster: resolves pending names, freezes the aggregates on the event,
 * and makes the close final. There is no reverse operation.
 * The event is re-read inside the transaction so a stale caller snapshot cannot pass the
 * guard, and the update applies only while the roster is not yet final.
 */
export function finalizeRoster(
	db: Db,
	event: EventRow,
	pending: 'approve' | 'reject',
	now = new Date()
): EventRow {
	return db.transaction((tx) => {
		const current = getEventById(tx, event.id);
		if (current.state === 'published' || current.rosterFinal) {
			throw conflict('The event is already closed');
		}
		resolvePending(tx, current.id, pending === 'approve' ? 'approved' : 'rejected');
		const opts = listOptions(tx, current.id);
		const rows = readApprovedResponses(tx, current.id);
		const aggregates = aggregate(
			opts.map((o) => ({ id: o.id, cost: o.costPerPerson })),
			rows.map((r) => ({ ranking: r.ranking, vetoes: r.vetoes, budget: r.budget }))
		);
		const result = tx
			.update(events)
			.set({
				state: 'closed',
				rosterFinal: true,
				closedAt: current.closedAt ?? now.toISOString(),
				aggregates
			})
			.where(and(eq(events.id, current.id), eq(events.rosterFinal, false)))
			.run();
		if (result.changes === 0) throw conflict('The event is already closed');
		return getEventById(tx, current.id);
	});
}
```

- [ ] **Step 4: Run the tests, verify, commit**

```bash
npx vitest run src/lib/server/close.test.ts
npm run format && npm run lint && npm run check && npx vitest run
git add -A
git commit -m "Add roster finalization with frozen aggregates"
```

Expected: all close tests pass.

---

### Task 9: Rate limiter, role resolution, and server hooks

**Files:**

- Create: `src/lib/server/ratelimit.ts`
- Create: `src/lib/server/ratelimit.test.ts`
- Create: `src/lib/server/roles.ts`
- Create: `src/lib/server/roles.test.ts`
- Create: `src/hooks.server.ts`

**Interfaces:**

- Consumes: Task 4 `sha256Hex`, `safeEqualHex`, `isTokenShape`, `forbidden`, `tooMany`; Task 5 `closeDueEvents`; Task 6 `findParticipantByDevice`.
- Produces: `class RateLimiter { allow(key, limit, windowMs, now?) => boolean; prune(now?, maxAgeMs?) => void; size }`, `limiter` singleton, `enforce(key, limit, windowMs) => void`; `tokenFromHeader(request, name) => string | null`, `isHost(event, request) => boolean`, `requireHost(event, request) => void`, `participantFromRequest(db, event, request) => ParticipantRow | undefined`.

- [ ] **Step 1: Write the failing rate limiter test**

Create `src/lib/server/ratelimit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { RateLimiter } from './ratelimit';

describe('RateLimiter', () => {
	it('allows up to the limit inside the window and refuses after', () => {
		const limiter = new RateLimiter();
		const t0 = 1_000_000;
		expect(limiter.allow('k', 3, 60_000, t0)).toBe(true);
		expect(limiter.allow('k', 3, 60_000, t0 + 1)).toBe(true);
		expect(limiter.allow('k', 3, 60_000, t0 + 2)).toBe(true);
		expect(limiter.allow('k', 3, 60_000, t0 + 3)).toBe(false);
		expect(limiter.allow('other', 3, 60_000, t0 + 3)).toBe(true);
	});

	it('frees slots as the window slides', () => {
		const limiter = new RateLimiter();
		const t0 = 1_000_000;
		limiter.allow('k', 1, 1_000, t0);
		expect(limiter.allow('k', 1, 1_000, t0 + 999)).toBe(false);
		expect(limiter.allow('k', 1, 1_000, t0 + 1_000)).toBe(true);
	});

	it('prunes stale keys', () => {
		const limiter = new RateLimiter();
		limiter.allow('k', 1, 1_000, 0);
		limiter.prune(10_000, 5_000);
		expect(limiter.size).toBe(0);
	});
});
```

- [ ] **Step 2: Write the rate limiter**

Create `src/lib/server/ratelimit.ts`:

```ts
import { tooMany } from './errors';

/** In-memory sliding-window limiter. One process, so one map is the whole state. */
export class RateLimiter {
	private hits = new Map<string, number[]>();

	allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
		const recent = (this.hits.get(key) ?? []).filter((t) => t > now - windowMs);
		if (recent.length >= limit) {
			this.hits.set(key, recent);
			return false;
		}
		recent.push(now);
		this.hits.set(key, recent);
		return true;
	}

	prune(now = Date.now(), maxAgeMs = 3_600_000): void {
		for (const [key, times] of this.hits) {
			if (times.every((t) => t <= now - maxAgeMs)) this.hits.delete(key);
		}
	}

	get size(): number {
		return this.hits.size;
	}
}

export const limiter = new RateLimiter();

/** Throws a 429 AppError when the key has exceeded its limit. */
export function enforce(key: string, limit: number, windowMs: number): void {
	if (!limiter.allow(key, limit, windowMs)) {
		throw tooMany('Too many requests, try again in a moment');
	}
}
```

- [ ] **Step 3: Run the limiter test**

```bash
npx vitest run src/lib/server/ratelimit.test.ts
```

Expected: all pass.

- [ ] **Step 4: Write the failing roles test**

Create `src/lib/server/roles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './crypto';
import { listOptions } from './events';
import { submitResponse } from './participants';
import { isHost, participantFromRequest, requireHost, tokenFromHeader } from './roles';
import { makeDb, makeEvent, response } from './test-utils';

const hostToken = 'b'.repeat(64);
const deviceToken = 'c'.repeat(64);

const req = (headers: Record<string, string>) =>
	new Request('http://localhost/api/events/x', { headers });

describe('tokenFromHeader', () => {
	it('returns well-formed tokens only', () => {
		expect(tokenFromHeader(req({ 'x-host-token': hostToken }), 'x-host-token')).toBe(hostToken);
		expect(tokenFromHeader(req({ 'x-host-token': 'short' }), 'x-host-token')).toBeNull();
		expect(tokenFromHeader(req({}), 'x-host-token')).toBeNull();
	});
});

describe('isHost', () => {
	it('matches the hash of the host token and nothing else', () => {
		const db = makeDb();
		const event = { ...makeEvent(db), hostTokenHash: sha256Hex(hostToken) };
		expect(isHost(event, req({ 'x-host-token': hostToken }))).toBe(true);
		expect(isHost(event, req({ 'x-host-token': 'd'.repeat(64) }))).toBe(false);
		expect(isHost(event, req({}))).toBe(false);
		expect(() => requireHost(event, req({}))).toThrow(/Host only/);
	});
});

describe('participantFromRequest', () => {
	it('finds the participant by the hashed device token', () => {
		const db = makeDb();
		const event = makeEvent(db);
		const ids = listOptions(db, event.id).map((o) => o.id);
		const p = submitResponse(db, event, ids, sha256Hex(deviceToken), response('Alex', [ids[0]]), {
			autoApprove: false
		});
		expect(participantFromRequest(db, event, req({ 'x-participant-token': deviceToken }))?.id).toBe(
			p.id
		);
		expect(
			participantFromRequest(db, event, req({ 'x-participant-token': 'e'.repeat(64) }))
		).toBeUndefined();
		expect(participantFromRequest(db, event, req({}))).toBeUndefined();
	});
});
```

- [ ] **Step 5: Write the roles module**

Create `src/lib/server/roles.ts`:

```ts
import { isTokenShape, safeEqualHex, sha256Hex } from './crypto';
import type { DbLike } from './db';
import type { EventRow, ParticipantRow } from './db/schema';
import { forbidden } from './errors';
import { findParticipantByDevice } from './participants';

export type TokenHeader = 'x-host-token' | 'x-participant-token';

/** Reads a token header and returns it only when it has the exact 64-hex shape. */
export function tokenFromHeader(request: Request, name: TokenHeader): string | null {
	const value = request.headers.get(name);
	return isTokenShape(value) ? value : null;
}

export function isHost(event: EventRow, request: Request): boolean {
	const token = tokenFromHeader(request, 'x-host-token');
	return token !== null && safeEqualHex(sha256Hex(token), event.hostTokenHash);
}

export function requireHost(event: EventRow, request: Request): void {
	if (!isHost(event, request)) throw forbidden('Host only');
}

export function participantFromRequest(
	db: DbLike,
	event: EventRow,
	request: Request
): ParticipantRow | undefined {
	const token = tokenFromHeader(request, 'x-participant-token');
	if (!token) return undefined;
	return findParticipantByDevice(db, event.id, sha256Hex(token));
}
```

- [ ] **Step 6: Run the roles test**

```bash
npx vitest run src/lib/server/roles.test.ts
```

Expected: all pass.

- [ ] **Step 7: Write the server hooks**

Create `src/hooks.server.ts`:

```ts
import type { Handle, ServerInit } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { closeDueEvents } from '$lib/server/events';
import { limiter } from '$lib/server/ratelimit';

/** Runs once at startup: opens the database (applying migrations) and starts the auto-close tick. */
export const init: ServerInit = async () => {
	const db = getDb();
	const tick = () => {
		try {
			closeDueEvents(db);
			limiter.prune();
		} catch (e) {
			console.error('auto-close tick failed', e instanceof Error ? e.message : e);
		}
	};
	tick();
	setInterval(tick, 60_000).unref();
};

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	response.headers.set('x-content-type-options', 'nosniff');
	response.headers.set('referrer-policy', 'no-referrer');
	response.headers.set('x-frame-options', 'DENY');
	return response;
};
```

- [ ] **Step 8: Verify and commit**

```bash
npm run format && npm run lint && npm run check && npx vitest run
git add -A
git commit -m "Add rate limiter, role resolution, and server hooks"
```

---

### Task 10: View model and the event API (create, view, auto-close time)

**Files:**

- Create: `src/lib/server/views.ts`
- Create: `src/routes/api/events/+server.ts`
- Create: `src/routes/api/events/[code]/+server.ts`
- Create: `e2e/helpers.ts`
- Create: `e2e/api.e2e.ts`

**Interfaces:**

- Consumes: Tasks 4 to 9.
- Produces: `loadEventOr404(db, code, now?) => EventRow`, `buildEventPageView(db, event, request) => EventPageView`; HTTP `POST /api/events` (headers `x-host-token`; body `CreateEventInput`; 201 `{ code }`), `GET /api/events/{code}` (200 `EventPageView`), `PATCH /api/events/{code}` (host; body `{ closesAt: string | null }`; 200 `EventPageView`). Test helpers `token()`, `sampleOptions`, `createEventApi(request, hostToken, overrides?)`, `viewApi(request, code, headers?)`, `submitApi(request, code, participantToken, body, extraHeaders?)`, `newDevice(browser)`.

API error responses are JSON `{ "message": "..." }` with the AppError status, which is what SvelteKit's `error()` produces for `+server.ts` routes.

- [ ] **Step 1: Write the view builder**

Create `src/lib/server/views.ts`:

```ts
import { presentTallies } from './analysis/aggregate';
import type { Db } from './db';
import type { EventRow } from './db/schema';
import { notFound } from './errors';
import { findEventByCode, listOptions, refreshState, toEventView } from './events';
import { countByStatus, countSubmitted, getMine, listRoster } from './participants';
import { isHost, participantFromRequest } from './roles';
import type { EventPageView } from '$lib/shared/types';

/** Loads the event by public code, applying a passed auto-close deadline on the way. */
export function loadEventOr404(db: Db, code: string | undefined, now = new Date()): EventRow {
	const event = code ? findEventByCode(db, code) : undefined;
	if (!event) throw notFound('Event not found');
	return refreshState(db, event, now);
}

/** The role-aware view of an event. The host block never contains rankings, budgets, or opinions. */
export function buildEventPageView(db: Db, event: EventRow, request: Request): EventPageView {
	const view = toEventView(event, listOptions(db, event.id));
	const participant = participantFromRequest(db, event, request);
	const mine = participant ? getMine(db, participant) : null;
	if (!isHost(event, request)) {
		return { role: 'participant', event: view, mine, host: null };
	}
	return {
		role: 'host',
		event: view,
		mine,
		host: {
			submittedCount: countSubmitted(db, event.id),
			pendingCount: countByStatus(db, event.id, 'pending'),
			roster: listRoster(db, event.id),
			tallies: event.rosterFinal && event.aggregates ? presentTallies(event.aggregates) : null
		}
	};
}
```

- [ ] **Step 2: Write the create route**

Create `src/routes/api/events/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sha256Hex } from '$lib/server/crypto';
import { getDb } from '$lib/server/db';
import { badRequest } from '$lib/server/errors';
import { createEvent } from '$lib/server/events';
import { raise, readJson } from '$lib/server/http';
import { enforce } from '$lib/server/ratelimit';
import { tokenFromHeader } from '$lib/server/roles';
import { createEventInput } from '$lib/shared/validation';

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	try {
		enforce(`create:${getClientAddress()}`, 20, 3_600_000);
		const hostToken = tokenFromHeader(request, 'x-host-token');
		if (!hostToken) throw badRequest('Missing host token');
		const input = await readJson(request, createEventInput);
		if (input.closesAt && Date.parse(input.closesAt) <= Date.now()) {
			throw badRequest('The auto-close time has to be in the future');
		}
		const event = createEvent(getDb(), input, sha256Hex(hostToken));
		return json({ code: event.code }, { status: 201 });
	} catch (e) {
		raise(e);
	}
};
```

- [ ] **Step 3: Write the view and patch routes**

Create `src/routes/api/events/[code]/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { badRequest } from '$lib/server/errors';
import { setClosesAt } from '$lib/server/events';
import { raise, readJson } from '$lib/server/http';
import { requireHost } from '$lib/server/roles';
import { buildEventPageView, loadEventOr404 } from '$lib/server/views';
import { patchEventInput } from '$lib/shared/validation';

export const GET: RequestHandler = ({ params, request }) => {
	try {
		const db = getDb();
		const event = loadEventOr404(db, params.code);
		return json(buildEventPageView(db, event, request));
	} catch (e) {
		raise(e);
	}
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	try {
		const db = getDb();
		const event = loadEventOr404(db, params.code);
		requireHost(event, request);
		const input = await readJson(request, patchEventInput);
		if (input.closesAt && Date.parse(input.closesAt) <= Date.now()) {
			throw badRequest('The auto-close time has to be in the future');
		}
		const updated = setClosesAt(db, event, input.closesAt);
		return json(buildEventPageView(db, updated, request));
	} catch (e) {
		raise(e);
	}
};
```

- [ ] **Step 4: Write the e2e helpers**

Create `e2e/helpers.ts`:

```ts
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
```

- [ ] **Step 5: Write the API tests for this task**

Create `e2e/api.e2e.ts`:

```ts
import { expect, test } from '@playwright/test';
import { createEventApi, token, viewApi } from './helpers';

test.describe('events API', () => {
	test('creates an event and resolves roles from tokens', async ({ request }) => {
		const hostToken = token();
		const code = await createEventApi(request, hostToken);
		expect(code).toMatch(/^[0-9a-hj-kmnp-tv-z]{10}$/);

		const asHost = await viewApi(request, code, { 'x-host-token': hostToken });
		expect(asHost.status).toBe(200);
		expect(asHost.body.role).toBe('host');
		expect(asHost.body.host).toMatchObject({
			submittedCount: 0,
			pendingCount: 0,
			roster: [],
			tallies: null
		});
		expect(asHost.body.event.options).toHaveLength(4);
		expect(asHost.body.event.options[0]).toEqual({
			id: expect.any(String),
			label: 'Tapas crawl',
			note: 'El Born',
			cost: 25
		});
		expect(Object.keys(asHost.body.event).sort()).toEqual([
			'closedAt',
			'closesAt',
			'code',
			'context',
			'currency',
			'options',
			'rosterFinal',
			'state',
			'title'
		]);
		expect(Object.keys(asHost.body.host).sort()).toEqual([
			'pendingCount',
			'roster',
			'submittedCount',
			'tallies'
		]);
		const serialized = JSON.stringify(asHost.body);
		for (const field of ['hostTokenHash', 'accountId', 'aggregates', 'report', 'expiresAt', 'createdAt']) {
			expect(serialized).not.toContain(`"${field}"`);
		}

		const asStranger = await viewApi(request, code);
		expect(asStranger.body.role).toBe('participant');
		expect(asStranger.body.host).toBeNull();
		expect(asStranger.body.mine).toBeNull();

		const wrongToken = await viewApi(request, code, { 'x-host-token': token() });
		expect(wrongToken.body.role).toBe('participant');
		expect(wrongToken.body.host).toBeNull();
		expect(wrongToken.body.mine).toBeNull();
	});

	test('rejects a missing host token and bad input', async ({ request }) => {
		const noToken = await request.post('/api/events', {
			data: { title: 'x', currency: 'EUR', options: [{ label: 'a' }, { label: 'b' }] }
		});
		expect(noToken.status()).toBe(400);
		expect((await noToken.json()).message).toMatch(/host token/);

		const oneOption = await request.post('/api/events', {
			headers: { 'x-host-token': token() },
			data: { title: 'x', currency: 'EUR', options: [{ label: 'a' }] }
		});
		expect(oneOption.status()).toBe(400);
		expect((await oneOption.json()).message).toMatch(/at least two/);
	});

	test('unknown codes are 404', async ({ request }) => {
		const res = await request.get('/api/events/0000000000');
		expect(res.status()).toBe(404);
	});

	test('the host can set and clear the auto-close time while open', async ({ request }) => {
		const hostToken = token();
		const code = await createEventApi(request, hostToken);
		const future = new Date(Date.now() + 3_600_000).toISOString();

		const set = await request.patch(`/api/events/${code}`, {
			headers: { 'x-host-token': hostToken },
			data: { closesAt: future }
		});
		expect(set.status()).toBe(200);
		expect((await set.json()).event.closesAt).toBe(future);

		const cleared = await request.patch(`/api/events/${code}`, {
			headers: { 'x-host-token': hostToken },
			data: { closesAt: null }
		});
		expect((await cleared.json()).event.closesAt).toBeNull();

		const past = await request.patch(`/api/events/${code}`, {
			headers: { 'x-host-token': hostToken },
			data: { closesAt: new Date(Date.now() - 1000).toISOString() }
		});
		expect(past.status()).toBe(400);

		const stranger = await request.patch(`/api/events/${code}`, { data: { closesAt: null } });
		expect(stranger.status()).toBe(403);
	});
});
```

- [ ] **Step 6: Run the e2e suite**

```bash
npm run test:e2e -- e2e/api.e2e.ts
```

Expected: the web server builds and starts, and all four tests pass.

- [ ] **Step 7: Verify and commit**

```bash
npm run format && npm run lint && npm run check && npx vitest run
git add -A
git commit -m "Add event view model and the create, view, and auto-close API"
```

---

### Task 11: Response API (submit and edit)

**Files:**

- Create: `src/routes/api/events/[code]/responses/+server.ts`
- Modify: `e2e/api.e2e.ts` (append a describe block)

**Interfaces:**

- Consumes: Task 6 `submitResponse`, `updateResponse`; Task 9 `isHost`, `participantFromRequest`, `tokenFromHeader`, `enforce`; Task 10 `loadEventOr404`.
- Produces: `POST /api/events/{code}/responses` (headers `x-participant-token`, optional `x-host-token`; body `ResponseInput`; 201 `{ participantId }`), `PUT /api/events/{code}/responses` (headers `x-participant-token`; body `EditResponseInput`; 200 `{ ok: true }`).

- [ ] **Step 1: Append the failing tests**

Append to `e2e/api.e2e.ts` (add `optionIds` and `submitApi` to the import from `./helpers`):

```ts
test.describe('responses API', () => {
	test('device lock: one submission per device, readable and editable only by that device', async ({
		request
	}) => {
		const hostToken = token();
		const code = await createEventApi(request, hostToken);
		const ids = await optionIds(request, code);
		const alex = token();

		const first = await submitApi(request, code, alex, {
			name: 'Alex',
			ranking: [ids[0], ids[1]],
			vetoes: [ids[3]],
			budget: { kind: 'limit', amount: 30 },
			opinion: 'SENTINEL-OPINION tapas is central',
			suggestion: 'Flamenco'
		});
		expect(first.status()).toBe(201);
		expect((await first.json()).participantId).toEqual(expect.any(String));

		const again = await submitApi(request, code, alex, { name: 'Alex', ranking: [ids[0]] });
		expect(again.status()).toBe(409);

		const mine = await viewApi(request, code, { 'x-participant-token': alex });
		expect(mine.body.role).toBe('participant');
		expect(mine.body.mine).toEqual({
			name: 'Alex',
			ranking: [ids[0], ids[1]],
			vetoes: [ids[3]],
			budget: { kind: 'limit', amount: 30 },
			opinion: 'SENTINEL-OPINION tapas is central',
			suggestion: 'Flamenco'
		});

		const other = await viewApi(request, code, { 'x-participant-token': token() });
		expect(other.body.mine).toBeNull();

		const edit = await request.put(`/api/events/${code}/responses`, {
			headers: { 'x-participant-token': alex },
			data: { ranking: [ids[1]], vetoes: [], budget: null, opinion: 'changed', suggestion: '' }
		});
		expect(edit.status()).toBe(200);
		const after = await viewApi(request, code, { 'x-participant-token': alex });
		expect(after.body.mine).toMatchObject({ name: 'Alex', ranking: [ids[1]], opinion: 'changed' });

		const strangerEdit = await request.put(`/api/events/${code}/responses`, {
			headers: { 'x-participant-token': token() },
			data: { ranking: [ids[1]] }
		});
		expect(strangerEdit.status()).toBe(403);
	});

	test('the host receives names and a count, never rankings, budgets, or opinions', async ({
		request
	}) => {
		const hostToken = token();
		const code = await createEventApi(request, hostToken);
		const ids = await optionIds(request, code);
		await submitApi(request, code, token(), {
			name: 'Sam',
			ranking: [ids[2]],
			budget: { kind: 'limit', amount: 20 },
			opinion: 'SENTINEL-OPINION rooftop or nothing'
		});

		const asHost = await viewApi(request, code, { 'x-host-token': hostToken });
		expect(asHost.body.host.submittedCount).toBe(1);
		expect(asHost.body.host.pendingCount).toBe(1);
		expect(asHost.body.host.roster).toEqual([
			{ id: expect.any(String), name: 'Sam', status: 'pending', duplicate: false }
		]);
		expect(asHost.body.host.tallies).toBeNull();
		const serialized = JSON.stringify(asHost.body);
		expect(serialized).not.toContain('SENTINEL-OPINION');
		expect(serialized).not.toContain('"ranking"');
		expect(serialized).not.toContain('"budget"');
	});

	test('the host submitting their own response is auto-approved', async ({ request }) => {
		const hostToken = token();
		const code = await createEventApi(request, hostToken);
		const ids = await optionIds(request, code);
		const res = await submitApi(
			request,
			code,
			token(),
			{ name: 'Host', ranking: [ids[0]] },
			{ 'x-host-token': hostToken }
		);
		expect(res.status()).toBe(201);
		const asHost = await viewApi(request, code, { 'x-host-token': hostToken });
		expect(asHost.body.host.roster[0]).toMatchObject({ name: 'Host', status: 'approved' });
	});

	test('rejects a missing token, unknown options, and repeats', async ({ request }) => {
		const code = await createEventApi(request, token());
		const ids = await optionIds(request, code);

		const noToken = await request.post(`/api/events/${code}/responses`, {
			data: { name: 'A', ranking: [ids[0]] }
		});
		expect(noToken.status()).toBe(400);

		const unknown = await submitApi(request, code, token(), { name: 'A', ranking: ['nope'] });
		expect(unknown.status()).toBe(400);
		expect((await unknown.json()).message).toMatch(/unknown option/);

		const repeat = await submitApi(request, code, token(), {
			name: 'A',
			ranking: [ids[0], ids[0]]
		});
		expect(repeat.status()).toBe(400);
		expect((await repeat.json()).message).toMatch(/repeats/);

		const empty = await submitApi(request, code, token(), { name: 'A', ranking: [] });
		expect(empty.status()).toBe(400);
		expect((await empty.json()).message).toMatch(/at least one/);
	});
});
```

- [ ] **Step 2: Run to see the new tests fail**

```bash
npm run test:e2e -- e2e/api.e2e.ts
```

Expected: the `responses API` tests fail with 404 or 405 responses because the route does not exist.

- [ ] **Step 3: Write the responses route**

Create `src/routes/api/events/[code]/responses/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sha256Hex } from '$lib/server/crypto';
import { getDb } from '$lib/server/db';
import { badRequest, forbidden } from '$lib/server/errors';
import { listOptions } from '$lib/server/events';
import { raise, readJson } from '$lib/server/http';
import { submitResponse, updateResponse } from '$lib/server/participants';
import { enforce } from '$lib/server/ratelimit';
import { isHost, participantFromRequest, tokenFromHeader } from '$lib/server/roles';
import { loadEventOr404 } from '$lib/server/views';
import { editResponseInput, responseInput } from '$lib/shared/validation';

export const POST: RequestHandler = async ({ params, request, getClientAddress }) => {
	try {
		enforce(`submit:${params.code}:${getClientAddress()}`, 10, 60_000);
		const db = getDb();
		const event = loadEventOr404(db, params.code);
		const participantToken = tokenFromHeader(request, 'x-participant-token');
		if (!participantToken) throw badRequest('Missing participant token');
		const input = await readJson(request, responseInput);
		const ids = listOptions(db, event.id).map((o) => o.id);
		const participant = submitResponse(db, event, ids, sha256Hex(participantToken), input, {
			autoApprove: isHost(event, request)
		});
		return json({ participantId: participant.id }, { status: 201 });
	} catch (e) {
		raise(e);
	}
};

export const PUT: RequestHandler = async ({ params, request }) => {
	try {
		const db = getDb();
		const event = loadEventOr404(db, params.code);
		const participant = participantFromRequest(db, event, request);
		if (!participant) throw forbidden('No submission from this device');
		const input = await readJson(request, editResponseInput);
		const ids = listOptions(db, event.id).map((o) => o.id);
		updateResponse(db, event, ids, participant, input);
		return json({ ok: true });
	} catch (e) {
		raise(e);
	}
};
```

The submission limit is ten per minute per IP per event. Keep e2e scenarios at eight or fewer participants per event, since every test participant shares one IP.

- [ ] **Step 4: Run, verify, commit**

```bash
npm run test:e2e -- e2e/api.e2e.ts
npm run format && npm run lint && npm run check && npx vitest run
git add -A
git commit -m "Add response submit and edit API with device lock"
```

Expected: all `events API` and `responses API` tests pass.

---

### Task 12: Roster and close API

**Files:**

- Create: `src/routes/api/events/[code]/participants/[id]/+server.ts`
- Create: `src/routes/api/events/[code]/roster/approve-all/+server.ts`
- Create: `src/routes/api/events/[code]/close/+server.ts`
- Modify: `e2e/api.e2e.ts` (append a describe block)

**Interfaces:**

- Consumes: Task 6 `setParticipantStatus`, `approveAllPending`; Task 5 `stopSubmissions`; Task 8 `finalizeRoster`; Task 9 `requireHost`; Task 10 view helpers.
- Produces: `PATCH /api/events/{code}/participants/{id}` (host; body `{ status: 'approved' | 'rejected' }`; 200 `EventPageView`), `POST /api/events/{code}/roster/approve-all` (host; 200 `EventPageView`), `POST /api/events/{code}/close` (host; body `{ pending: 'approve' | 'reject' }`; 200 `EventPageView`; 409 when already final).

- [ ] **Step 1: Append the failing tests**

Append to `e2e/api.e2e.ts`:

```ts
test.describe('roster and close API', () => {
	test('approval, close with pending resolution, tallies after close, and no reopen', async ({
		request
	}) => {
		const hostToken = token();
		const host = { 'x-host-token': hostToken };
		const code = await createEventApi(request, hostToken);
		const ids = await optionIds(request, code);
		const people = ['Ana', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay'];
		const tokens = people.map(() => token());
		for (let i = 0; i < people.length; i++) {
			const res = await submitApi(request, code, tokens[i], {
				name: people[i],
				ranking: [ids[i % 2], ids[2]],
				budget: { kind: 'limit', amount: i < 3 ? 20 : 50 }
			});
			expect(res.status()).toBe(201);
		}

		let view = (await viewApi(request, code, host)).body;
		expect(view.host.submittedCount).toBe(6);
		expect(view.host.pendingCount).toBe(6);
		expect(view.host.tallies).toBeNull();

		const fay = view.host.roster.find((r: { name: string }) => r.name === 'Fay');
		const reject = await request.patch(`/api/events/${code}/participants/${fay.id}`, {
			headers: host,
			data: { status: 'rejected' }
		});
		expect(reject.status()).toBe(200);

		const strangerPatch = await request.patch(`/api/events/${code}/participants/${fay.id}`, {
			data: { status: 'approved' }
		});
		expect(strangerPatch.status()).toBe(403);

		const strangerApprove = await request.post(`/api/events/${code}/roster/approve-all`);
		expect(strangerApprove.status()).toBe(403);

		const approveAll = await request.post(`/api/events/${code}/roster/approve-all`, {
			headers: host
		});
		expect(approveAll.status()).toBe(200);
		view = await approveAll.json();
		expect(view.host.pendingCount).toBe(0);
		expect(
			view.host.roster.filter((r: { status: string }) => r.status === 'approved')
		).toHaveLength(5);
		expect(view.host.tallies).toBeNull();

		const strangerClose = await request.post(`/api/events/${code}/close`, {
			data: { pending: 'approve' }
		});
		expect(strangerClose.status()).toBe(403);

		const close = await request.post(`/api/events/${code}/close`, {
			headers: host,
			data: { pending: 'approve' }
		});
		expect(close.status()).toBe(200);
		view = await close.json();
		expect(view.event.state).toBe('closed');
		expect(view.event.rosterFinal).toBe(true);
		expect(view.host.tallies.approvedCount).toBe(5);
		expect(view.host.tallies.breakdown.firstChoice).toEqual([
			{ optionId: ids[0], count: 3 },
			{ optionId: ids[1], count: 2 },
			{ optionId: ids[2], count: 0 },
			{ optionId: ids[3], count: 0 }
		]);
		expect(view.host.tallies.breakdown.cost).toEqual({
			answered: 5,
			rows: [
				{ optionId: ids[0], cost: 25, overBudget: 3 },
				{ optionId: ids[1], cost: 15, overBudget: null },
				{ optionId: ids[2], cost: 45, overBudget: 3 }
			]
		});

		const again = await request.post(`/api/events/${code}/close`, {
			headers: host,
			data: { pending: 'approve' }
		});
		expect(again.status()).toBe(409);

		const late = await submitApi(request, code, token(), { name: 'Late', ranking: [ids[0]] });
		expect(late.status()).toBe(409);

		const flip = await request.patch(`/api/events/${code}/participants/${fay.id}`, {
			headers: host,
			data: { status: 'approved' }
		});
		expect(flip.status()).toBe(409);

		const edit = await request.put(`/api/events/${code}/responses`, {
			headers: { 'x-participant-token': tokens[0] },
			data: { ranking: [ids[1]], vetoes: [], budget: null, opinion: '', suggestion: '' }
		});
		expect(edit.status()).toBe(409);
	});

	test('below five approved responses the breakdown is hidden', async ({ request }) => {
		const hostToken = token();
		const host = { 'x-host-token': hostToken };
		const code = await createEventApi(request, hostToken);
		const ids = await optionIds(request, code);
		for (const name of ['Ana', 'Ben', 'Cleo', 'Dev']) {
			await submitApi(request, code, token(), { name, ranking: [ids[0]] });
		}
		const close = await request.post(`/api/events/${code}/close`, {
			headers: host,
			data: { pending: 'approve' }
		});
		const view = await close.json();
		expect(view.host.tallies).toEqual({ approvedCount: 4, breakdown: null });
	});

	test('a passed auto-close time stops submissions and leaves pending names for the host', async ({
		request
	}) => {
		const hostToken = token();
		const host = { 'x-host-token': hostToken };
		const code = await createEventApi(request, hostToken);
		const ids = await optionIds(request, code);
		await submitApi(request, code, token(), { name: 'Ana', ranking: [ids[0]] });

		const soon = new Date(Date.now() + 1500).toISOString();
		const set = await request.patch(`/api/events/${code}`, {
			headers: host,
			data: { closesAt: soon }
		});
		expect(set.status()).toBe(200);
		await new Promise((resolve) => setTimeout(resolve, 1700));

		const view = (await viewApi(request, code, host)).body;
		expect(view.event.state).toBe('closed');
		expect(view.event.rosterFinal).toBe(false);
		expect(view.host.tallies).toBeNull();
		expect(view.host.pendingCount).toBe(1);

		const late = await submitApi(request, code, token(), { name: 'Late', ranking: [ids[0]] });
		expect(late.status()).toBe(409);

		const close = await request.post(`/api/events/${code}/close`, {
			headers: host,
			data: { pending: 'reject' }
		});
		expect(close.status()).toBe(200);
		const closed = await close.json();
		expect(closed.event.rosterFinal).toBe(true);
		expect(closed.host.pendingCount).toBe(0);
		expect(closed.host.tallies).toEqual({ approvedCount: 0, breakdown: null });
	});
});
```

- [ ] **Step 2: Run to see the new tests fail**

```bash
npm run test:e2e -- e2e/api.e2e.ts
```

Expected: the `roster and close API` tests fail because the routes do not exist.

- [ ] **Step 3: Write the participant status route**

Create `src/routes/api/events/[code]/participants/[id]/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { raise, readJson } from '$lib/server/http';
import { setParticipantStatus } from '$lib/server/participants';
import { requireHost } from '$lib/server/roles';
import { buildEventPageView, loadEventOr404 } from '$lib/server/views';
import { participantStatusInput } from '$lib/shared/validation';

export const PATCH: RequestHandler = async ({ params, request }) => {
	try {
		const db = getDb();
		const event = loadEventOr404(db, params.code);
		requireHost(event, request);
		const input = await readJson(request, participantStatusInput);
		setParticipantStatus(db, event, params.id, input.status);
		return json(buildEventPageView(db, event, request));
	} catch (e) {
		raise(e);
	}
};
```

- [ ] **Step 4: Write the approve-all route**

Create `src/routes/api/events/[code]/roster/approve-all/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { raise } from '$lib/server/http';
import { approveAllPending } from '$lib/server/participants';
import { requireHost } from '$lib/server/roles';
import { buildEventPageView, loadEventOr404 } from '$lib/server/views';

export const POST: RequestHandler = ({ params, request }) => {
	try {
		const db = getDb();
		const event = loadEventOr404(db, params.code);
		requireHost(event, request);
		approveAllPending(db, event);
		return json(buildEventPageView(db, event, request));
	} catch (e) {
		raise(e);
	}
};
```

- [ ] **Step 5: Write the close route**

Create `src/routes/api/events/[code]/close/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { finalizeRoster } from '$lib/server/close';
import { getDb } from '$lib/server/db';
import { stopSubmissions } from '$lib/server/events';
import { raise, readJson } from '$lib/server/http';
import { requireHost } from '$lib/server/roles';
import { buildEventPageView, loadEventOr404 } from '$lib/server/views';
import { closeInput } from '$lib/shared/validation';

/** Closing is a one-way door: stop submissions if still open, then finalize the roster. */
export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const db = getDb();
		const event = loadEventOr404(db, params.code);
		requireHost(event, request);
		const input = await readJson(request, closeInput);
		const stopped = stopSubmissions(db, event);
		const closed = finalizeRoster(db, stopped, input.pending);
		return json(buildEventPageView(db, closed, request));
	} catch (e) {
		raise(e);
	}
};
```

- [ ] **Step 6: Run, verify, commit**

```bash
npm run test:e2e -- e2e/api.e2e.ts
npm run format && npm run lint && npm run check && npx vitest run
git add -A
git commit -m "Add roster approval and one-way close API"
```

Expected: every test in `e2e/api.e2e.ts` passes.

---

### Task 13: Client foundation (styles, token store, API client)

**Files:**

- Create: `src/app.css`
- Modify: `src/routes/+layout.svelte`
- Create: `src/lib/client/tokens.ts`
- Create: `src/lib/client/tokens.test.ts`
- Create: `src/lib/client/api.ts`

**Interfaces:**

- Produces: CSS classes `card`, `notice`, `pill`, `pill-success`, `pill-warn`, `pill-danger`, `row`, `dashed`, `grow`, `num`, `icon-btn`, `chips`, `chip`, `veto`, `btn-primary`, `btn-block`, `btn-danger`, `error`, `muted`, `small`, `bar`, `name`, `track`, `seg`, `val`, `stack`, `actions`; `newToken() => string`, `getToken(code, role) => string | null`, `setToken(code, role, token) => void`, `ensureToken(code, role) => string`; `api<T>(path, opts?) => Promise<T>` with `opts = { method?, body?, code?, headers? }` and `class ApiError extends Error { status: number }`.

- [ ] **Step 1: Write the stylesheet**

Create `src/app.css`:

```css
:root {
	color-scheme: light dark;
	--bg: #f7f6f3;
	--surface: #ffffff;
	--text: #1d1d1b;
	--muted: #6b6a66;
	--border: #dedcd5;
	--accent: #2f6fdb;
	--accent-text: #ffffff;
	--danger: #b3261e;
	--danger-bg: #fbeae9;
	--success: #1e6f43;
	--success-bg: #e6f4ec;
	--warn: #8a5a00;
	--warn-bg: #fff4dc;
	--radius: 10px;
}

@media (prefers-color-scheme: dark) {
	:root {
		--bg: #151514;
		--surface: #1f1f1d;
		--text: #ecebe6;
		--muted: #a09f98;
		--border: #3a3936;
		--accent: #7fa7f0;
		--accent-text: #0e1a33;
		--danger: #ff8a80;
		--danger-bg: #3a1f1d;
		--success: #7fd3a0;
		--success-bg: #17301f;
		--warn: #f0c36c;
		--warn-bg: #3a2c10;
	}
}

* {
	box-sizing: border-box;
}

html {
	font-family:
		system-ui,
		-apple-system,
		'Segoe UI',
		Roboto,
		sans-serif;
	font-size: 16px;
	line-height: 1.5;
	background: var(--bg);
	color: var(--text);
	-webkit-text-size-adjust: 100%;
}

body {
	margin: 0;
}

main {
	max-width: 480px;
	margin: 0 auto;
	padding: 20px 16px 48px;
}

h1 {
	font-size: 24px;
	font-weight: 600;
	margin: 0 0 4px;
}

h2 {
	font-size: 18px;
	font-weight: 600;
	margin: 24px 0 8px;
}

h3 {
	font-size: 15px;
	font-weight: 600;
	margin: 18px 0 6px;
}

p {
	margin: 0 0 12px;
}

.muted {
	color: var(--muted);
}

.small {
	font-size: 13px;
}

label,
.label {
	display: block;
	font-size: 13px;
	font-weight: 600;
	margin: 14px 0 6px;
}

input,
select,
textarea {
	width: 100%;
	font: inherit;
	color: inherit;
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: var(--radius);
	padding: 10px 12px;
}

textarea {
	min-height: 120px;
	resize: vertical;
}

input:focus,
select:focus,
textarea:focus,
button:focus-visible {
	outline: 2px solid var(--accent);
	outline-offset: 1px;
}

button {
	font: inherit;
	font-weight: 600;
	border: 1px solid var(--border);
	background: var(--surface);
	color: inherit;
	border-radius: var(--radius);
	padding: 10px 14px;
	cursor: pointer;
}

button:disabled {
	opacity: 0.5;
	cursor: default;
}

.btn-primary {
	background: var(--accent);
	color: var(--accent-text);
	border-color: var(--accent);
}

.btn-block {
	width: 100%;
	display: block;
	text-align: center;
}

.btn-danger {
	color: var(--danger);
}

.card {
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: 14px;
	padding: 14px 16px;
	margin: 12px 0;
}

.notice {
	display: flex;
	gap: 10px;
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: var(--radius);
	padding: 10px 12px;
	font-size: 13px;
	color: var(--muted);
}

.pill {
	display: inline-block;
	font-size: 12px;
	font-weight: 600;
	padding: 2px 10px;
	border-radius: 999px;
	border: 1px solid var(--border);
}

.pill-success {
	background: var(--success-bg);
	color: var(--success);
	border-color: transparent;
}

.pill-warn {
	background: var(--warn-bg);
	color: var(--warn);
	border-color: transparent;
}

.pill-danger {
	background: var(--danger-bg);
	color: var(--danger);
	border-color: transparent;
}

.row {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 10px 12px;
	border: 1px solid var(--border);
	border-radius: var(--radius);
	margin-bottom: 6px;
	background: var(--surface);
}

.row.dashed {
	border-style: dashed;
	background: transparent;
}

.grow {
	flex: 1;
	min-width: 0;
}

.num {
	width: 24px;
	height: 24px;
	border-radius: 50%;
	background: var(--accent);
	color: var(--accent-text);
	font-size: 12px;
	font-weight: 700;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex: none;
}

.icon-btn {
	padding: 4px 9px;
	font-size: 15px;
	line-height: 1.2;
}

.chips {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.chip {
	padding: 6px 12px;
	border-radius: 999px;
	font-size: 14px;
}

.chip[aria-pressed='true'] {
	background: var(--accent);
	color: var(--accent-text);
	border-color: var(--accent);
}

.veto {
	font-size: 12px;
	font-weight: 500;
	padding: 3px 9px;
	border-radius: 999px;
	white-space: nowrap;
}

.veto[aria-pressed='true'] {
	background: var(--danger-bg);
	color: var(--danger);
	border-color: transparent;
}

.error {
	color: var(--danger);
	font-size: 14px;
	margin: 8px 0;
}

.bar {
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: 13px;
	margin-bottom: 6px;
}

.bar .name {
	width: 120px;
	flex: none;
	color: var(--muted);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.bar .track {
	flex: 1;
	display: flex;
	height: 16px;
	background: var(--border);
	border-radius: 4px;
	overflow: hidden;
}

.bar .seg {
	height: 100%;
}

.bar .val {
	width: 24px;
	text-align: right;
}

dialog {
	border: none;
	border-radius: 14px;
	padding: 20px;
	width: min(400px, 92vw);
	background: var(--surface);
	color: var(--text);
}

dialog::backdrop {
	background: rgba(0, 0, 0, 0.45);
}

.stack > * + * {
	margin-top: 8px;
}

.actions {
	display: flex;
	gap: 8px;
	margin-top: 12px;
}

.actions > * {
	flex: 1;
}
```

- [ ] **Step 2: Import it from the layout**

Replace `src/routes/+layout.svelte` with:

```svelte
<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>DecisionMaker</title>
</svelte:head>

{@render children()}
```

- [ ] **Step 3: Write the failing token store test**

Create `src/lib/client/tokens.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { ensureToken, getToken, newToken, setToken } from './tokens';

class MemoryStorage {
	private map = new Map<string, string>();
	getItem(key: string) {
		return this.map.get(key) ?? null;
	}
	setItem(key: string, value: string) {
		this.map.set(key, value);
	}
	removeItem(key: string) {
		this.map.delete(key);
	}
	clear() {
		this.map.clear();
	}
}

describe('token store', () => {
	beforeEach(() => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: new MemoryStorage(),
			configurable: true
		});
	});

	it('generates 64-hex tokens that differ', () => {
		const a = newToken();
		const b = newToken();
		expect(a).toMatch(/^[0-9a-f]{64}$/);
		expect(a).not.toBe(b);
	});

	it('stores tokens per event and role', () => {
		setToken('abc', 'host', 'h'.repeat(64));
		expect(getToken('abc', 'host')).toBe('h'.repeat(64));
		expect(getToken('abc', 'participant')).toBeNull();
		expect(getToken('xyz', 'host')).toBeNull();
	});

	it('ensureToken creates once and then reuses', () => {
		const first = ensureToken('abc', 'participant');
		expect(ensureToken('abc', 'participant')).toBe(first);
		expect(getToken('abc', 'participant')).toBe(first);
	});
});
```

- [ ] **Step 4: Write the token store**

Create `src/lib/client/tokens.ts`:

```ts
export type TokenRole = 'host' | 'participant';

const key = (code: string, role: TokenRole) => `dm:${code}:${role}`;

/** 256 random bits as 64 lowercase hex characters. */
export function newToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function getToken(code: string, role: TokenRole): string | null {
	try {
		return localStorage.getItem(key(code, role));
	} catch {
		return null;
	}
}

export function setToken(code: string, role: TokenRole, token: string): void {
	try {
		localStorage.setItem(key(code, role), token);
	} catch {
		// Storage can be unavailable in private modes. The request will simply carry no token.
	}
}

/** Returns the stored token for this event and role, creating one if the device has none. */
export function ensureToken(code: string, role: TokenRole): string {
	const existing = getToken(code, role);
	if (existing) return existing;
	const token = newToken();
	setToken(code, role, token);
	return token;
}
```

- [ ] **Step 5: Run the token test**

```bash
npx vitest run src/lib/client/tokens.test.ts
```

Expected: all pass.

- [ ] **Step 6: Write the API client**

Create `src/lib/client/api.ts`:

```ts
import { getToken } from './tokens';

export class ApiError extends Error {
	constructor(
		public readonly status: number,
		message: string
	) {
		super(message);
		this.name = 'ApiError';
	}
}

export type ApiOptions = {
	method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
	body?: unknown;
	/** When set, the stored host and participant tokens for this event are attached as headers. */
	code?: string;
	headers?: Record<string, string>;
};

/** JSON fetch wrapper. Tokens travel in headers only, never in the URL. */
export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
	const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
	if (opts.body !== undefined) headers['content-type'] = 'application/json';
	if (opts.code) {
		const host = getToken(opts.code, 'host');
		if (host) headers['x-host-token'] = host;
		const participant = getToken(opts.code, 'participant');
		if (participant) headers['x-participant-token'] = participant;
	}
	const res = await fetch(path, {
		method: opts.method ?? 'GET',
		headers,
		body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
	});
	if (!res.ok) {
		let message = res.statusText || 'Request failed';
		try {
			const data = (await res.json()) as { message?: string };
			if (data?.message) message = data.message;
		} catch {
			// Not JSON; keep the status text.
		}
		throw new ApiError(res.status, message);
	}
	return (await res.json()) as T;
}
```

- [ ] **Step 7: Verify and commit**

```bash
npm run format && npm run lint && npm run check && npx vitest run
git add -A
git commit -m "Add base styles, browser token store, and API client"
```

---

### Task 14: Home page, event page shell, link screen, and a first host view

**Files:**

- Create: `src/routes/+page.svelte` (replace scaffolded)
- Create: `src/routes/e/[code]/+page.ts`
- Create: `src/routes/e/[code]/+page.svelte`
- Create: `src/lib/components/LinkCard.svelte`
- Create: `src/lib/components/LinkScreen.svelte`
- Create: `src/lib/components/HostView.svelte` (first version; Task 16 replaces it)
- Create: `e2e/create.e2e.ts`

**Interfaces:**

- Consumes: Task 13 `api`, `ApiError`, `newToken`, `setToken`; Task 3 `CURRENCIES`, `LIMITS`, `createEventInput`; Task 10 API.
- Produces: the pages `/` and `/e/{code}`; components `LinkCard` (`code`), `LinkScreen` (`code`, `title`), `HostView` (`view`, `code`, `onchange`).

- [ ] **Step 1: Write the failing create test**

Create `e2e/create.e2e.ts`:

```ts
import { expect, test } from '@playwright/test';

test.describe('creating an event', () => {
	test('validates, creates, shows the link, and lands on the host view', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'DecisionMaker' })).toBeVisible();

		await page.getByRole('button', { name: 'Create event' }).click();
		await expect(page.getByRole('alert')).toHaveText('Enter a title');

		await page.getByLabel('What are you deciding?').fill('Saturday night in Barcelona');
		await page.getByLabel('Context').fill('Dinner plans for the group');
		await page.getByLabel('Currency').selectOption('EUR');
		await page.getByLabel('Option 1').fill('Tapas crawl');
		await page.getByLabel('Cost per person').nth(0).fill('25');
		await page.getByLabel('Option 2').fill('Beach BBQ');
		await page.getByRole('button', { name: 'Add option' }).click();
		await page.getByLabel('Option 3').fill('Rooftop bar');
		await page.getByLabel('Cost per person').nth(2).fill('45');
		await page.getByRole('button', { name: 'Create event' }).click();

		await expect(page).toHaveURL(/\/e\/[0-9a-hj-kmnp-tv-z]{10}\?created=1$/);
		const code = new URL(page.url()).pathname.split('/').pop() as string;
		await expect(page.getByRole('heading', { name: 'Your event is ready' })).toBeVisible();
		await expect(page.getByLabel('Share this link')).toHaveValue(new RegExp(`/e/${code}$`));

		await page.getByRole('button', { name: 'Continue to host view' }).click();
		await expect(page).toHaveURL(new RegExp(`/e/${code}$`));
		await expect(page.getByRole('heading', { name: 'Saturday night in Barcelona' })).toBeVisible();
		await expect(page.getByText('Open', { exact: true })).toBeVisible();
		await expect(page.getByText('0 submitted')).toBeVisible();
	});

	test('a device without the host token sees the participant side', async ({ page, browser }) => {
		await page.goto('/');
		await page.getByLabel('What are you deciding?').fill('Lunch');
		await page.getByLabel('Option 1').fill('A');
		await page.getByLabel('Option 2').fill('B');
		await page.getByRole('button', { name: 'Create event' }).click();
		await expect(page).toHaveURL(/\?created=1$/);
		const code = new URL(page.url()).pathname.split('/').pop() as string;

		const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
		const otherPage = await other.newPage();
		await otherPage.goto(`/e/${code}`);
		await expect(otherPage.getByRole('heading', { name: 'Lunch' })).toBeVisible();
		await expect(otherPage.getByText('0 submitted')).toHaveCount(0);
		await expect(otherPage.getByRole('button', { name: 'Close submissions' })).toHaveCount(0);
		await other.close();
	});
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
npm run test:e2e -- e2e/create.e2e.ts
```

Expected: FAIL because the home page is still the scaffold.

- [ ] **Step 3: Write the home page**

Replace `src/routes/+page.svelte` with:

```svelte
<script lang="ts">
	import { goto } from '$app/navigation';
	import { api, ApiError } from '$lib/client/api';
	import { newToken, setToken } from '$lib/client/tokens';
	import { CURRENCIES, LIMITS, type Currency } from '$lib/shared/constants';
	import { createEventInput } from '$lib/shared/validation';

	type OptionDraft = { id: string; label: string; note: string; cost: string };
	const blank = (): OptionDraft => ({ id: crypto.randomUUID(), label: '', note: '', cost: '' });

	let title = $state('');
	let context = $state('');
	let currency = $state<Currency>('EUR');
	let options = $state<OptionDraft[]>([blank(), blank()]);
	let closesAtLocal = $state('');
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
			const hostToken = newToken();
			const { code } = await api<{ code: string }>('/api/events', {
				method: 'POST',
				body: parsed.data,
				headers: { 'x-host-token': hostToken }
			});
			setToken(code, 'host', hostToken);
			await goto(`/e/${code}?created=1`);
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Something went wrong, try again';
		} finally {
			busy = false;
		}
	}
</script>

<main>
	<h1>DecisionMaker</h1>
	<p class="muted">
		Make a group decision without anyone stepping on toes. One link, honest answers, an anonymous
		report.
	</p>

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
		<button type="submit" class="btn-primary btn-block" style="margin-top:16px" disabled={busy}>
			{busy ? 'Creating' : 'Create event'}
		</button>
	</form>
</main>
```

- [ ] **Step 4: Write the link components**

Create `src/lib/components/LinkCard.svelte`:

```svelte
<script lang="ts">
	let { code }: { code: string } = $props();
	const url = $derived(`${location.origin}/e/${code}`);
	let copied = $state(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(url);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			copied = false;
		}
	}
</script>

<div class="card">
	<label for="event-link">Share this link</label>
	<input id="event-link" readonly value={url} onfocus={(e) => e.currentTarget.select()} />
	<div class="actions">
		<button type="button" onclick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
	</div>
</div>
```

Create `src/lib/components/LinkScreen.svelte`:

```svelte
<script lang="ts">
	import { goto } from '$app/navigation';
	import LinkCard from './LinkCard.svelte';

	let { code, title }: { code: string; title: string } = $props();
</script>

<h1>Your event is ready</h1>
<p class="muted">{title}</p>
<LinkCard {code} />
<p class="small muted">
	This device is the host. Keep using this browser to approve names, close submissions, and run the
	analysis.
</p>
<button type="button" class="btn-primary btn-block" onclick={() => goto(`/e/${code}`)}>
	Continue to host view
</button>
```

- [ ] **Step 5: Write the first host view**

Create `src/lib/components/HostView.svelte`:

```svelte
<script lang="ts">
	import type { EventPageView } from '$lib/shared/types';
	import LinkCard from './LinkCard.svelte';

	let { view, code }: { view: EventPageView; code: string; onchange: () => void } = $props();
	const event = $derived(view.event);
	const host = $derived(view.host);
</script>

<h1>{event.title}</h1>
{#if event.context}
	<p class="muted">{event.context}</p>
{/if}
<p>
	{#if event.state === 'open'}
		<span class="pill pill-success">Open</span>
	{:else if event.state === 'closed'}
		<span class="pill pill-warn">Closed</span>
	{:else}
		<span class="pill">Published</span>
	{/if}
	<span class="muted small" style="margin-left:8px">{host?.submittedCount ?? 0} submitted</span>
</p>
{#if event.state === 'open'}
	<LinkCard {code} />
{/if}
```

- [ ] **Step 6: Write the event page**

Create `src/routes/e/[code]/+page.ts`:

```ts
// Roles come from browser storage, which the server cannot see, so this page renders on the client only.
export const ssr = false;
```

Create `src/routes/e/[code]/+page.svelte`:

```svelte
<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { api, ApiError } from '$lib/client/api';
	import HostView from '$lib/components/HostView.svelte';
	import LinkScreen from '$lib/components/LinkScreen.svelte';
	import type { EventPageView } from '$lib/shared/types';

	const code = $derived(page.params.code ?? '');
	let view = $state<EventPageView | null>(null);
	let error = $state('');

	async function load() {
		try {
			view = await api<EventPageView>(`/api/events/${code}`, { code });
			error = '';
		} catch (err) {
			error =
				err instanceof ApiError && err.status === 404
					? 'This event does not exist.'
					: 'Could not load the event. Check your connection and try again.';
		}
	}

	onMount(load);
</script>

<svelte:head>
	<title>{view ? view.event.title : 'DecisionMaker'}</title>
</svelte:head>

<main>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{:else if !view}
		<p class="muted">Loading</p>
	{:else if view.role === 'host' && page.url.searchParams.get('created')}
		<LinkScreen {code} title={view.event.title} />
	{:else if view.role === 'host'}
		<HostView {view} {code} onchange={load} />
	{:else}
		<h1>{view.event.title}</h1>
		{#if view.event.context}
			<p class="muted">{view.event.context}</p>
		{/if}
	{/if}
</main>
```

The participant branch is completed in Task 15.

- [ ] **Step 7: Run, verify, commit**

```bash
npm run test:e2e -- e2e/create.e2e.ts
npm run format && npm run lint && npm run check && npx vitest run
git add -A
git commit -m "Add home page, event page shell, link screen, and first host view"
```

Expected: both create tests pass.

---

### Task 15: Participant experience

**Files:**

- Create: `src/lib/components/PrivacyNotice.svelte`
- Create: `src/lib/components/RankingWidget.svelte`
- Create: `src/lib/components/BudgetChips.svelte`
- Create: `src/lib/components/ResponseForm.svelte`
- Create: `src/lib/components/SubmittedCard.svelte`
- Create: `src/lib/components/ParticipantView.svelte`
- Modify: `src/routes/e/[code]/+page.svelte`
- Modify: `e2e/helpers.ts` (add `submitViaUi`)
- Create: `e2e/participant.e2e.ts`

**Interfaces:**

- Consumes: Task 13 client modules; Task 3 `LIMITS`, `responseInput`, `editResponseInput`, `formatMoney`; Task 11 API.
- Produces: `ResponseForm` (`event`, `code`, `mine?`, `oncancel?`, `onsubmitted`), `RankingWidget` (`options`, `currency`, `bind:ranked`, `bind:vetoed`), `BudgetChips` (`costs`, `currency`, `bind:value`), `ParticipantView` (`view`, `code`, `onchange`), `SubmittedCard` (`event`, `mine`, `onedit`), `PrivacyNotice`; e2e helper `submitViaUi(browser, code, person)`.

- [ ] **Step 1: Add the UI submission helper**

Append to `e2e/helpers.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing participant tests**

Create `e2e/participant.e2e.ts`:

```ts
import { expect, test } from '@playwright/test';
import { createEventApi, newDevice, token } from './helpers';

test.describe('participant', () => {
	test('ranks by tapping, sets a budget, submits, and is locked to the device', async ({
		browser,
		request
	}) => {
		const code = await createEventApi(request, token());
		const { page, context } = await newDevice(browser);
		await page.goto(`/e/${code}`);

		await expect(page.getByRole('heading', { name: 'Saturday night' })).toBeVisible();
		await expect(page.getByText('Only the host sees your name')).toBeVisible();

		await page.getByRole('button', { name: 'Submit', exact: true }).click();
		await expect(page.getByRole('alert')).toHaveText('Enter your name');
		await page.getByLabel('Your name').fill('Alex');
		await page.getByRole('button', { name: 'Submit', exact: true }).click();
		await expect(page.getByRole('alert')).toHaveText('Rank at least one option');

		const unranked = page.getByTestId('unranked');
		await unranked.getByRole('button', { name: /^Rooftop bar/ }).click();
		await unranked.getByRole('button', { name: /^Tapas crawl/ }).click();
		await expect(page.getByTestId('ranked')).toContainText(/1\s*Rooftop bar/);
		await expect(page.getByTestId('ranked')).toContainText(/2\s*Tapas crawl/);
		await page.getByRole('button', { name: 'Move Tapas crawl up' }).click();
		await expect(page.getByTestId('ranked')).toContainText(/1\s*Tapas crawl/);
		await page.getByRole('button', { name: "Won't work for Paella class" }).click();
		await page.getByRole('button', { name: 'Up to €25' }).click();
		await page.getByLabel('Your opinion').fill('Tapas is central so everyone can get there');
		await page.getByLabel('Something not listed?').fill('Flamenco');
		await page.getByRole('button', { name: 'Submit', exact: true }).click();

		await expect(page.getByRole('heading', { name: 'Thanks, Alex' })).toBeVisible();
		await expect(page.getByText('Tapas crawl')).toBeVisible();
		await expect(page.getByText("Won't work: Paella class")).toBeVisible();
		await expect(page.getByText('Budget: up to €25')).toBeVisible();

		await page.reload();
		await expect(page.getByRole('heading', { name: 'Thanks, Alex' })).toBeVisible();

		await page.getByRole('button', { name: 'Edit my answers' }).click();
		await expect(page.getByLabel('Your name')).toHaveCount(0);
		await page.getByLabel('Your opinion').fill('Changed my mind, beach if sunny');
		await page.getByRole('button', { name: 'Save changes' }).click();
		await expect(page.getByText('Changed my mind, beach if sunny')).toBeVisible();

		const other = await newDevice(browser);
		await other.page.goto(`/e/${code}`);
		await expect(other.page.getByLabel('Your name')).toBeVisible();
		await expect(other.page.getByText('Thanks, Alex')).toHaveCount(0);
		await other.context.close();
		await context.close();
	});

	test('closed and published states read correctly', async ({ browser, request }) => {
		const hostToken = token();
		const code = await createEventApi(request, hostToken);
		const { page, context } = await newDevice(browser);
		await page.goto(`/e/${code}`);
		await page.getByLabel('Your name').fill('Sam');
		await page
			.getByTestId('unranked')
			.getByRole('button', { name: /^Beach BBQ/ })
			.click();
		await page.getByRole('button', { name: 'Submit', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Thanks, Sam' })).toBeVisible();

		const close = await request.post(`/api/events/${code}/close`, {
			headers: { 'x-host-token': hostToken },
			data: { pending: 'approve' }
		});
		expect(close.status()).toBe(200);

		await page.reload();
		await expect(page.getByRole('heading', { name: 'Submissions are closed' })).toBeVisible();
		await expect(page.getByText('Results are on the way.')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Edit my answers' })).toHaveCount(0);

		const other = await newDevice(browser);
		await other.page.goto(`/e/${code}`);
		await expect(other.page.getByRole('heading', { name: 'Submissions are closed' })).toBeVisible();
		await expect(other.page.getByText('Results are on the way.')).toHaveCount(0);
		await other.context.close();
		await context.close();
	});
});
```

- [ ] **Step 3: Run it to see it fail**

```bash
npm run test:e2e -- e2e/participant.e2e.ts
```

Expected: FAIL, the form does not exist yet.

- [ ] **Step 4: Write the privacy notice**

Create `src/lib/components/PrivacyNotice.svelte`:

```svelte
<div class="notice" role="note">
	<span aria-hidden="true">🔒</span>
	<span>
		Only the host sees your name. Nobody sees your ranking, budget, or opinion, not even the host.
		An AI rewrites opinions before anything is shared, and everything you type is deleted when the
		results are published.
	</span>
</div>
```

- [ ] **Step 5: Write the ranking widget**

Create `src/lib/components/RankingWidget.svelte`:

```svelte
<script lang="ts">
	import { formatMoney } from '$lib/shared/money';
	import type { OptionView } from '$lib/shared/types';

	let {
		options,
		currency,
		ranked = $bindable([]),
		vetoed = $bindable([])
	}: { options: OptionView[]; currency: string; ranked?: string[]; vetoed?: string[] } = $props();

	const unranked = $derived(options.filter((o) => !ranked.includes(o.id)));
	const byId = (id: string) => options.find((o) => o.id === id);

	function add(id: string) {
		ranked = [...ranked, id];
	}

	function remove(id: string) {
		ranked = ranked.filter((r) => r !== id);
	}

	function move(id: string, delta: number) {
		const i = ranked.indexOf(id);
		const j = i + delta;
		if (i < 0 || j < 0 || j >= ranked.length) return;
		const next = [...ranked];
		[next[i], next[j]] = [next[j], next[i]];
		ranked = next;
	}

	function toggleVeto(id: string) {
		vetoed = vetoed.includes(id) ? vetoed.filter((v) => v !== id) : [...vetoed, id];
	}
</script>

<div data-testid="ranked">
	{#each ranked as id, i (id)}
		{@const option = byId(id)}
		{#if option}
			<div class="row">
				<span class="num">{i + 1}</span>
				<span class="grow">
					{option.label}
					{#if option.cost !== null}
						<span class="muted small">{formatMoney(option.cost, currency)}</span>
					{/if}
				</span>
				<button
					type="button"
					class="icon-btn"
					aria-label={`Move ${option.label} up`}
					disabled={i === 0}
					onclick={() => move(id, -1)}>↑</button
				>
				<button
					type="button"
					class="icon-btn"
					aria-label={`Move ${option.label} down`}
					disabled={i === ranked.length - 1}
					onclick={() => move(id, 1)}>↓</button
				>
				<button
					type="button"
					class="icon-btn"
					aria-label={`Remove ${option.label} from ranking`}
					onclick={() => remove(id)}>×</button
				>
				<button
					type="button"
					class="veto"
					aria-label={`Won't work for ${option.label}`}
					aria-pressed={vetoed.includes(id)}
					onclick={() => toggleVeto(id)}>Won't work</button
				>
			</div>
		{/if}
	{/each}
</div>

{#if unranked.length > 0}
	<p class="small muted" style="margin:8px 0 6px">
		{ranked.length === 0 ? 'Tap your first choice' : 'Not ranked yet, tap to add'}
	</p>
	<div data-testid="unranked">
		{#each unranked as option (option.id)}
			<div class="row dashed">
				<button
					type="button"
					class="grow"
					style="text-align:left;border:none;background:transparent;padding:0;font-weight:500"
					onclick={() => add(option.id)}
				>
					{option.label}
					{#if option.cost !== null}
						<span class="muted small">{formatMoney(option.cost, currency)}</span>
					{/if}
				</button>
				<button
					type="button"
					class="veto"
					aria-label={`Won't work for ${option.label}`}
					aria-pressed={vetoed.includes(option.id)}
					onclick={() => toggleVeto(option.id)}>Won't work</button
				>
			</div>
		{/each}
	</div>
{/if}
```

- [ ] **Step 6: Write the budget chips**

Create `src/lib/components/BudgetChips.svelte`:

```svelte
<script lang="ts">
	import { formatMoney } from '$lib/shared/money';
	import type { Budget } from '$lib/shared/types';

	let {
		costs,
		currency,
		value = $bindable(null)
	}: { costs: number[]; currency: string; value?: Budget } = $props();

	const same = (a: Budget, b: Budget) => JSON.stringify(a) === JSON.stringify(b);

	function pick(next: Budget) {
		value = same(value, next) ? null : next;
	}
</script>

<div class="chips">
	{#each costs as cost (cost)}
		<button
			type="button"
			class="chip"
			aria-pressed={value?.kind === 'limit' && value.amount === cost}
			onclick={() => pick({ kind: 'limit', amount: cost })}
		>
			Up to {formatMoney(cost, currency)}
		</button>
	{/each}
	<button
		type="button"
		class="chip"
		aria-pressed={value?.kind === 'no_limit'}
		onclick={() => pick({ kind: 'no_limit' })}>No limit</button
	>
</div>
```

- [ ] **Step 7: Write the response form**

Create `src/lib/components/ResponseForm.svelte`:

```svelte
<script lang="ts">
	import { api, ApiError } from '$lib/client/api';
	import { ensureToken } from '$lib/client/tokens';
	import { LIMITS } from '$lib/shared/constants';
	import type { Budget, EventView, MineView } from '$lib/shared/types';
	import { editResponseInput, responseInput } from '$lib/shared/validation';
	import BudgetChips from './BudgetChips.svelte';
	import PrivacyNotice from './PrivacyNotice.svelte';
	import RankingWidget from './RankingWidget.svelte';

	let {
		event,
		code,
		mine = null,
		oncancel,
		onsubmitted
	}: {
		event: EventView;
		code: string;
		mine?: MineView | null;
		oncancel?: () => void;
		onsubmitted: () => void;
	} = $props();

	let name = $state(mine?.name ?? '');
	let ranked = $state<string[]>(mine?.ranking ?? []);
	let vetoed = $state<string[]>(mine?.vetoes ?? []);
	let budget = $state<Budget>(mine?.budget ?? null);
	let opinion = $state(mine?.opinion ?? '');
	let suggestion = $state(mine?.suggestion ?? '');
	let error = $state('');
	let busy = $state(false);

	const costs = $derived(
		[...new Set(event.options.map((o) => o.cost).filter((c): c is number => c !== null))].sort(
			(a, b) => a - b
		)
	);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		const payload = { name, ranking: ranked, vetoes: vetoed, budget, opinion, suggestion };
		const parsed = mine ? editResponseInput.safeParse(payload) : responseInput.safeParse(payload);
		if (!parsed.success) {
			error = parsed.error.issues[0]?.message ?? 'Check the form';
			return;
		}
		busy = true;
		try {
			if (mine) {
				await api(`/api/events/${code}/responses`, { method: 'PUT', body: parsed.data, code });
			} else {
				ensureToken(code, 'participant');
				await api(`/api/events/${code}/responses`, { method: 'POST', body: parsed.data, code });
			}
			onsubmitted();
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Could not submit, try again';
		} finally {
			busy = false;
		}
	}
</script>

<form onsubmit={submit} novalidate>
	<PrivacyNotice />

	{#if mine}
		<p class="label">Your name</p>
		<p>{mine.name}</p>
	{:else}
		<label for="name">Your name</label>
		<input id="name" bind:value={name} maxlength={LIMITS.name} autocomplete="name" />
	{/if}

	<p class="label">Rank the options <span class="muted">tap in order of preference</span></p>
	<RankingWidget options={event.options} currency={event.currency} bind:ranked bind:vetoed />

	{#if costs.length > 0}
		<p class="label">
			The most you'd comfortably spend per person <span class="muted">optional</span>
		</p>
		<BudgetChips {costs} currency={event.currency} bind:value={budget} />
	{/if}

	<label for="opinion">Your opinion <span class="muted">optional</span></label>
	<textarea
		id="opinion"
		bind:value={opinion}
		maxlength={LIMITS.opinion}
		placeholder="Anything you want the group to weigh: why you ranked it this way, dealbreakers, what would change your mind"
	></textarea>

	<label for="suggestion">Something not listed? <span class="muted">optional</span></label>
	<input
		id="suggestion"
		bind:value={suggestion}
		maxlength={LIMITS.suggestion}
		placeholder="A flamenco show near the hotel"
	/>

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	<div class="actions">
		{#if oncancel}
			<button type="button" onclick={oncancel}>Cancel</button>
		{/if}
		<button type="submit" class="btn-primary" disabled={busy}>
			{mine ? 'Save changes' : 'Submit'}
		</button>
	</div>
</form>
```

- [ ] **Step 8: Write the submitted card and participant view**

Create `src/lib/components/SubmittedCard.svelte`:

```svelte
<script lang="ts">
	import { formatMoney } from '$lib/shared/money';
	import type { EventView, MineView } from '$lib/shared/types';

	let { event, mine, onedit }: { event: EventView; mine: MineView; onedit: () => void } = $props();
	const label = (id: string) => event.options.find((o) => o.id === id)?.label ?? id;
</script>

<div class="card">
	<span class="pill pill-success">Submitted</span>
	<h2 style="margin-top:8px">Thanks, {mine.name}</h2>
	<p class="muted">
		The host approves names before anything is shared. Your ranking and opinion stay private.
	</p>
	<p class="label">Your ranking</p>
	<ol style="margin:0 0 8px;padding-left:20px">
		{#each mine.ranking as id (id)}
			<li>{label(id)}</li>
		{/each}
	</ol>
	{#if mine.vetoes.length > 0}
		<p class="small muted">Won't work: {mine.vetoes.map(label).join(', ')}</p>
	{/if}
	{#if mine.budget}
		<p class="small muted">
			Budget: {mine.budget.kind === 'limit'
				? `up to ${formatMoney(mine.budget.amount, event.currency)}`
				: 'no limit'}
		</p>
	{/if}
	{#if mine.opinion}
		<p class="label">Your opinion</p>
		<p style="white-space:pre-wrap">{mine.opinion}</p>
	{/if}
	{#if mine.suggestion}
		<p class="small muted">Suggested: {mine.suggestion}</p>
	{/if}
	<button type="button" onclick={onedit}>Edit my answers</button>
</div>
```

Create `src/lib/components/ParticipantView.svelte`:

```svelte
<script lang="ts">
	import type { EventPageView } from '$lib/shared/types';
	import ResponseForm from './ResponseForm.svelte';
	import SubmittedCard from './SubmittedCard.svelte';

	let { view, code, onchange }: { view: EventPageView; code: string; onchange: () => void } =
		$props();
	const event = $derived(view.event);
	const mine = $derived(view.mine);
	let editing = $state(false);
</script>

<h1>{event.title}</h1>
{#if event.context}
	<p class="muted">{event.context}</p>
{/if}

{#if event.state === 'open' && (!mine || editing)}
	<ResponseForm
		{event}
		{code}
		mine={editing ? mine : null}
		oncancel={editing ? () => (editing = false) : undefined}
		onsubmitted={() => {
			editing = false;
			onchange();
		}}
	/>
{:else if event.state === 'open' && mine}
	<SubmittedCard {event} {mine} onedit={() => (editing = true)} />
{:else if event.state === 'closed'}
	<div class="card">
		<h2 style="margin-top:0">Submissions are closed</h2>
		{#if mine}
			<p class="muted">Results are on the way.</p>
		{/if}
	</div>
{:else}
	<div class="card">
		<p>The host shared results with the approved group.</p>
	</div>
{/if}
```

- [ ] **Step 9: Wire the participant view into the page**

In `src/routes/e/[code]/+page.svelte`, add the import and replace the final branch. The file becomes:

```svelte
<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { api, ApiError } from '$lib/client/api';
	import HostView from '$lib/components/HostView.svelte';
	import LinkScreen from '$lib/components/LinkScreen.svelte';
	import ParticipantView from '$lib/components/ParticipantView.svelte';
	import type { EventPageView } from '$lib/shared/types';

	const code = $derived(page.params.code ?? '');
	let view = $state<EventPageView | null>(null);
	let error = $state('');

	async function load() {
		try {
			view = await api<EventPageView>(`/api/events/${code}`, { code });
			error = '';
		} catch (err) {
			error =
				err instanceof ApiError && err.status === 404
					? 'This event does not exist.'
					: 'Could not load the event. Check your connection and try again.';
		}
	}

	onMount(load);
</script>

<svelte:head>
	<title>{view ? view.event.title : 'DecisionMaker'}</title>
</svelte:head>

<main>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{:else if !view}
		<p class="muted">Loading</p>
	{:else if view.role === 'host' && page.url.searchParams.get('created')}
		<LinkScreen {code} title={view.event.title} />
	{:else if view.role === 'host'}
		<HostView {view} {code} onchange={load} />
	{:else}
		<ParticipantView {view} {code} onchange={load} />
	{/if}
</main>
```

- [ ] **Step 10: Run, verify, commit**

```bash
npm run test:e2e -- e2e/participant.e2e.ts e2e/create.e2e.ts
npm run format && npm run lint && npm run check && npx vitest run
git add -A
git commit -m "Add the participant form with tap ranking, vetoes, budget chips, and device lock"
```

Expected: participant and create tests pass.

---

### Task 16: Host view (roster, approvals, close, tallies)

**Files:**

- Create: `src/lib/components/Roster.svelte`
- Create: `src/lib/components/CloseDialog.svelte`
- Create: `src/lib/components/TalliesView.svelte`
- Modify: `src/lib/components/HostView.svelte` (replace)
- Modify: `e2e/helpers.ts` (add `openAsHost`)
- Create: `e2e/host.e2e.ts`

**Interfaces:**

- Consumes: Task 12 API; Task 15 `ResponseForm`; Task 14 `LinkCard`.
- Produces: `Roster` (`roster`, `readonly`, `onstatus?`), `CloseDialog` (`pendingCount`, `onconfirm`, exported `open()`), `TalliesView` (`tallies`, `options`, `currency`), the full `HostView`; e2e helper `openAsHost(browser, code, hostToken)`.

- [ ] **Step 1: Add the host helper**

Append to `e2e/helpers.ts`:

```ts
/** Opens the event on a fresh device that already holds the host token, as the creating device would. */
export async function openAsHost(
	browser: Browser,
	code: string,
	hostToken: string
): Promise<{ context: BrowserContext; page: Page }> {
	const device = await newDevice(browser);
	await device.context.addInitScript(
		([key, value]) => localStorage.setItem(key, value),
		[`dm:${code}:host`, hostToken]
	);
	await device.page.goto(`/e/${code}`);
	return device;
}
```

- [ ] **Step 2: Write the failing host tests**

Create `e2e/host.e2e.ts`:

```ts
import { expect, test } from '@playwright/test';
import { createEventApi, openAsHost, optionIds, submitApi, token } from './helpers';

test.describe('host', () => {
	test('sees names and a count, approves, closes, and the roster locks', async ({
		browser,
		request
	}) => {
		const hostToken = token();
		const code = await createEventApi(request, hostToken);
		const ids = await optionIds(request, code);
		const { page, context } = await openAsHost(browser, code, hostToken);

		await expect(page.getByText('0 submitted')).toBeVisible();
		await expect(page.getByText('Nobody has submitted yet')).toBeVisible();

		for (const [i, name] of ['Ana', 'Ben', 'Cleo'].entries()) {
			await submitApi(request, code, token(), {
				name,
				ranking: [ids[i % 2]],
				opinion: `SENTINEL-${name}`
			});
		}
		await page.reload();
		await expect(page.getByText('3 submitted')).toBeVisible();
		const roster = page.getByTestId('roster');
		await expect(roster.getByRole('listitem')).toHaveCount(3);
		await expect(roster).toContainText('Ana');
		await expect(page.getByText('First choices')).toHaveCount(0);
		await expect(page.getByText('SENTINEL')).toHaveCount(0);

		await page.getByRole('button', { name: 'Reject Cleo' }).click();
		await expect(roster.getByRole('listitem').filter({ hasText: 'Cleo' })).toContainText(
			'Rejected'
		);
		await page.getByRole('button', { name: 'Approve all pending (2)' }).click();
		await expect(roster.getByRole('listitem').filter({ hasText: 'Ana' })).toContainText('Approved');
		await expect(page.getByRole('button', { name: /Approve all pending/ })).toHaveCount(0);

		await page.getByRole('button', { name: 'Close submissions' }).click();
		await expect(page.getByRole('dialog')).toContainText('no reopen');
		await page.getByRole('button', { name: 'Close now' }).click();

		await expect(page.getByText('Closed', { exact: true })).toBeVisible();
		await expect(page.getByText('2 approved responses')).toBeVisible();
		await expect(page.getByText('Numbers appear once at least 5 approved responses')).toBeVisible();
		await expect(page.getByRole('button', { name: /Approve|Reject/ })).toHaveCount(0);
		await expect(page.getByRole('button', { name: /reopen/i })).toHaveCount(0);
		await context.close();
	});

	test('with five or more approved the tallies show after close, resolving pending names', async ({
		browser,
		request
	}) => {
		const hostToken = token();
		const code = await createEventApi(request, hostToken);
		const ids = await optionIds(request, code);
		const names = ['Ana', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay'];
		for (const [i, name] of names.entries()) {
			await submitApi(request, code, token(), {
				name,
				ranking: [ids[i % 2], ids[2]],
				budget: { kind: 'limit', amount: i < 3 ? 20 : 50 }
			});
		}
		const { page, context } = await openAsHost(browser, code, hostToken);
		await page.getByRole('button', { name: 'Close submissions' }).click();
		await expect(page.getByRole('dialog')).toContainText('6 names are still pending');
		await page.getByRole('button', { name: 'Approve pending and close' }).click();

		await expect(page.getByText('6 approved responses')).toBeVisible();
		await expect(page.getByTestId(`first-${ids[0]}`)).toHaveText('3');
		await expect(page.getByTestId(`first-${ids[1]}`)).toHaveText('3');
		await expect(page.getByTestId(`first-${ids[2]}`)).toHaveText('0');
		await expect(page.getByTestId(`over-${ids[2]}`)).toHaveText('over budget for 3');
		await expect(page.getByTestId(`over-${ids[0]}`)).toHaveText('over budget for 3');
		await expect(page.getByTestId(`over-${ids[1]}`)).toHaveCount(0);
		await expect(page.getByText('6 of 6 set a limit.')).toBeVisible();
		await context.close();
	});

	test('the host can submit their own response and it is approved at once', async ({
		browser,
		request
	}) => {
		const hostToken = token();
		const code = await createEventApi(request, hostToken);
		const { page, context } = await openAsHost(browser, code, hostToken);
		await page.getByRole('button', { name: 'Submit my response' }).click();
		await page.getByLabel('Your name').fill('Charlie');
		await page
			.getByTestId('unranked')
			.getByRole('button', { name: /^Tapas crawl/ })
			.click();
		await page.getByRole('button', { name: 'Submit', exact: true }).click();
		await expect(page.getByText('Your own response is in.')).toBeVisible();
		await expect(page.getByText('1 submitted')).toBeVisible();
		await expect(
			page.getByTestId('roster').getByRole('listitem').filter({ hasText: 'Charlie' })
		).toContainText('Approved');
		await context.close();
	});

	test('an auto-closed event asks the host to resolve pending names before showing numbers', async ({
		browser,
		request
	}) => {
		const hostToken = token();
		const code = await createEventApi(request, hostToken);
		const ids = await optionIds(request, code);
		await submitApi(request, code, token(), { name: 'Ana', ranking: [ids[0]] });
		const soon = new Date(Date.now() + 1500).toISOString();
		await request.patch(`/api/events/${code}`, {
			headers: { 'x-host-token': hostToken },
			data: { closesAt: soon }
		});
		await new Promise((resolve) => setTimeout(resolve, 1700));

		const { page, context } = await openAsHost(browser, code, hostToken);
		await expect(page.getByText('Submissions closed automatically')).toBeVisible();
		await expect(page.getByText('First choices')).toHaveCount(0);
		await page.getByRole('button', { name: 'Resolve pending names' }).click();
		await page.getByRole('button', { name: 'Reject pending and close' }).click();
		await expect(page.getByText('0 approved responses')).toBeVisible();
		await expect(page.getByText('The roster is final.')).toBeVisible();
		await context.close();
	});
});
```

- [ ] **Step 3: Run it to see it fail**

```bash
npm run test:e2e -- e2e/host.e2e.ts
```

Expected: FAIL, the roster and buttons do not exist yet.

- [ ] **Step 4: Write the roster**

Create `src/lib/components/Roster.svelte`:

```svelte
<script lang="ts">
	import type { RosterRow } from '$lib/shared/types';

	let {
		roster,
		readonly,
		onstatus
	}: {
		roster: RosterRow[];
		readonly: boolean;
		onstatus?: (id: string, status: 'approved' | 'rejected') => void;
	} = $props();

	const labels = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' } as const;
</script>

{#if roster.length === 0}
	<p class="muted">Nobody has submitted yet. Share the link.</p>
{:else}
	<ul style="list-style:none;padding:0;margin:0" data-testid="roster">
		{#each roster as row (row.id)}
			<li class="row">
				<span class="grow">
					{row.name}
					{#if row.duplicate}
						<span class="pill pill-warn">Duplicate name</span>
					{/if}
				</span>
				<span
					class="pill"
					class:pill-success={row.status === 'approved'}
					class:pill-danger={row.status === 'rejected'}>{labels[row.status]}</span
				>
				{#if !readonly && onstatus}
					{#if row.status !== 'approved'}
						<button
							type="button"
							class="icon-btn"
							aria-label={`Approve ${row.name}`}
							onclick={() => onstatus(row.id, 'approved')}>✓</button
						>
					{/if}
					{#if row.status !== 'rejected'}
						<button
							type="button"
							class="icon-btn"
							aria-label={`Reject ${row.name}`}
							onclick={() => onstatus(row.id, 'rejected')}>✕</button
						>
					{/if}
				{/if}
			</li>
		{/each}
	</ul>
{/if}
```

- [ ] **Step 5: Write the close dialog**

Create `src/lib/components/CloseDialog.svelte`:

```svelte
<script lang="ts">
	let {
		pendingCount,
		onconfirm
	}: { pendingCount: number; onconfirm: (pending: 'approve' | 'reject') => void } = $props();

	let dialog: HTMLDialogElement | undefined = $state();

	export function open() {
		dialog?.showModal();
	}

	function choose(pending: 'approve' | 'reject') {
		dialog?.close();
		onconfirm(pending);
	}
</script>

<dialog bind:this={dialog}>
	<h2 style="margin-top:0">Close submissions?</h2>
	{#if pendingCount > 0}
		<p>
			{pendingCount}
			{pendingCount === 1 ? 'name is' : 'names are'} still pending. Closing is final, so decide what happens
			to them.
		</p>
		<div class="stack">
			<button type="button" class="btn-primary btn-block" onclick={() => choose('approve')}>
				Approve pending and close
			</button>
			<button type="button" class="btn-block" onclick={() => choose('reject')}>
				Reject pending and close
			</button>
			<button type="button" class="btn-block" onclick={() => dialog?.close()}>Go back</button>
		</div>
	{:else}
		<p>Nobody can submit or edit after this, and there is no reopen.</p>
		<div class="stack">
			<button type="button" class="btn-primary btn-block" onclick={() => choose('approve')}>
				Close now
			</button>
			<button type="button" class="btn-block" onclick={() => dialog?.close()}>Go back</button>
		</div>
	{/if}
</dialog>
```

- [ ] **Step 6: Write the tallies view**

Create `src/lib/components/TalliesView.svelte`:

```svelte
<script lang="ts">
	import { RULES } from '$lib/shared/constants';
	import { formatMoney } from '$lib/shared/money';
	import type { OptionView, PresentedTallies } from '$lib/shared/types';

	let {
		tallies,
		options,
		currency
	}: { tallies: PresentedTallies; options: OptionView[]; currency: string } = $props();

	const label = (id: string) => options.find((o) => o.id === id)?.label ?? id;
	const breakdown = $derived(tallies.breakdown);
	const maxFirst = $derived(
		breakdown ? Math.max(1, ...breakdown.firstChoice.map((f) => f.count)) : 1
	);
	const shades = ['#185fa5', '#378add', '#85b7eb', '#b5d4f4'];

	/** Splits a rank row into proportional segments, folding unranked into the last position. */
	function segments(ranks: number[], unranked: number): { width: number; color: string }[] {
		const total = ranks.reduce((sum, n) => sum + n, 0) + unranked;
		if (total === 0) return [];
		const last = ranks.length - 1;
		return ranks
			.map((n, i) => (i === last ? n + unranked : n))
			.map((n, i) => ({ width: (n / total) * 100, color: shades[Math.min(i, shades.length - 1)] }))
			.filter((s) => s.width > 0);
	}
</script>

<p class="small muted">
	{tallies.approvedCount} approved {tallies.approvedCount === 1 ? 'response' : 'responses'}
</p>

{#if !breakdown}
	<div class="card">
		<p>Numbers appear once at least {RULES.minBreakdownResponses} approved responses are in.</p>
	</div>
{:else}
	<h3>First choices</h3>
	<div data-testid="first-choices">
		{#each breakdown.firstChoice as f (f.optionId)}
			<div class="bar">
				<span class="name">{label(f.optionId)}</span>
				<div class="track">
					<div
						class="seg"
						style={`width:${(f.count / maxFirst) * 100}%;background:var(--accent)`}
					></div>
				</div>
				<span class="val" data-testid={`first-${f.optionId}`}>{f.count}</span>
			</div>
		{/each}
	</div>

	<h3>Where each option ranked</h3>
	{#each breakdown.rankMatrix as r (r.optionId)}
		<div class="bar">
			<span class="name">{label(r.optionId)}</span>
			<div class="track">
				{#each segments(r.ranks, r.unranked) as s, i (i)}
					<div class="seg" style={`width:${s.width}%;background:${s.color}`}></div>
				{/each}
			</div>
			<span class="val"></span>
		</div>
	{/each}
	<p class="small muted">
		Darker means ranked higher. The lightest segment is last place or unranked.
	</p>

	{#if breakdown.vetoes.some((v) => v.count > 0)}
		<h3>Won't work for</h3>
		{#each breakdown.vetoes.filter((v) => v.count > 0) as v (v.optionId)}
			<p class="small">{label(v.optionId)}: {v.count}</p>
		{/each}
	{/if}

	{#if breakdown.condorcetWinner}
		<p class="small muted">
			{label(breakdown.condorcetWinner)} beats every other option head to head.
		</p>
	{/if}

	{#if breakdown.cost}
		<h3>Cost</h3>
		{#if breakdown.cost.answered !== null}
			<p class="small muted">{breakdown.cost.answered} of {tallies.approvedCount} set a limit.</p>
		{/if}
		{#each breakdown.cost.rows as c (c.optionId)}
			<div class="bar">
				<span class="name">{label(c.optionId)}</span>
				<span class="grow">{formatMoney(c.cost, currency)}</span>
				{#if c.overBudget !== null}
					<span class="small" style="color:var(--warn)" data-testid={`over-${c.optionId}`}>
						over budget for {c.overBudget}
					</span>
				{/if}
			</div>
		{/each}
	{/if}
{/if}
```

- [ ] **Step 7: Replace the host view**

Replace `src/lib/components/HostView.svelte` with:

```svelte
<script lang="ts">
	import { api, ApiError } from '$lib/client/api';
	import type { EventPageView } from '$lib/shared/types';
	import CloseDialog from './CloseDialog.svelte';
	import LinkCard from './LinkCard.svelte';
	import ResponseForm from './ResponseForm.svelte';
	import Roster from './Roster.svelte';
	import TalliesView from './TalliesView.svelte';

	let { view, code, onchange }: { view: EventPageView; code: string; onchange: () => void } =
		$props();

	const event = $derived(view.event);
	const host = $derived(view.host);
	let error = $state('');
	let showForm = $state(false);
	let closesLocal = $state(toLocal(view.event.closesAt));
	let closeDialog: ReturnType<typeof CloseDialog> | undefined = $state();

	/** ISO instant to the local wall-clock format a datetime-local input expects. */
	function toLocal(iso: string | null): string {
		if (!iso) return '';
		const d = new Date(iso);
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

	async function call(path: string, body?: unknown, method: 'POST' | 'PATCH' = 'POST') {
		error = '';
		try {
			await api(path, { method, body, code });
			onchange();
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Something went wrong, try again';
		}
	}

	const setStatus = (id: string, status: 'approved' | 'rejected') =>
		call(`/api/events/${code}/participants/${id}`, { status }, 'PATCH');
	const approveAll = () => call(`/api/events/${code}/roster/approve-all`);
	const saveClosesAt = () =>
		call(
			`/api/events/${code}`,
			{ closesAt: closesLocal ? new Date(closesLocal).toISOString() : null },
			'PATCH'
		);
	const close = (pending: 'approve' | 'reject') => call(`/api/events/${code}/close`, { pending });
</script>

<h1>{event.title}</h1>
{#if event.context}
	<p class="muted">{event.context}</p>
{/if}
<p>
	{#if event.state === 'open'}
		<span class="pill pill-success">Open</span>
	{:else if event.state === 'closed'}
		<span class="pill pill-warn">Closed</span>
	{:else}
		<span class="pill">Published</span>
	{/if}
	<span class="muted small" style="margin-left:8px">{host?.submittedCount ?? 0} submitted</span>
</p>
{#if error}
	<p class="error" role="alert">{error}</p>
{/if}

{#if host && event.state === 'open'}
	<LinkCard {code} />

	{#if view.mine}
		<p class="small muted">Your own response is in.</p>
	{:else if showForm}
		<h2>Your response</h2>
		<ResponseForm
			{event}
			{code}
			oncancel={() => (showForm = false)}
			onsubmitted={() => {
				showForm = false;
				onchange();
			}}
		/>
	{:else}
		<button type="button" class="btn-block" onclick={() => (showForm = true)}>
			Submit my response
		</button>
	{/if}

	<h2>Names</h2>
	<Roster roster={host.roster} readonly={false} onstatus={setStatus} />
	{#if host.pendingCount > 0}
		<button type="button" style="margin-top:8px" onclick={approveAll}>
			Approve all pending ({host.pendingCount})
		</button>
	{/if}

	<h2>Auto-close</h2>
	<label for="closes">Close submissions automatically at <span class="muted">optional</span></label>
	<input id="closes" type="datetime-local" bind:value={closesLocal} />
	<div class="actions">
		<button type="button" onclick={saveClosesAt}>Save time</button>
		{#if event.closesAt}
			<button
				type="button"
				onclick={() => {
					closesLocal = '';
					saveClosesAt();
				}}>Remove</button
			>
		{/if}
	</div>

	<h2>Close</h2>
	<p class="small muted">
		Closing is final. Names still pending are resolved in the next step, and nobody can submit or
		edit after that.
	</p>
	<button type="button" class="btn-primary btn-block" onclick={() => closeDialog?.open()}>
		Close submissions
	</button>
{:else if host && !event.rosterFinal}
	<div class="card">
		<h2 style="margin-top:0">Submissions closed automatically</h2>
		<p class="muted">Resolve the pending names to see the numbers. This is final.</p>
		<button type="button" class="btn-primary btn-block" onclick={() => closeDialog?.open()}>
			Resolve pending names
		</button>
	</div>
	<h2>Names</h2>
	<Roster roster={host.roster} readonly={false} onstatus={setStatus} />
{:else if host}
	<h2>Numbers</h2>
	{#if host.tallies}
		<TalliesView tallies={host.tallies} options={event.options} currency={event.currency} />
	{/if}
	<h2>Names</h2>
	<Roster roster={host.roster} readonly={true} />
	<p class="small muted">The roster is final.</p>
{/if}

{#if host}
	<CloseDialog bind:this={closeDialog} pendingCount={host.pendingCount} onconfirm={close} />
{/if}
```

- [ ] **Step 8: Run, verify, commit**

```bash
npm run test:e2e -- e2e/host.e2e.ts e2e/participant.e2e.ts e2e/create.e2e.ts
npm run format && npm run lint && npm run check && npx vitest run
git add -A
git commit -m "Add the host view with roster approval, one-way close, and suppressed tallies"
```

Expected: host, participant, and create tests all pass.

---

### Task 17: Model provider seam with the fake provider

**Files:**

- Create: `src/lib/server/analysis/provider.ts`
- Create: `src/lib/server/analysis/fake.ts`
- Create: `src/lib/server/analysis/provider.test.ts`

**Interfaces:**

- Consumes: Task 4 `badRequest`.
- Produces: `type ProviderId`, `type ModelInfo`, `type JsonRequest`, `interface ModelProvider { id; listModels(key); completeJson(request) }`, `isFakeProviderAllowed(env?) => boolean`, `getProvider(id, env?) => ModelProvider`, `fakeProvider`. Phase 2 adds the Anthropic, OpenAI, and OpenRouter implementations behind the same interface.

- [ ] **Step 1: Write the failing provider test**

Create `src/lib/server/analysis/provider.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fakeProvider } from './fake';
import { getProvider, isFakeProviderAllowed } from './provider';

describe('provider registry', () => {
	it('exposes the fake provider only when the environment allows it', () => {
		expect(isFakeProviderAllowed({ ALLOW_FAKE_PROVIDER: '1' })).toBe(true);
		expect(isFakeProviderAllowed({})).toBe(false);
		expect(getProvider('fake', { ALLOW_FAKE_PROVIDER: '1' })).toBe(fakeProvider);
		expect(() => getProvider('fake', {})).toThrow(/Unknown provider/);
		expect(() => getProvider('nope', { ALLOW_FAKE_PROVIDER: '1' })).toThrow(/Unknown provider/);
	});
});

describe('fakeProvider', () => {
	it('lists one model and returns a deterministic object', async () => {
		const models = await fakeProvider.listModels('any-key');
		expect(models).toEqual([{ id: 'fake-fast', label: 'Fake (deterministic)' }]);
		const out = await fakeProvider.completeJson({
			key: 'any-key',
			model: 'fake-fast',
			system: 's',
			user: 'u',
			schemaName: 'anonymize',
			schema: { type: 'object' },
			maxTokens: 100
		});
		expect(out).toEqual({ schemaName: 'anonymize', model: 'fake-fast', fake: true });
	});
});
```

- [ ] **Step 2: Write the interface and registry**

Create `src/lib/server/analysis/provider.ts`:

```ts
import { badRequest } from '../errors';
import { fakeProvider } from './fake';

export type ProviderId = 'anthropic' | 'openai' | 'openrouter' | 'fake';

export type ModelInfo = { id: string; label: string };

export type JsonRequest = {
	key: string;
	model: string;
	system: string;
	user: string;
	schemaName: string;
	schema: Record<string, unknown>;
	maxTokens: number;
};

/** One model provider. Keys are passed per call and never stored by an implementation. */
export interface ModelProvider {
	readonly id: ProviderId;
	listModels(key: string): Promise<ModelInfo[]>;
	completeJson(request: JsonRequest): Promise<unknown>;
}

export function isFakeProviderAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.ALLOW_FAKE_PROVIDER === '1';
}

const registry: Partial<Record<ProviderId, ModelProvider>> = { fake: fakeProvider };

export function getProvider(id: string, env: NodeJS.ProcessEnv = process.env): ModelProvider {
	if (id === 'fake' && !isFakeProviderAllowed(env)) throw badRequest('Unknown provider');
	const provider = registry[id as ProviderId];
	if (!provider) throw badRequest('Unknown provider');
	return provider;
}
```

- [ ] **Step 3: Write the fake provider**

Create `src/lib/server/analysis/fake.ts`:

```ts
import type { ModelProvider } from './provider';

/** Deterministic stand-in used by tests and demos. Phase 2 gives it canned stage outputs. */
export const fakeProvider: ModelProvider = {
	id: 'fake',
	async listModels() {
		return [{ id: 'fake-fast', label: 'Fake (deterministic)' }];
	},
	async completeJson(request) {
		return { schemaName: request.schemaName, model: request.model, fake: true };
	}
};
```

- [ ] **Step 4: Run, verify, commit**

```bash
npx vitest run src/lib/server/analysis/provider.test.ts
npm run format && npm run lint && npm run check && npx vitest run
git add -A
git commit -m "Add the model provider interface with a fake provider"
```

Expected: provider tests pass.

---

### Task 18: The full story and the anonymity harness

**Files:**

- Create: `e2e/story.e2e.ts`
- Create: `e2e/suppression.e2e.ts`

**Interfaces:**

- Consumes: every helper in `e2e/helpers.ts`.

- [ ] **Step 1: Write the story test**

Create `e2e/story.e2e.ts`:

```ts
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
```

How the expectations follow from the fixture, with Fay rejected: Ana, Ben, and Eli put Tapas first, Cleo puts Rooftop first, and Dev puts Beach first, so the first-choice counts in option order are 3, 1, 1, 0. Tapas beats every other option head to head. All five answered the budget question (Cleo's "No limit" counts as an answer), so "5 of 5 set a limit." Rooftop at 45 is over budget for the three people who set a 25 limit, so it is the only row that shows a count; Tapas and Beach are over budget for nobody, which renders as nothing.

- [ ] **Step 2: Write the suppression test**

Create `e2e/suppression.e2e.ts`:

```ts
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
	await expect(five.page.getByText('5 of 5 set a limit.')).toBeVisible();
	await expect(five.page.getByText('over budget')).toHaveCount(0);
	await five.context.close();
});
```

In the second event two people set a 20 limit, so Tapas at 25 and Rooftop at 45 are each over budget for exactly two people, which is below three and therefore rendered as nothing.

- [ ] **Step 3: Run the whole suite, verify, commit**

```bash
npm run test:e2e
npm run format && npm run lint && npm run check && npx vitest run
git add -A
git commit -m "Add the end-to-end story and suppression harness"
```

Expected: every e2e file passes: api, create, participant, host, story, suppression.

---

### Task 19: Docker image with Litestream

**Files:**

- Create: `deploy/Dockerfile`
- Create: `deploy/entrypoint.sh`
- Create: `deploy/litestream.yml`
- Create: `.dockerignore`

**Interfaces:**

- Consumes: the `build` output and `drizzle/` migrations.
- Produces: an image that runs `node build` on port 3000 with the database at `/data/app.db`, restoring from and replicating to an S3-compatible bucket whenever `BUCKET_NAME` is set, and running without replication otherwise.

Facts this task relies on (verified 2026-09-17): Litestream 0.5.17 is current, its config uses a singular `replica:` key, it expands `${VAR}` in the config file, `restore -if-db-not-exists -if-replica-exists` is the idempotent restore, `replicate -exec` runs the app as a child, and better-sqlite3 13 ships prebuilt binaries for Node 24 on Debian-based images, so no compiler is needed.

- [ ] **Step 1: Write the ignore file**

Create `.dockerignore`:

```
node_modules
.git
.svelte-kit
build
data
e2e/.tmp
test-results
playwright-report
coverage
.env
.env.*
!.env.example
.superpowers
docs
```

- [ ] **Step 2: Write the Dockerfile**

Create `deploy/Dockerfile`:

```dockerfile
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM litestream/litestream:0.5.17 AS litestream

FROM node:24-slim
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates \
	&& rm -rf /var/lib/apt/lists/*
COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream
WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/drizzle ./drizzle
COPY deploy/litestream.yml /etc/litestream.yml
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /data
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATABASE_URL=/data/app.db
EXPOSE 3000
CMD ["/entrypoint.sh"]
```

- [ ] **Step 3: Write the Litestream config and entrypoint**

Create `deploy/litestream.yml`:

```yaml
dbs:
  - path: /data/app.db
    replica:
      type: s3
      bucket: ${BUCKET_NAME}
      path: decision-maker
      endpoint: ${AWS_ENDPOINT_URL_S3}
      region: ${AWS_REGION}
```

Litestream reads `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from the environment on its own.

Create `deploy/entrypoint.sh`:

```sh
#!/bin/sh
set -eu

DB_PATH="${DATABASE_URL:-/data/app.db}"

if [ -n "${BUCKET_NAME:-}" ]; then
	echo "litestream: restoring $DB_PATH if it is missing and a backup exists"
	litestream restore -config /etc/litestream.yml -if-db-not-exists -if-replica-exists "$DB_PATH"
	echo "litestream: replicating $DB_PATH to bucket $BUCKET_NAME"
	exec litestream replicate -config /etc/litestream.yml -exec "node build"
else
	echo "litestream: BUCKET_NAME is not set, running without replication"
	exec node build
fi
```

The file must have LF line endings, which `.gitattributes` guarantees on checkout.

- [ ] **Step 4: Build and smoke test the image locally**

Docker Desktop must be running.

```bash
docker build -f deploy/Dockerfile -t decision-maker:local .
docker run -d --name dm-smoke -p 3100:3000 -e ORIGIN=http://localhost:3100 -e ALLOW_FAKE_PROVIDER=1 decision-maker:local
sleep 4
curl -s http://localhost:3100/api/health
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3100/api/events -H "content-type: application/json" -H "x-host-token: $(printf 'a%.0s' $(seq 1 64))" -d '{"title":"Smoke","currency":"EUR","options":[{"label":"A"},{"label":"B"}]}'
docker logs dm-smoke | head -5
docker rm -f dm-smoke
```

Expected: `{"ok":true}`, then `201`, and the log's first line is `litestream: BUCKET_NAME is not set, running without replication` followed by `Listening on http://0.0.0.0:3000`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add Docker image with Litestream restore and replication"
```

---

### Task 20: Deploy to Fly.io

**Files:**

- Create: `fly.toml`
- Modify: `README.md` (add a Deploy section)

**Interfaces:**

- Produces: the public URL `https://<app-name>.fly.dev` running always-on with a persistent volume and Tigris backups.

Two steps need Charlie at the keyboard because they open a browser or prompt for his account: installing and logging in to flyctl, and creating the Tigris bucket. The executing agent stops at those steps, tells him exactly what to run, and continues once he confirms. Nothing in this task is committed until the deploy is verified.

Facts this task relies on (verified 2026-09-17): `auto_stop_machines = "off"` is a string, `min_machines_running = 1` keeps the machine up, `fly launch --no-deploy --copy-config --name --region --yes` exists, `fly storage create` still creates a Tigris bucket and sets `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, and `BUCKET_NAME` on the app, and Fly sets the `Fly-Client-IP` header, which adapter-node reads through `ADDRESS_HEADER`.

- [ ] **Step 1: Charlie installs flyctl and logs in (USER ACTION)**

In PowerShell:

```powershell
powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

Open a new terminal so `fly` is on the PATH, then:

```powershell
fly auth login
```

Then pick the app name and region. The name must be unique across Fly; `decision-maker` is likely taken, so something like `decision-maker-cb` works. Pick the nearest region code from:

```powershell
fly platform regions
```

- [ ] **Step 2: Write the Fly config**

Create `fly.toml`, replacing `decision-maker-cb` with the chosen name in both places and `ams` with the chosen region:

```toml
app = "decision-maker-cb"
primary_region = "ams"

[build]
  dockerfile = "deploy/Dockerfile"

[env]
  PORT = "3000"
  DATABASE_URL = "/data/app.db"
  ORIGIN = "https://decision-maker-cb.fly.dev"
  ADDRESS_HEADER = "Fly-Client-IP"
  BODY_SIZE_LIMIT = "128K"
  ALLOW_FAKE_PROVIDER = "0"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1
  processes = ["app"]

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"

[mounts]
  source = "data"
  destination = "/data"
```

- [ ] **Step 3: Create the app and its volume**

```bash
fly launch --no-deploy --copy-config --name decision-maker-cb --region ams --yes
fly volumes create data --size 1 --region ams -a decision-maker-cb --yes
```

Expected: `fly launch` reports the app created without deploying, and `fly volumes create` prints the new volume's id in the chosen region.

- [ ] **Step 4: Charlie creates the backup bucket (USER ACTION)**

```powershell
fly storage create -a decision-maker-cb
```

Accept the prompts. The command sets the five `AWS_*` and `BUCKET_NAME` secrets on the app. Confirm with:

```powershell
fly secrets list -a decision-maker-cb
```

Expected: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, and `BUCKET_NAME` are listed.

- [ ] **Step 5: Deploy and verify**

```bash
fly deploy -a decision-maker-cb
curl -s https://decision-maker-cb.fly.dev/api/health
fly logs -a decision-maker-cb --no-tail | grep -i litestream
```

Expected: `{"ok":true}` and a log line `litestream: replicating /data/app.db to bucket <name>`.

Then create a real event from a phone or the browser at `https://decision-maker-cb.fly.dev`, submit from a second device, approve, close, and confirm the tallies message appears. Finally confirm the backup exists:

```bash
fly ssh console -a decision-maker-cb -C "litestream snapshots -config /etc/litestream.yml /data/app.db"
```

Expected: at least one snapshot row.

- [ ] **Step 6: Document and commit**

Append to `README.md`:

````markdown
## Deploy

The app runs on Fly.io as one always-on machine with a volume at `/data` and Litestream replicating the database to a Tigris bucket.

```sh
fly deploy
fly logs
fly ssh console -C "litestream snapshots -config /etc/litestream.yml /data/app.db"
```
````

Secrets for the bucket are set by `fly storage create` and never committed.
The app name, region, and public origin live in `fly.toml`.

````

```bash
git add fly.toml README.md
git commit -m "Add Fly.io configuration and deploy notes"
git push
````

---

### Task 21: Continuous integration

**Files:**

- Create: `.github/workflows/ci.yml`

**Interfaces:**

- Produces: a GitHub Actions workflow that runs lint, type check, unit tests, and the Playwright suite with the fake provider on every push and pull request.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run check
      - run: npx vitest run
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

If GitHub warns that an action major version is deprecated, bump it to the version the warning names.

- [ ] **Step 2: Push and watch the run**

```bash
git add .github/workflows/ci.yml
git commit -m "Add CI workflow running lint, checks, unit, and end-to-end tests"
git push
gh run watch --exit-status
```

Expected: the run finishes green. If the e2e job fails only in CI, download the `playwright-report` artifact from the run page before changing anything.

---

## Self-review against the spec

- Section 4 (system overview): Tasks 1, 2, 9, 19, 20.
- Section 5 (roles and tokens): Tasks 4, 9, 13; the `+page.ts` `ssr = false` in Task 14 is why roles resolve client-side.
- Section 6.1 to 6.3 (create, open, close): Tasks 5, 6, 8, 10, 12, 14, 16. Section 6.4 model panel and 6.5 published view are Phase 2. Section 6.6 expiry sweep and delete are Phase 3; the expiry timestamp is set in Task 5.
- Section 7 (participant): Task 15. The privacy notice text matches 7.1.
- Section 8 (cost): Tasks 3, 7, 15, 16. Rule 8.4 is `presentTallies` in Task 7 and is the only presenter used by Task 10.
- Section 9.2 (aggregate): Task 7. Sections 9.1 and 9.3 are Phase 2 behind the Task 17 seam.
- Section 12 (data model): Task 2, all nine tables.
- Section 14 (guarantees): 1 in Tasks 6 and 10, 2 in Tasks 7 and 10, 3 in Tasks 4, 9, 13, 4 is Phase 2 with the seam in Task 17, 5 in Tasks 9, 10, 11 (magic-link limits are Phase 3), 6 and 7 in Tasks 13 and 1, 8 is Phase 4.
- Section 15 (testing): unit tests in Tasks 2 to 9, 13, 17; adapter tests are Phase 2; e2e in Tasks 10 to 18; CI in Task 21.
- Section 16 phase 1 list: every item has a task above.

Type consistency checked: `EventPageView`, `PresentedTallies`, `RosterRow`, `MineView`, and `Budget` are defined once in Task 2 and consumed unchanged; `finalizeRoster`, `stopSubmissions`, `refreshState`, `submitResponse`, `presentTallies`, `readApprovedResponses` keep the same signatures in every task that names them.
