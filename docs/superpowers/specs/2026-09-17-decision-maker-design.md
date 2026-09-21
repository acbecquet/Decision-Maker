# DecisionMaker design spec

Date: 2026-09-17
Status: approved; Phases 1 to 4 live; hosting moved from Fly.io to the hub VM on 2026-09-21 (see section 4)
Repository: https://github.com/acbecquet/Decision-Maker

## 1. The problem

A group of thirty people on a trip could not make a decision because nobody wanted to step on anyone's toes.
People held their real opinions back, so the group never learned what it actually wanted.
A plain survey does not fix this, because a vote without reasoning misses the contingencies ("the beach is fine unless it rains") and the dealbreakers ("I can't afford the rooftop") that decide whether a plan works.

DecisionMaker is a small web app that collects each person's ranked preference, a private budget limit, and a free-text opinion, then has a language model analyse the whole set and write a report for the group.
Opinions are rewritten before anyone sees them so that nobody can tell who wrote what, not even the host.

## 2. Scope

In scope for this project:

- A host creates an event with a title, optional context, a currency, and 2 to 12 options, each with an optional per-person cost.
- One link is shared with the group.
- Participants open the link, enter a name, rank the options, optionally flag options that will not work for them, optionally set the most they would comfortably spend, write an opinion, and optionally suggest an option not listed.
- The host approves or rejects names, closes submissions, connects a model provider with their own key, runs the analysis, reads a draft, and publishes.
- Approved participants open the same link and read the report.
- Hosts may optionally sign in by email magic link to see their events from any device.

Out of scope for this project:

- Participant accounts of any kind.
- Push, email, or chat notifications to participants.
- Multi-round decisions or run-off votes.
- Reopening an event after close.
- Any form of payment or billing inside the app.
- Using a Claude or ChatGPT consumer subscription for the analysis (see section 11).

## 3. Decisions made during the brainstorm

| Topic              | Decision                                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Anonymity boundary | The host sees names and aggregate numbers only, never a link between a name and a choice, and never opinion text.                                                                                |
| Preference input   | Participants rank the options by tapping them into order, with an optional "won't work for me" flag per option.                                                                                  |
| Opinion input      | One open text box, not guided prompts.                                                                                                                                                           |
| Cost               | Every step carries cost: per-option cost from the host, a private budget limit from each participant, aggregate cost numbers in the report, and stricter anonymization for cost opinions.        |
| Host role          | The device that created the event holds a host token. Signing in extends host access to other devices.                                                                                           |
| Host sign-in       | Email magic link.                                                                                                                                                                                |
| Model access       | Anthropic and OpenAI by pasted API key, OpenRouter by one-tap OAuth PKCE connect or pasted key. The key stays in the host's browser and is passed to the server only for the duration of a call. |
| Report delivery    | Approved participants reopen the same link. The host announces it in the group chat.                                                                                                             |
| Retention          | Raw rankings and opinions are purged the moment the host publishes.                                                                                                                              |
| Write-ins          | Participants may suggest an option as text. Suggestions feed the analysis but are not added to the ranking list.                                                                                 |
| Close              | Closing submissions is final. There is no reopen.                                                                                                                                                |
| Architecture       | SvelteKit with TypeScript, SQLite through Drizzle, one Node process, one Docker image.                                                                                                           |
| Hosting            | Since 2026-09-21 the hub VM behind Podium Chasers' Caddy, one Docker Compose stack, a named volume, nightly snapshots; Fly.io with Litestream was the original target and is retired.            |

## 4. System overview

One SvelteKit application serves both the pages and the JSON API from a single Node process.
All state lives in one SQLite file on a persistent volume.
The application ships as one Docker image.
Until 2026-09-21 it ran on one always-on Fly machine with Litestream replicating the database file to an S3-compatible bucket; the Fly trial ended before a bucket could be created.
Since then it runs as one Docker Compose stack on the hub VM at https://decide.acb-apps.com, behind the Caddy container that Podium Chasers already runs, with a nightly snapshot of the database in place of Litestream (`deploy/README.md`).

The page surface is small:

