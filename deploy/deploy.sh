#!/usr/bin/env bash
# One-shot deploy on the hub, from the repo root: builds the image from the
# checked-out commit, bakes that commit into /api/health, starts the stack, and
# waits until the running app answers with the same commit and the configured
# origin. Safe to re-run. Needs Docker with the compose plugin and
# deploy/.env.prod (see .env.prod.example).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f deploy/.env.prod ]; then
	echo "ERROR: deploy/.env.prod is missing. Copy deploy/.env.prod.example and fill it in." >&2
	exit 1
fi
ORIGIN=$(sed -n 's/^ORIGIN=//p' deploy/.env.prod | tr -d '"' | head -1)
if [ -z "$ORIGIN" ]; then
	echo "ERROR: deploy/.env.prod has no ORIGIN; sign-in links and the OpenRouter callback are built from it." >&2
	exit 1
fi

# The edge network is shared with Podium Chasers' Caddy, which proxies to us on it.
docker network inspect edge > /dev/null 2>&1 || docker network create edge
mkdir -p deploy/backups deploy/logs

GIT_COMMIT=$(git rev-parse --short HEAD)
export GIT_COMMIT
CO="docker compose -f deploy/docker-compose.yml"

# Podium Chasers' stack on the same VM is the compose project "deploy" (named
# after its directory); a DecisionMaker project with any name but its own would
# replace Podium's containers, which happened once on 2026-09-21.
if ! CONFIG=$($CO config 2>&1); then
	echo "ERROR: docker compose config failed:" >&2
	echo "$CONFIG" >&2
	exit 1
fi
PROJECT=$(printf '%s\n' "$CONFIG" | sed -n 's/^name: //p' | head -1)
if [ "$PROJECT" != "decision-maker" ]; then
	echo "ERROR: the compose project resolves to '${PROJECT}', not decision-maker; refusing to touch another stack." >&2
	exit 1
fi

echo "==> building and starting decision-maker at ${GIT_COMMIT} for ${ORIGIN}"
$CO up -d --build --remove-orphans

echo "==> waiting for /api/health to report ${GIT_COMMIT} and ${ORIGIN}"
WANT="${GIT_COMMIT} ${ORIGIN}"
LIVE=none
DEADLINE=$((SECONDS + 120))
while [ "$SECONDS" -lt "$DEADLINE" ]; do
	LIVE=$($CO exec -T decision-maker node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => r.json()).then((b) => console.log(b.ok ? b.commit + ' ' + b.origin : 'not-ok'), () => console.log('down'))" 2> /dev/null || echo down)
	if [ "$LIVE" = "$WANT" ]; then
		echo "==> healthy at ${GIT_COMMIT} for ${ORIGIN}"
		$CO ps
		exit 0
	fi
	sleep 3
done

# A deploy whose app never answered is a failed deploy and must say so.
echo "ERROR: the app did not report '${WANT}' within two minutes (last answer: ${LIVE}). Recent logs:" >&2
$CO logs --no-log-prefix --tail=40 decision-maker >&2 || true
exit 1
