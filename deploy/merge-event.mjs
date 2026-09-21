#!/usr/bin/env node
// Copies one event, with its options, participants, and responses, from another
// DecisionMaker database into this one, skipping rows that already exist.
// Written for the 2026-09-21 move off Fly, where an open event had to follow
// the app to the hub after the rest of the data had already diverged.
//
// Run it inside the app container so better-sqlite3 resolves, with the script
// mounted under /app and the source copy under /backups:
//   docker compose -f deploy/docker-compose.yml run --rm --no-deps \
//     -v "$PWD/deploy/merge-event.mjs:/app/deploy/merge-event.mjs:ro" \
//     app node deploy/merge-event.mjs /backups/<source>.db /data/app.db <event code>
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

/**
 * Merges the event with `code` from the database at `sourcePath` into the one
 * at `targetPath`. Returns the number of rows copied per table; a second run
 * copies nothing.
 */
export function mergeEvent(targetPath, sourcePath, code) {
	const db = new Database(targetPath);
	try {
		db.pragma('foreign_keys = ON');
		db.pragma('busy_timeout = 5000');
		db.prepare('attach database ? as src').run(sourcePath);
		const event = db.prepare('select id, title from src.events where code = ?').get(code);
		if (!event) throw new Error(`no event with code ${code} in ${sourcePath}`);

		// Column lists come from the target so the copy never depends on column order.
		const columns = (table) =>
			db
				.pragma(`table_info(${table})`)
				.map((c) => c.name)
				.join(', ');
		const copyWhere = (table, where) =>
			db.prepare(
				`insert or ignore into main.${table} (${columns(table)}) select ${columns(table)} from src.${table} where ${where}`
			);

		const copy = db.transaction((eventId) => ({
			events: copyWhere('events', 'id = ?').run(eventId).changes,
			options: copyWhere('options', 'event_id = ?').run(eventId).changes,
			participants: copyWhere('participants', 'event_id = ?').run(eventId).changes,
			responses: copyWhere(
				'responses',
				'participant_id in (select id from src.participants where event_id = ?)'
			).run(eventId).changes
		}));
		const copied = copy(event.id);
		db.prepare('detach database src').run();
		return { code, title: event.title, copied };
	} finally {
		db.close();
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const [source, target, code] = process.argv.slice(2);
	if (!source || !target || !code) {
		console.error('usage: node deploy/merge-event.mjs <source.db> <target.db> <event code>');
		process.exit(2);
	}
	console.log(JSON.stringify(mergeEvent(target, source, code)));
}