- `/` is the home page where a host creates an event.
- `/e/{code}` is the single event link for everyone.
- `/signin` handles the magic link request and callback.
- `/me` lists a signed-in host's events.
- `/auth/openrouter/callback` receives the OpenRouter OAuth code.

The analysis job runs inside the same process, one job per event at a time.
The host view polls a progress endpoint.
There is no queue service and no separate worker.

External dependencies are exactly two since the move: the model provider the host connects and a transactional email service for magic links.

## 5. Roles and tokens

Roles are resolved from secrets held in the visitor's browser storage, never from the URL.

**Host token.**
A 256-bit random value generated in the browser when an event is created, stored in localStorage under the event code.
The server stores only its SHA-256 hash on the event row.

**Participant token.**
A 256-bit random value generated in the browser on first submission, stored in localStorage under the event code.
The server stores only its SHA-256 hash on the participant row.
This is the device lock: the link carries no secret, so forwarding the link lets someone submit as a new person but never lets them see or edit anyone else's submission.

**Account session.**
An httpOnly, secure, same-site cookie set after a magic-link sign-in.
A magic link is single use, expires after fifteen minutes, and is bound to the browser that requested it through an httpOnly nonce cookie whose hash sits on the link row, so a link opened in any other browser is refused and cannot claim that device's events.
A session lasts ninety days.
Events created while signed in belong to the account.
When a host signs in on a device that holds host tokens, the client sends those tokens and the server attaches the matching events to the account.

A device can hold both a host token and a participant token for the same event, because the host is one of the group and submits like everyone else.

Tokens travel in request headers, `x-host-token` and `x-participant-token`, and never in query strings.
The server compares hashes in constant time and never logs a token.

**Event codes** are ten characters from a 32-symbol alphabet with no ambiguous characters, about fifty bits of entropy.
Unknown codes return the same not-found response in the same time as any other miss.

The one link `/e/{code}` renders the host view when the request carries a valid host token or a session that owns the event, and the participant view otherwise.

## 6. Event lifecycle and host screens

An event moves through three states, `open`, `closed`, and `published`.
The host can delete the event in any state.

### 6.1 Create

The host enters a title, an optional line of context, a currency, 2 to 12 options, and an optional auto-close time.
Each option has a label, an optional one-line note, and an optional estimated cost per person.
Submitting the form creates the event and shows the link screen: the link itself, a copy button, a QR code, and the phone's native share sheet.
From the link screen the host enters the host view.
Until the first submission arrives, the host can edit the event from the link screen or the host view.
Saving an edit replaces the title, context, currency, options, and auto-close time, rotates the event code so the old link stops working, and shows the new link.
Once anyone has submitted, editing is no longer offered and the server refuses it.

Field limits: title 80 characters, context 200, option label 80, option note 120, cost a non-negative number with at most two decimals, currency an ISO 4217 code.

### 6.2 Open

The host view shows the link card, a count such as "17 submitted", and the roster.
Each roster row is a name with a state of pending, approved, or rejected, and there is an approve-all button.
No timestamps are shown.
A row appears only once someone has submitted.
Duplicate names get a subtle marker so the host can reject the stray one.
A "submit my response" button opens the participant form for the host, and the host's own response is auto-approved.
While open, the host sees no per-option numbers of any kind.
While open, the host may set, change, or remove the auto-close time.

While nobody has submitted, an "Edit event" button leads to the edit form of section 6.1.
The only other action is "Close submissions".

### 6.3 Close

Closing is a one-way door.
The close dialog lists anyone still pending and requires the host to resolve them by approving all, rejecting all, or going back.
On confirm, the event moves to `closed`, the roster becomes read-only, and the aggregates are computed and frozen.

Close is final because any reopen after the host has seen numbers would let them compare before and after and read a late person's vote off the chart.

An event with an auto-close time closes itself when that time passes.
Submissions stop immediately, but the roster is not final until the host resolves pending names through the same dialog on their next visit.
Aggregates are computed only once the roster is final.

### 6.4 Closed

Once the roster is final, the host view shows the tallies: first-choice counts, the full rank-position distribution, and the cost numbers, all over approved responses and all subject to the suppression rules in section 8.4.

