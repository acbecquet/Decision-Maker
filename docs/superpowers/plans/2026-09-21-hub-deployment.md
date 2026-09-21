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

## Deviations after review

The first review (652c4c0..5b5133f) and the fixes that followed changed the design in these ways; the code is the source of truth over the task text above.

- The service is named `decision-maker`, not `app`, because Compose registers a service's name as a DNS alias on every network it joins; with `app` on `edge`, Podium's Caddy could have resolved its own `app:8098` upstream to this container. The alias block is gone since the service name now carries the name.
- `/api/health` also reports `origin`, and the deploy script waits for both the commit and the `ORIGIN` from `deploy/.env.prod`, so a missing or wrong origin fails the deploy instead of surfacing as broken sign-in links; the script also refuses an `.env.prod` without `ORIGIN`, surfaces `docker compose config` errors, bounds the wait with a two-minute deadline, and passes `--remove-orphans` so a renamed service leaves no stale container behind.
- `backup.sh` opens each snapshot and runs `integrity_check` before reporting success, deleting the copy and exiting 1 otherwise, and prunes with `-mtime +13` so exactly the last 14 days are kept; the restore procedure checks the snapshot the same way first and was drilled on the hub.
- The e2e server runs with `APP_COMMIT=e2e`, so the health assertion checks the stamped value and the origin rather than any string.
- Podium's Caddy block also sets the sniff, frame, and referrer headers, because adapter-node serves static files outside the hook that sets them in the app.
- The OpenRouter referer fallback and the spot-check scripts name the new origin.
- The second review (5b5133f..57f9cf9) hardened `deploy/merge-event.mjs`: column lists come from `main.table_info` and are quoted, a different event already using the code is refused before anything is written, the copy runs in an immediate transaction and is verified row for row against the source before it commits, and the entry-point guard resolves symlinks; its test now reverses the source's `events` columns and compares every copied value by name, and the script header says the source must come from the backup API because a plain copy of a WAL database loses unflushed writes.
- The restore drill showed that opening a snapshot leaves `-wal` and `-shm` sidecars beside it, so `backup.sh` switches each snapshot to rollback-journal mode and the prune covers sidecars; the project-name guard in `deploy.sh` now runs before any Docker side effect and reads the name with `awk`.
- Recorded and left alone: the compose health check only feeds `docker compose ps`; the backup log is not rotated (one line a night); `deploy/backups/` must stay writable by the cron user, which the deploy script ensures by creating it first; the Litestream binary stays in the image for the retired Fly path; the hub's public address in the runbook will rot and the runbook says how to re-derive it.

### Task 5: Cutover on the hub

- [x] `docker network create edge` (done 2026-09-21).
- [x] Clone the repo, write `deploy/.env.prod` from the local key file without printing it, run the deploy script, and confirm health inside the stack (done 2026-09-21: `decision-maker-app-1` healthy, the alias answers on `edge` with the security headers, a create, view, and delete cycle through the alias with a forwarded address passed).
- [x] Charlie adds the DNS record; then pull Podium's Caddy change on the hub, `docker compose up -d caddy`, and reload Caddy once the record resolves (done 2026-09-21 18:13 UTC: the record resolved from three resolvers, Caddy was recreated once after confirming `app` no longer resolved on `edge`, and the certificate arrived within seconds).
- [x] Verify from outside: TLS, `/api/health` with the deployed commit, the security headers, a create and delete cycle, and a sign-in mail on the verified domain (done 2026-09-21: Let's Encrypt certificate, commit and origin in health, HSTS plus the three app headers on a page and on a static file, HTTP redirecting to HTTPS, a create and delete cycle through the site inside the restore drill, and a sign-in request for a non-owner address accepted with 200 where the sandbox sender used to answer 502).
- [x] Install the snapshot cron line and run it once (done 2026-09-21: first snapshot passed an integrity check).
- [x] Recover the Axis dinner event: once Fly access is restored with a card, take a copy of `/data/app.db` through SQLite's backup API (a plain copy of a WAL database loses unflushed writes) and merge that event's rows into the hub database with `deploy/merge-event.mjs` (done 2026-09-21: the copy came out through `fly ssh console` as base64 after `fly ssh sftp get` misparsed a Windows path, the merge reported 1, 3, 3, and 3 rows, and the event serves at its old code).
- [ ] Attach the event to Charlie's account after he signs in on the new domain, and then decide with him whether the Fly app and volume are destroyed.
