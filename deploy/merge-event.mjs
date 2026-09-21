#!/usr/bin/env node
// Copies one event, with its options, participants, and responses, from another
// DecisionMaker database into this one, skipping rows that already exist.
// Written for the 2026-09-21 move off Fly, where an open event had to follow
// the app to the hub after the rest of the data had already diverged.
//
// The source must be a complete copy: one made through SQLite's backup API
// (what deploy/backup.sh produces) or a file whose -wal sidecar travelled with
// it. A plain cp of a live WAL-mode database silently loses every write still
// sitting in the write-ahead log.
// Only these four tables travel: the event must not belong to an account, since
// accounts are not copied, and an analysed event would arrive with its report
// but without its anonymized points and analysis jobs. Column lists come from
// the target, so a source at an older migration fails loudly on a missing
// column and a source at a newer one has its extra columns dropped.
//
// Run it inside the app container so better-sqlite3 resolves, with the script
// mounted under /app and the source copy under /backups:
//   docker compose -f deploy/docker-compose.yml run --rm --no-deps \
//     -v "$PWD/deploy/merge-event.mjs:/app/deploy/merge-event.mjs:ro" \
//     decision-maker node deploy/merge-event.mjs /backups/<source>.db /data/app.db <event code>
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

/** The tables that make up one event, each with the predicate that selects its rows. */
const TABLES = {
	events: 'id = ?',
	options: 'event_id = ?',
	participants: 'event_id = ?',
	responses: 'participant_id in (select id from {schema}.participants where event_id = ?)'
};

/**
 * Merges the event with `code` from the database at `sourcePath` into the one
 * at `targetPath`. Returns the number of rows copied per table; a second run
 * copies nothing. Throws, without changing the target, when the source lacks
 * the event, when the target already holds a different event under that code,
 * or when the target would end up with fewer rows for the event than the source has.
 */
export function mergeEvent(targetPath, sourcePath, code) {
	const db = new Database(targetPath);
	try {
		db.pragma('foreign_keys = ON');
		db.pragma('busy_timeout = 5000');
		db.prepare('attach database ? as src').run(sourcePath);
		const event = db.prepare('select id, title from src.events where code = ?').get(code);
		if (!event) throw new Error(`no event with code ${code} in ${sourcePath}`);

		// Column lists come from the target, by name, so the copy never depends on column order.
		const columns = (table) =>
			db
				.pragma(`main.table_info(${table})`)
				.map((c) => `"${c.name}"`)
				.join(', ');
		const rowsFor = (schema, table) =>
			db
				.prepare(
					`select count(*) as n from ${schema}.${table} where ${TABLES[table].replace('{schema}', schema)}`
				)
				.get(event.id).n;

		const copy = db.transaction(() => {
			const clash = db
				.prepare('select id from main.events where code = ? and id <> ?')
				.get(code, event.id);
			if (clash) throw new Error(`the target already holds a different event with code ${code}`);
			const copied = {};
			for (const [table, where] of Object.entries(TABLES)) {
				const cols = columns(table);
				copied[table] = db
					.prepare(
						`insert or ignore into main.${table} (${cols}) select ${cols} from src.${table} where ${where.replace('{schema}', 'src')}`
					)
					.run(event.id).changes;
			}
			for (const table of Object.keys(TABLES)) {
				const want = rowsFor('src', table);
				const have = rowsFor('main', table);
				if (have < want) {
					throw new Error(
						`${table}: the target holds ${have} rows for the event, the source ${want}`
					);
				}
			}
			return copied;
		});
		const copied = copy.immediate();
		db.prepare('detach database src').run();
		return { code, title: event.title, copied };
	} finally {
		db.close();
	}
}

function invokedDirectly() {
	if (!process.argv[1]) return false;
	let entry = process.argv[1];
	try {
		entry = realpathSync(entry);
	} catch {
		// Not a real file (node -e, node -): the raw value can never equal this module's path.
	}
	return fileURLToPath(import.meta.url) === entry;
}

if (invokedDirectly()) {
	const [source, target, code] = process.argv.slice(2);
	if (!source || !target || !code) {
		console.error('usage: node deploy/merge-event.mjs <source.db> <target.db> <event code>');
		process.exit(2);
	}
	console.log(JSON.stringify(mergeEvent(target, source, code)));
}