Below the tallies sits the model panel with three tabs: Anthropic key, OpenAI key, and OpenRouter.
The OpenRouter tab offers a connect button and a paste field.
Once a key is present the model picker fills from that provider's live model list with the current flagship preselected.
The key stays in localStorage on the host's device.

"Run analysis" starts the job and shows progress such as "rewriting 12 of 30" and "synthesizing".
On success the host can read the full draft report, re-run with the same or another model, or publish.
The publish dialog states that all raw rankings and opinions will be deleted and that approved participants will see the report.

### 6.5 Published

The host sees the report exactly as participants do, plus a copy-summary button that produces a plain-text version for the group chat, and a delete button.

### 6.6 Housekeeping

Each event carries an expiry: 90 days after publish, or 90 days after creation if never published.
A nightly sweep deletes expired events that no account owns.
Deleting an event removes everything, including the report.

## 7. Participant experience

### 7.1 The form

The form shows the event title and context, then a privacy notice, then the fields.

The privacy notice reads, in substance: only the host sees your name; nobody sees your ranking or opinion, not even the host; an AI rewrites opinions before anything is shared; everything you type is deleted when the results are published.

Fields, in order:

1. Name, required, up to 40 characters.
2. Rank the options, required.
   Options start in an unranked pool and move into a numbered list when tapped, in the order tapped.
   Ranked items have up and down arrows for adjustment and can be tapped back out of the list.
   A participant may leave options unranked.
   Every option, ranked or not, carries a "won't work for me" toggle.
3. The most you would comfortably spend per person, optional.
   Shown only when at least one option has a cost.
   Answered by one tap on chips generated from the distinct option costs in ascending order, plus "No limit".
   Skipping it records no answer.
4. Your opinion, optional, up to 2,000 characters, with placeholder text that nudges toward reasoning, dealbreakers, and what would change their mind.
5. Something not listed, optional, up to 200 characters.

Submit creates the participant token and the participant row in the same request.

### 7.2 States of the link for a participant

- Open, no submission from this device: the form.
- Open, submitted from this device: their own answers with an edit button and a note that the host will approve them.
  Edits are allowed until close and update the response in place.
- Closed, submitted: "Submissions are closed, results are on the way."
- Closed, no submission: "Submissions are closed."
- Published, approved: the report.
- Published, pending or rejected: "The host shared results with the approved group."
  The message gives no hint about which state the person is in.

### 7.3 Device lock in practice

Clearing browser storage or switching phones makes someone look like a new person.
They resubmit and the host rejects the duplicate.
This is the accepted cost of having no participant accounts.

## 8. Cost

Cost is a first-class dimension because it is the most common dealbreaker and the one people are least willing to state in their own words.

### 8.1 Host side

The event has a currency and each option has an optional estimated cost per person.
Options without a cost are treated as free or unknown and take no part in cost numbers.

### 8.2 Participant side

The budget question in section 7.1 produces a structured, private number that is aggregated like a vote.
Nobody has to write "I can't afford that".

### 8.3 Aggregation

For each option with a cost, stage 2 counts how many approved participants set a limit below that cost.
It also records the spread of limits and how many people answered.

### 8.4 Suppression rules

These rules are implemented in one shared function used by both the host tallies and the report, so the two can never disagree.

- Below five approved responses, no per-option breakdown is shown to anyone, only the participant count.
- Any cost count below three is never displayed, not to the host and not in the report.
- Small cost signals still reach stage 3, but only as a flag that cost matters to part of the group, with no number, so the recommendation accounts for them without stating them.

### 8.5 Anonymizer rules for cost

Cost sentences in free text get the strictest rewrite.
Amounts and circumstances are removed, so "I only have 40 euros left for the trip" becomes "one person is on a tight budget".
Such points are tagged `cost`.
The server excludes cost-tagged points from the quote pool, so no cost opinion ever appears in the report as someone's words.
Stage 3 reads them for reasoning only.

### 8.6 Report

Price tags appear on the best, runner-up, worst, and unexpected cards.
A cost section lists each option's price and, when the count clears the threshold, how many people it is over budget for.
The verdict is written to account for cost.
The copy-summary paragraph carries the same cost line.

