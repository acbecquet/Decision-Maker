#!/usr/bin/env bash
# Nightly snapshot of the production database into deploy/backups/ (mounted as
# /backups in the container), keeping the last 14 days. The copy goes through
# SQLite's backup API, so it is consistent even while the app is writing; it is
# then switched to rollback-journal mode, so it is one self-contained file that
# leaves no -wal or -shm sidecar when opened, and integrity-checked before the
# script reports success. A bad copy is deleted and the script exits 1.
# Cron on the hub:
#   15 4 * * * /home/acbecquet/decision-maker/deploy/backup.sh >> /home/acbecquet/decision-maker/deploy/logs/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
docker compose -f deploy/docker-compose.yml exec -T -e "SNAPSHOT=/backups/app-${STAMP}.db" decision-maker node - <<'JS'
const fs = require('node:fs');
const Database = require('better-sqlite3');
const dest = process.env.SNAPSHOT;
const live = new Database('/data/app.db', { readonly: true });
live
	.backup(dest)
	.then(() => {
		const copy = new Database(dest);
		copy.pragma('journal_mode = delete');
		const check = copy.pragma('integrity_check')[0].integrity_check;
		const events = copy.prepare('select count(*) as n from events').get().n;
		copy.close();
		if (check !== 'ok') throw new Error(`integrity_check said ${check}`);
		console.log(`snapshot ${dest}: ${events} events, integrity ok`);
	})
	.catch((err) => {
		for (const f of [dest, `${dest}-wal`, `${dest}-shm`]) fs.rmSync(f, { force: true });
		console.error(`snapshot ${dest} failed and was removed: ${err.message}`);
		process.exit(1);
	});
JS
find deploy/backups -name 'app-*.db*' -mtime +13 -delete
