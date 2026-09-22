#!/usr/bin/env bash
# Nightly snapshot of the production database into deploy/backups/ (mounted as
# /backups in the container), keeping the last 14 days. The copy goes through
# SQLite's backup API, so it is consistent even while the app is writing; it is
# written under a .part name, switched to rollback-journal mode so it is one
# self-contained file that leaves no -wal or -shm sidecar when opened, and
# integrity-checked, and only then renamed into place. A run that fails or is
# killed leaves no file that looks like a snapshot. Cron on the hub:
#   15 4 * * * bash /home/acbecquet/decision-maker/deploy/backup.sh >> /home/acbecquet/decision-maker/deploy/logs/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
docker compose -f deploy/docker-compose.yml exec -T -e "SNAPSHOT=/backups/app-${STAMP}.db" decision-maker node - <<'JS'
const fs = require('node:fs');
const Database = require('better-sqlite3');
const dest = process.env.SNAPSHOT;
const part = `${dest}.part`;
const live = new Database('/data/app.db', { readonly: true });
live
	.backup(part)
	.then(() => {
		live.close();
		const copy = new Database(part);
		let events;
		try {
			const mode = copy.pragma('journal_mode = delete', { simple: true });
			if (mode !== 'delete') throw new Error(`journal_mode is ${mode}, not delete`);
			const check = copy.pragma('integrity_check', { simple: true });
			if (check !== 'ok') throw new Error(`integrity_check said ${check}`);
			events = copy.prepare('select count(*) as n from events').get().n;
		} finally {
			copy.close();
		}
		fs.renameSync(part, dest);
		console.log(`snapshot ${dest}: ${events} events, integrity ok`);
	})
	.catch((err) => {
		for (const f of [part, `${part}-wal`, `${part}-shm`]) fs.rmSync(f, { force: true });
		console.error(`snapshot ${dest} failed and nothing was kept: ${err.message}`);
		process.exit(1);
	});
JS
find deploy/backups -name 'app-*.db*' -mtime +13 -delete