## 9. Analysis pipeline

The pipeline runs on the server when the host taps "Run analysis".

### 9.1 Stage 1, anonymize

One model call per approved response, run in parallel with a concurrency cap of four.
Each call sees a single response with no name attached: the option list with costs, that person's ranking and vetoes for context, and their opinion and suggestion text.

The model rewrites the text into a neutral, uniform register: plain sentences of similar length, no slang, no emoji, no unusual punctuation, no dialect or language markers.
It removes or generalizes content that identifies the author, such as other people's names, roles ("I booked the hotel"), and unique circumstances ("the only vegetarian" becomes "one person has a dietary restriction").
Cost content follows section 8.5.

The output is a list of discrete points.
Each point has text, a type of `reason`, `condition`, `constraint`, `suggestion`, or `cost`, and the option ids it concerns.
Output is validated against a schema.
An empty opinion and empty suggestion skip this stage.

### 9.2 Stage 2, aggregate

Pure code, no model.
Over approved responses it computes first-choice counts, the rank-position matrix, unranked and veto counts per option, a Borda-style score with unranked treated as tied last, pairwise wins so a Condorcet winner can be named when one exists, and the cost numbers of section 8.3.
Stage 2 runs at close, feeds the host tallies and the report charts, and is handed to stage 3 as facts so the model never has to count.

### 9.3 Stage 3, synthesize

One model call.
The input is the event title and context, the options with costs, the aggregate numbers, and every anonymized point grouped by anonymous response so that a person's "beach if sunny, otherwise tapas" stays coherent.
Groups are shuffled and labelled by number only.
Readers never see the groups.

The model returns structured JSON:

- Best option: option id, a one-line verdict, a short rationale, and a consensus strength of strong, moderate, or split.
- Runner-up: option id and rationale.
- Worst: option id and a rationale worded factually rather than harshly.
- Unexpected: a listed option the numbers undersell, a participant suggestion, or a compromise, with a rationale.
  This field is explicitly allowed to be empty rather than invented.
- Themes: three to six, each with a title, a summary, and one to three supporting quotes chosen by point id.
  The server inserts the stage-1 text verbatim, so the model can neither re-paraphrase nor fabricate a quote.
  Cost-tagged points are not offered as quote candidates.
- Contingencies the group still has to settle and hard constraints, generalized.
- A plain-language paragraph for the copy-summary button.

### 9.4 Job mechanics

The key arrives in the "Run analysis" request body over HTTPS, lives in the job object in memory, and is dropped when the job ends.
A run is all-or-nothing: the draft is saved only on success, and a failed run leaves the previous draft in place.
Rate-limit and server errors from the provider retry with exponential backoff up to three attempts.
Any other failure surfaces to the host as a plain message with a retry button.
Per-call timeout is two minutes for a rewrite and ten minutes for the report call, which thinks for much longer at high effort, and the whole job times out at thirty minutes.
Re-runs redo every stage, which keeps the pipeline stateless.
Prompts are versioned files, and the report records the prompt version, provider, and model used.

## 10. Report

The report is rendered server-side from the stored JSON and the frozen aggregates.
Its sections, in order:

1. Title, participant count, and publish date.
2. Best option card with price tag, consensus label, and rationale.
3. Runner-up and worst side by side, each with price tag and one-line rationale.
4. Unexpected option card, omitted when empty.
5. First choices, a horizontal bar chart of first-choice counts per option.
6. Where each option ranked, a stacked horizontal bar per option showing the share of each rank position, with unranked folded into the last segment.
7. Cost, per section 8.6.
8. What people said, the themes with their verbatim anonymized quotes set in a serif face.
9. Still to settle, the contingencies and constraints as a short list.
10. Footer stating the approved response count, that opinions were rewritten by AI to protect anonymity, and the model used.

Charts are plain HTML and CSS with no chart library.
Below five approved responses, sections 5, 6, and the counts in 7 are replaced by a sentence stating that there are too few responses to show a breakdown.

The host's view of the published report adds the copy-summary button and the delete button.
Copy summary produces the stage-3 paragraph followed by the four headline options and the cost line.

## 11. Providers and model access

