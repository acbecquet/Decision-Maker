#!/usr/bin/env bash
# Nightly snapshot of the production database into deploy/backups/ (mounted as
# /backups in the container), keeping 14 days. The copy goes through SQLite's
# backup API, so it is consistent even while the app is writing. Cron on the hub:
#   15 4 * * * /home/acbecquet/decision-maker/deploy/backup.sh >> /home/acbecquet/decision-maker/deploy/logs/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
docker compose -f deploy/docker-compose.yml exec -T app node -e "require('better-sqlite3')('/data/app.db', { readonly: true }).backup('/backups/app-${STAMP}.db').then(() => console.log('snapshot app-${STAMP}.db'))"
find deploy/backups -name 'app-*.db' -mtime +14 -delete
