# Deploying DecisionMaker to decide.acb-apps.com

The app runs on the hub, the always-on Ubuntu VM on Charlie's workstation that already serves Podium Chasers.
Podium's Caddy container owns ports 80 and 443 on that VM and terminates TLS for every site on the box.
DecisionMaker joins the shared Docker network `edge`, and a site block in Podium's Caddyfile proxies `decide.acb-apps.com` to the network alias `decision-maker` on port 3000.

```
browser --TLS--> Caddy (Podium's stack, on `edge`) --> decision-maker:3000 --> /data/app.db (volume dm-data)
```

## The snapshot rule

The deployed site is the commit checked out on the hub at deploy time.
`deploy/deploy.sh` bakes that commit into the image, `/api/health` reports it, and the script exits 0 only once the running app answers with the same commit.
Never edit code on the hub.

## First-time setup on the hub

1. `git clone https://github.com/acbecquet/Decision-Maker ~/decision-maker`
2. `cp deploy/.env.prod.example deploy/.env.prod` and fill in the Resend key.
3. `bash deploy/deploy.sh` creates the `edge` network if it is missing, builds, starts, and waits for health.
4. In Podium's checkout, pull the Caddyfile that carries the `decide.acb-apps.com` block and recreate Caddy with `docker compose -f deploy/docker-compose.yml up -d caddy`.
5. Add the DNS record below.
6. Schedule nightly snapshots: `15 4 * * * /home/acbecquet/decision-maker/deploy/backup.sh >> /home/acbecquet/decision-maker/deploy/logs/backup.log 2>&1`

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

```sh
curl -s https://decide.acb-apps.com/api/health           # {"ok":true,"commit":"<hash>"}
docker compose -f deploy/docker-compose.yml ps           # app Up (healthy)
docker compose -f deploy/docker-compose.yml logs -f app
```

## Backups and restore

`deploy/backup.sh` writes a consistent copy of the database to `deploy/backups/app-<stamp>.db` and keeps 14 days.
Snapshots sit on the same VM as the database, so they cover mistakes and corruption, not the loss of the VM; copy them elsewhere for that.

Restore a snapshot (the stale write-ahead log must go with the old file, or SQLite would replay it over the restored copy):

```sh
CO="docker compose -f deploy/docker-compose.yml"
$CO stop app
$CO run --rm --no-deps --entrypoint sh app -c 'rm -f /data/app.db-wal /data/app.db-shm && cp /backups/app-<stamp>.db /data/app.db'
$CO start app
```

## Client addresses

Caddy appends the real client address to `X-Forwarded-For`; the app reads exactly that last entry (`ADDRESS_HEADER=X-Forwarded-For`, `XFF_DEPTH=1`), so a client cannot spoof its way past the rate limits.

## Fly.io

`fly.toml` and the Litestream branch of the entrypoint are the retired Fly deployment, kept in case a managed host is ever needed again.
The Fly trial ended on 2026-09-21 and the app there stopped serving.