Research on 2026-09-17 established the following, and the design follows it:

- Anthropic bans third-party apps from using Claude consumer subscriptions, enforces it server-side, and offers no OAuth client registration to outside apps.
  The supported path is a pasted API key.
- OpenAI's "Sign in with ChatGPT" grants identity only, not model access, and is limited to named partners.
  Reusing the Codex CLI sign-in is unauthorized.
  The supported path is a pasted API key.
- OpenRouter offers a self-serve OAuth PKCE flow that needs no registration and returns a key scoped to the user's own account and credits.

The app therefore offers three provider tabs.

**Anthropic.** Pasted key. Calls go through the official TypeScript SDK with adaptive thinking on and the server-side refusal fallbacks enabled per current API guidance. Structured output uses the JSON schema output format. The default model is `claude-opus-5`.

**OpenAI.** Pasted key. Calls go through the official SDK. Structured output uses JSON schema response format. The default is the current flagship, determined from the live model list.

**OpenRouter.** Connect button or pasted key. Calls go through the OpenAI SDK pointed at OpenRouter's base URL, sending the app identification headers. Structured output uses the JSON schema response format where the chosen model supports it, with a validated JSON-in-text fallback and one retry where it does not.

The run request carries a thinking effort of low, medium, high, or max, defaulting to max.
Anthropic maps it to `output_config.effort`, OpenAI to `reasoning_effort`, and OpenRouter to the unified `reasoning` parameter with the reasoning text excluded from the response.
The OpenRouter default model is `~deepseek/deepseek-pro-latest` when the live list has it, otherwise `anthropic/claude-opus-5`; the Anthropic default is `claude-opus-5`; the OpenAI default is the first of `gpt-5.6`, `gpt-5.6-sol`, `gpt-6-astra` present in the live list.

The OpenRouter connect flow starts at OpenRouter's authorization page with a PKCE challenge and returns to `/auth/openrouter/callback` with a code.
The code exchange is done from the browser if OpenRouter permits cross-origin requests, and otherwise through a server route that returns the key in its response without persisting or logging it.
The implementation plan verifies which applies.

All model calls, including model listing, are made by the server.
The OpenRouter OAuth code exchange is the one provider interaction that may happen in the browser.
The key is sent in the request body for the listing call and the run call, is held in memory only for that call or job, and is redacted from every log line and error message.

## 12. Data model

Nine tables in one SQLite file, managed by Drizzle migrations.

- `accounts`: id, email (unique), created_at.
- `magic_links`: token_hash, nonce_hash (the hash of the browser-binding cookie), email, expires_at, used_at.
- `sessions`: token_hash, account_id, expires_at.
- `events`: id, code (unique), title, context, currency, state, roster_final, host_token_hash, account_id (nullable), closes_at (nullable), closed_at, published_at, expires_at, provider, model, prompt_version, aggregates JSON, report JSON, created_at.
- `options`: id, event_id, position, label, note, cost_per_person (nullable).
- `participants`: id, event_id, display_name, device_token_hash, status, created_at.
- `responses`: participant_id (primary key), ranking JSON of option ids in order, vetoes JSON, budget_kind (`limit`, `no_limit`, or null), budget_amount (nullable), opinion, suggestion, updated_at.
- `anonymized_points`: id, event_id, participant_id, text, type, option_ids JSON, model.
- `analysis_jobs`: id, event_id, status, stage, done, total, error, started_at, finished_at.

The key is never a column in any table.

## 13. Retention and purge

Publishing deletes every row in `responses` and `anonymized_points` for the event in the same transaction that sets the state to `published`.
Participants remain, with name, status, and token hash, so approved devices can keep opening the report.
The report JSON embeds the quote text it uses and is self-contained afterwards.
Aggregates remain because they are already anonymous.

Expiry and deletion follow section 6.6.

## 14. Security and privacy guarantees

Each guarantee names where it is enforced.

1. Nobody reads raw responses but the job.
   The data layer exposes responses as write-only to the web routes, with one exception: a participant can read back their own submission, and only through their own device token, so they can edit it.
   The single "read all for event" function lives in the analysis module, and only close-time aggregation and the analysis job call it.
   No API route returns anyone else's response row or an anonymized point to any caller, host included.
