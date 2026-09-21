# Hub Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move DecisionMaker from the Fly.io trial, which ended on 2026-09-21, to the hub VM that already serves Podium Chasers, at https://decide.acb-apps.com, with the same deploy shape Podium uses.

**Architecture:** One Docker Compose stack (the app and a named volume for the SQLite file) on the hub, joined to a shared Docker network `edge`; Podium Chasers' Caddy container, which already owns ports 80 and 443, gets one more site block that proxies `decide.acb-apps.com` to the app by its network alias.
The deploy script stamps the checked-out commit into the image and `/api/health` reports it, so one request settles what is live.
A nightly cron snapshot of the database replaces Litestream, which had no bucket to write to.

**Tech Stack:** Docker Compose, Caddy 2 (Podium's container), SvelteKit adapter-node, better-sqlite3, cron.

## Global Constraints

- Provider keys travel only in request bodies over TLS that terminates on the hub itself, never through a third party's proxy; this rules out the Cloudflare tunnel that also runs on the hub.
- The app reads the client address from the last entry of `X-Forwarded-For` (`XFF_DEPTH=1`), which is the one Caddy appended.
- Podium Chasers keeps serving throughout; only its Caddy container is recreated, once, for the network change.
- Nothing is edited on the hub by hand; every change lands in a repo and reaches the hub through `git pull --ff-only` and the deploy script.
- No em dashes; commit messages carry no co-author or generated-by lines.
- `npm run lint`, `npm run check`, `npx vitest run`, and `npm run test:e2e` pass before merge.

## Decisions

- Why the hub and not a paid Fly plan: Charlie's call on 2026-09-21; the trial's five-minute machine lifetime had already made analysis runs impossible.
- Why Caddy and not the tunnel: TLS ends on Charlie's own VM, which keeps the privacy promise about provider keys, and it is the shape Podium already runs.
- Why a shared `edge` network and an alias: both compose projects have a service named `app`, so Caddy proxies to the unambiguous alias `decision-maker` on a network only the two stacks share.
- Why a cron snapshot and not Litestream: the snapshots are plain SQLite files anyone can open and restore, and a file replica on the same VM would add nothing over them.
- Fly's config stays in the repo as the retired path.

## What went wrong on the first hub deploy

Compose derives a project name from the compose file's directory when none is given, and both this repo and Podium Chasers keep their compose file in a directory named `deploy`.
The first deploy on 2026-09-21 at 17:49 UTC therefore ran as project `deploy` and recreated Podium's `deploy-app-1` container with the DecisionMaker image; podium.acb-apps.com answered 502 for about two minutes until `docker compose -f deploy/docker-compose.yml up -d --no-build app` in Podium's checkout put its own container back.
Podium's data volume and pushed replica were never touched.
The compose file now sets `name: decision-maker`, the deploy script refuses to run when the resolved project name is anything else, and the stray `deploy_dm-data` volume from the collision was removed.

---

### Task 1: Commit stamp in the image and the health endpoint

**Files:**
- Modify: `deploy/Dockerfile`
- Modify: `src/routes/api/health/+server.ts`
- Test: `e2e/api.e2e.ts`

- [x] `deploy/Dockerfile` declares `ARG GIT_COMMIT=unknown` in the runtime stage and exports it as `APP_COMMIT`.
- [x] `GET /api/health` answers `{ ok: true, commit }` with `process.env.APP_COMMIT || 'unknown'`.
- [x] `e2e/api.e2e.ts` asserts the health body has `ok: true` and a string `commit`.

### Task 2: The compose stack, deploy script, backups, and env template

**Files:**
- Create: `deploy/docker-compose.yml`
- Create: `deploy/deploy.sh`
- Create: `deploy/backup.sh`
- Create: `deploy/.env.prod.example`
- Modify: `.gitignore`

- [x] The compose file builds `deploy/Dockerfile` with `GIT_COMMIT`, mounts the named volume `dm-data` at `/data` and `./backups` at `/backups`, sets the forwarded-address and safety env vars, joins the external network `edge` with the alias `decision-maker`, and has a Node-based health check.
- [x] `deploy/deploy.sh` refuses to run without `deploy/.env.prod`, creates `edge` if missing, builds and starts the stack, and waits up to 90 seconds for `/api/health` to report the deployed commit, printing the app logs and exiting 1 otherwise.
- [x] `deploy/backup.sh` snapshots the database through SQLite's backup API into `deploy/backups/` and deletes snapshots older than 14 days.
- [x] `.gitignore` keeps `deploy/.env.prod.example` tracked and ignores `deploy/backups/` and `deploy/logs/`.

### Task 3: Podium Chasers' edge

**Files (in the formula-watchers repo):**
- Modify: `deploy/docker-compose.yml`
- Modify: `deploy/Caddyfile`
- Modify: `deploy/README.md`

- [x] The `caddy` service joins `default` and the external network `edge`.
- [x] A `decide.acb-apps.com` site block adds HSTS, drops the `Server` header, and proxies to `decision-maker:3000` with an active health check on `/api/health`; the app sets its own frame, sniff, referrer, and content security headers.
- [x] Podium's deploy README explains the shared edge.

### Task 4: Docs

- [x] `deploy/README.md` is the runbook: first-time setup, deploy, the DNS record, verification, backups and restore, client addresses, and the retired Fly path.
- [x] The root README's deploy section points there.
- [x] The design spec's status line, hosting row, system overview, and assumptions carry the dated change.

### Task 5: Cutover on the hub

- [x] `docker network create edge` (done 2026-09-21).
- [x] Clone the repo, write `deploy/.env.prod` from the local key file without printing it, run the deploy script, and confirm health inside the stack (done 2026-09-21: `decision-maker-app-1` healthy, the alias answers on `edge` with the security headers, a create, view, and delete cycle through the alias with a forwarded address passed).
- [ ] Charlie adds the DNS record; then pull Podium's Caddy change on the hub, `docker compose up -d caddy`, and reload Caddy once the record resolves.
- [ ] Verify from outside: TLS, `/api/health` with the deployed commit, the security headers, a create and delete cycle, and a sign-in mail on the verified domain.
- [x] Install the snapshot cron line and run it once (done 2026-09-21: first snapshot passed an integrity check).
- [ ] Recover the Axis dinner event: once Fly access is restored with a card, copy `/data/app.db` off the volume, merge that event's rows into the hub database, and attach the event to Charlie's account after he signs in.
