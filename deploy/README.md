# Deploying DecisionMaker to decide.acb-apps.com

The app runs on the hub, the always-on Ubuntu VM on Charlie's workstation that already serves Podium Chasers.
Podium's Caddy container owns ports 80 and 443 on that VM and terminates TLS for every site on the box.
DecisionMaker joins the shared Docker network `edge`, and a site block in Podium's Caddyfile proxies `decide.acb-apps.com` to the service `decision-maker` on port 3000.

```
browser --TLS--> Caddy (Podium's stack, on `edge`) --> decision-maker:3000 --> /data/app.db (volume decision-maker_dm-data)
```

## The snapshot rule

The deployed site is the commit checked out on the hub at deploy time.
`deploy/deploy.sh` bakes that commit into the image, `/api/health` reports it together with the configured origin, and the script exits 0 only once the running app answers with both.
Never edit code on the hub.

## Two stacks, one VM

Podium's compose project is called `deploy`, after the directory its compose file lives in.
Compose would give this stack the same name for the same reason, and two projects with one name replace each other's containers; the first deploy did exactly that to Podium for two minutes.
So `deploy/docker-compose.yml` names the project `decision-maker` explicitly, `deploy/deploy.sh` refuses to run under any other resolved name, and the service is named `decision-maker` rather than `app`, because Compose registers a service's name as a DNS alias on every network it joins and Podium's Caddy reaches its own app as `app`.

## First-time setup on the hub

1. `git clone https://github.com/acbecquet/Decision-Maker ~/decision-maker`
2. `cp deploy/.env.prod.example deploy/.env.prod` and fill in the Resend key.
3. `bash deploy/deploy.sh` creates the `edge` network if it is missing, builds, starts, and waits for health.
4. Add the DNS record below and wait for it to resolve.
5. In Podium's checkout, pull the Caddyfile that carries the `decide.acb-apps.com` block and recreate Caddy with `docker compose -f deploy/docker-compose.yml up -d caddy`.
6. Schedule nightly snapshots: `15 4 * * * bash /home/acbecquet/decision-maker/deploy/backup.sh >> /home/acbecquet/decision-maker/deploy/logs/backup.log 2>&1`

## Deploy a new version

From the dev box:

```sh
ssh f1w-hub 'cd ~/decision-maker && git pull --ff-only && bash deploy/deploy.sh'
```

The build takes a few minutes.
When it must outlive a tool call, run it detached on the hub with `nohup bash deploy/deploy.sh > deploy/logs/deploy-$(date -u +%Y%m%dT%H%M%SZ).log 2>&1 &` and read the log.

## The DNS record

acb-apps.com's nameservers are Cloudflare's, so the record goes in the Cloudflare dashboard, not the Squarespace panel: type `A`, name `decide`, IPv4 the hub's public address (98.167.159.18 when this was written; `curl https://api.ipify.org` on the hub confirms), proxy status DNS only (grey cloud).
An orange cloud would put Cloudflare's TLS in front of Caddy and break Caddy's own certificate issuance.
Once the record resolves, `docker exec deploy-caddy-1 caddy reload --config /etc/caddy/Caddyfile` makes Caddy fetch the certificate right away instead of waiting for its next retry.

## Verify

Caddy checks the upstream every 30 seconds, so the public site can answer 502 for up to half a minute after a deploy the script already called healthy.

```sh
curl -s https://decide.acb-apps.com/api/health           # {"ok":true,"commit":"<hash>","origin":"https://decide.acb-apps.com"}
docker compose -f deploy/docker-compose.yml ps           # decision-maker Up (healthy)
docker compose -f deploy/docker-compose.yml logs -f decision-maker
```

`commit` must match the deployed commit and `origin` the public address, or sign-in links and the OpenRouter callback point at the wrong place.
A health `GET` proves neither writes nor mail, so also create a throwaway event on the site and delete it from its host view, and request a sign-in link to your own address from `/signin`: the mail arrives from the sender in `deploy/.env.prod` and the link opens on the public origin.

## Backups and restore

`deploy/backup.sh` writes a consistent copy of the database to `deploy/backups/app-<stamp>.db`, switches the copy to rollback-journal mode so it is one self-contained file that leaves no sidecars when opened, runs SQLite's integrity check before reporting success, removes the copy and exits 1 otherwise, and keeps the last 14 days.
Snapshots sit on the same VM as the database, so they cover mistakes and corruption, not the loss of the VM; copy them elsewhere for that.
`deploy/backups/` must stay writable by the cron user, which `deploy.sh` ensures by creating it before the stack first starts.

Restore a snapshot; the stale write-ahead log must go with the old file, or SQLite would replay it over the restored copy:

```sh
CO="docker compose -f deploy/docker-compose.yml"
$CO exec -T decision-maker node -e "console.log(require('better-sqlite3')('/backups/app-<stamp>.db', { readonly: true }).pragma('integrity_check'))"   # [ { integrity_check: 'ok' } ]
$CO stop decision-maker
$CO run --rm --no-deps --entrypoint sh decision-maker -c 'rm -f /data/app.db-wal /data/app.db-shm && cp /backups/app-<stamp>.db /data/app.db'
$CO start decision-maker
```

This was drilled on 2026-09-21: an event created, snapshotted, deleted, and restored came back intact.

## Carrying an event in from another database

`deploy/merge-event.mjs` copies one event, with its options, participants, and responses, from another DecisionMaker database into the live one, skipping rows that already exist and refusing to leave a partial copy behind.
The source must be a copy made through SQLite's backup API, like the snapshots above, or a file whose `-wal` sidecar came with it; a plain copy of a live database loses the writes still in its write-ahead log.
Put the source under `deploy/backups/`, run the merge from the repo root, check the counts it prints, and remove the source afterwards, since it holds every event of the other deployment:

```sh
docker compose -f deploy/docker-compose.yml run --rm --no-deps -v "$PWD/deploy/merge-event.mjs:/app/deploy/merge-event.mjs:ro" decision-maker node deploy/merge-event.mjs /backups/<source>.db /data/app.db <event code>
rm deploy/backups/<source>.db
```

Attaching the event to an account afterwards is one update of `events.account_id` for the event's code.

## Disk

Every deploy leaves a Docker build cache behind, and the VM's disk is shared with Podium Chasers; a full disk takes both sites down.
A weekly cron on the hub prunes cache older than a week, which only slows the next build: `0 5 * * 0 docker builder prune -f --filter until=168h >> /home/acbecquet/decision-maker/deploy/logs/prune.log 2>&1`.
`docker system df` and `df -h /` show where the space went; `docker builder prune -f` clears all unused cache when it is urgent.

## Client addresses

Caddy appends the real client address to `X-Forwarded-For`; the app reads exactly that last entry (`ADDRESS_HEADER=X-Forwarded-For`, `XFF_DEPTH=1`), so a client cannot spoof its way past the rate limits.

## Fly.io

`fly.toml` and the Litestream branch of the entrypoint are the retired Fly deployment, kept in case a managed host is ever needed again.
The Fly trial ended on 2026-09-21 and the app there stopped serving.