2. Numbers appear only after the roster is final, and suppression is one shared function.
3. Tokens are 256-bit random values from the platform's crypto, stored as SHA-256 hashes, sent in headers, never in URLs, never logged, compared in constant time.
4. Keys travel in request bodies over HTTPS, live in memory, are redacted from logs and errors, and are never written to the database.
5. Rate limits: sixty submissions per minute per IP per event, twenty event creations or edits per hour per IP, five magic-link sends per hour per address and twenty per hour per IP, six analysis runs per ten minutes per event.
   Request bodies are capped in size.
6. No third-party scripts, no analytics, and no cookies for participants.
   Only the host's account session uses a cookie, so there is no consent banner.
7. The public repository holds no secrets.
   Configuration comes from environment variables with an example file committed.
8. A content security policy allows scripts and styles from the app's own origin only.

## 15. Testing strategy

A `fake` provider adapter returns deterministic rewrites and a canned report, so the whole product runs end to end with no key and no network.
It doubles as a demo mode.

Three layers of tests:

- Unit tests with Vitest for the aggregation math including Borda, Condorcet, cost counts, and suppression; the state machine, including that reopen does not exist; the purge transaction; token hashing and constant-time comparison; and magic-link expiry.
- Adapter tests with mocked HTTP for each provider covering model listing, structured output parsing, the JSON-in-text fallback, and rate-limit retry, plus recorded fixtures of real model output captured once with a real key and replayed offline.
- End-to-end tests with Playwright against the real server in a real browser at a phone viewport.
  One host context and many participant contexts act as separate devices and run the whole story: create with costs, submit, count-only while open, approve and reject, close, tallies appear and the roster locks, connect the fake provider, run, watch progress, read the draft, publish.
  Assertions: approved devices see the report, pending and rejected do not, raw rows are gone from the database, and no HTTP response during the entire run contained opinion text.
  Separate scenarios cover device lock, edit until close, suppression, auto-close with pending names, and magic-link sign-in through a test mail sink.
  Screenshots are captured on failure in Phase 1; the step-by-step capture for the pixel pass is part of Phase 4.

Lint, format, and type checks gate every commit through the CI run on every push; a local pre-commit hook is a Phase 4 item.
GitHub Actions runs all three layers on every push using the fake provider.
The e2e server sets `RATE_LIMIT_SCALE=10` so a full run cannot exhaust the per-IP rate limits; production leaves it unset.
A manual live spot-check script exists for real keys and is allowed to be flaky.
The fake-provider suite is not.

## 16. Build phases

Each phase gets its own implementation plan, and the next phase does not start until the harness is green.

1. Walking skeleton, deployed.
   Schema and migrations, token roles, create event with costs and an optional auto-close time, link screen, the participant form with the ranking widget and budget chips, device lock and edit until close, roster and approval, close with tallies and suppression, the fake-provider seam, the harness core scenario, and the Docker image running always-on on Fly with Litestream backups and basic rate limits from day one.
2. Analysis and report.
   The three adapters including OpenRouter connect, model picker, job runner with progress, the three stages with versioned prompts and schemas, draft, publish with purge, the report page with charts and the cost section, and copy summary.
3. Accounts and lifecycle.
   Magic-link sign-in, my events, claiming, expiry sweep, delete, QR code, and share sheet.
4. Polish and hardening.
   Pixel pass on real phones, PWA install manifest, content security policy, accessibility, a backup restore drill, and CI green across the board.

## 17. Assumptions and things the host must provide

- The hub VM with Docker, the DNS record for decide.acb-apps.com in Cloudflare, and a Resend account with acb-apps.com verified for magic links (originally a Fly.io app with a Litestream bucket; the Fly trial ended on 2026-09-21).
  `deploy/README.md` has the setup steps.
- The app is served at https://decide.acb-apps.com.
- The operator's own OpenRouter key is used only by the manual live spot-check script and is never configured on the server.
- Analysis cost is paid by the host through their own provider account.
  A thirty-person event costs cents on a mid-tier model and well under a dollar on a flagship.
