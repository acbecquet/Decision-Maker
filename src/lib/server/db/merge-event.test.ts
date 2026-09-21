import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mergeEvent } from '../../../../deploy/merge-event.mjs';
import { createEvent, listOptions } from '../events';
import { submitResponse } from '../participants';
import * as schema from './schema';

const input = {
	title: 'Axis dinner',
	context: 'Date and dishes',
	currency: 'USD' as const,
	options: [
		{ label: 'Monday', note: '', cost: null },
		{ label: 'Friday', note: '', cost: null }
	],
	closesAt: null
};

/** A migrated file database set up the way openDatabase does it, with a handle the test can close. */
function open(path: string) {
	const client = new Database(path);
	client.pragma('journal_mode = WAL');
	client.pragma('foreign_keys = ON');
	client.pragma('busy_timeout = 5000');
	const db = drizzle(client, { schema });
	migrate(db, { migrationsFolder: 'drizzle' });
	return { db, close: () => client.close() };
}

function seed(db: ReturnType<typeof open>['db'], title: string, names: string[]): string {
	const event = createEvent(db, { ...input, title }, 'a'.repeat(64));
	const ids = listOptions(db, event.id).map((o) => o.id);
	for (const [i, name] of names.entries()) {
		submitResponse(
			db,
			event,
			ids,
			String(i).repeat(64),
			{
				name,
				ranking: [ids[1], ids[0]],
				vetoes: [ids[0]],
				budget: null,
				opinion: `${name} says`,
				suggestion: `${name} suggests`
			},
			{ autoApprove: false }
		);
	}
	return event.code;
}

/** Rebuilds the events table with its columns in reverse order, so a copy by position lands every value in the wrong column. */
function reverseEventsColumns(path: string) {
	const db = new Database(path);
	db.pragma('foreign_keys = OFF');
	const cols = (db.pragma('table_info(events)') as { name: string; type: string }[]).reverse();
	const defs = cols
		.map((c) => `"${c.name}" ${c.type}${c.name === 'id' ? ' primary key' : ''}`)
		.join(', ');
	const names = cols.map((c) => `"${c.name}"`).join(', ');
	db.exec(
		`create table events_reversed (${defs}, unique("code"));
		 insert into events_reversed (${names}) select ${names} from events;
		 drop table events;
		 alter table events_reversed rename to events;`
	);
	db.close();
}

type Row = Record<string, unknown>;

/** Every row that belongs to one event, by column name, in a stable order. */
function eventRows(path: string, code: string): Record<string, Row[]> {
	const db = new Database(path, { readonly: true });
	try {
		const event = db.prepare('select id from events where code = ?').get(code) as
			{ id: string } | undefined;
		if (!event) return {};
		const rows = (sql: string) =>
			(db.prepare(sql).all(event.id) as Row[]).map((r) =>
				Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)))
			);
		return {
			events: rows('select * from events where id = ?'),
			options: rows('select * from options where event_id = ? order by position'),
			participants: rows('select * from participants where event_id = ? order by display_name'),
			responses: rows(
				'select r.* from responses r join participants p on p.id = r.participant_id where p.event_id = ? order by p.display_name'
			)
		};
	} finally {
		db.close();
	}
}

function counts(path: string) {
	const db = new Database(path, { readonly: true });
	try {
		const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
		return {
			events: n('select count(*) n from events'),
			options: n('select count(*) n from options'),
			participants: n('select count(*) n from participants'),
			responses: n('select count(*) n from responses'),
			fkProblems: (db.pragma('foreign_key_check') as unknown[]).length
		};
	} finally {
		db.close();
	}
}

describe('mergeEvent', () => {
	let dir: string;
	let source: string;
	let target: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'dm-merge-'));
		source = join(dir, 'source.db');
		target = join(dir, 'target.db');
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('copies every value of one event by column name, and only that event', () => {
		const src = open(source);
		const wanted = seed(src.db, 'Axis dinner', ['Ana', 'Ben', 'Cleo']);
		const leftBehind = seed(src.db, 'Left behind', ['Dev']);
		src.close();
		reverseEventsColumns(source);
		const dst = open(target);
		const own = seed(dst.db, 'Already on the hub', ['Eve', 'Finn']);
		dst.close();
		const ownBefore = eventRows(target, own);

		const result = mergeEvent(target, source, wanted);

		expect(result).toEqual({
			code: wanted,
			title: 'Axis dinner',
			copied: { events: 1, options: 2, participants: 3, responses: 3 }
		});
		const copied = eventRows(target, wanted);
		expect(copied).toEqual(eventRows(source, wanted));
		expect(copied.events[0]).toMatchObject({
			title: 'Axis dinner',
			currency: 'USD',
			state: 'open'
		});
		expect(copied.responses.map((r) => r.opinion)).toEqual(['Ana says', 'Ben says', 'Cleo says']);
		expect(eventRows(target, own)).toEqual(ownBefore);
		expect(eventRows(target, leftBehind)).toEqual({});
		expect(counts(target)).toEqual({
			events: 2,
			options: 4,
			participants: 5,
			responses: 5,
			fkProblems: 0
		});
	});

	it('copies nothing on a second run', () => {
		const src = open(source);
		const wanted = seed(src.db, 'Axis dinner', ['Ana']);
		src.close();
		open(target).close();

		mergeEvent(target, source, wanted);
		const again = mergeEvent(target, source, wanted);

		expect(again.copied).toEqual({ events: 0, options: 0, participants: 0, responses: 0 });
		expect(counts(target).participants).toBe(1);
	});

	it('refuses an unknown code without touching the target', () => {
		open(source).close();
		open(target).close();

		expect(() => mergeEvent(target, source, 'nope')).toThrow(/no event with code nope/);
		expect(counts(target).events).toBe(0);
	});

	it('rolls back and reports when a row of the event cannot be copied', () => {
		const src = open(source);
		const wanted = seed(src.db, 'Axis dinner', ['Ana']);
		src.close();
		const dst = open(target);
		const own = seed(dst.db, 'Already on the hub', ['Eve']);
		dst.close();
		// Give the target's own event a participant whose id collides with Ana's, so that
		// insert or ignore skips her silently and the copy comes up one row short.
		const srcRaw = new Database(source, { readonly: true });
		const ana = srcRaw.prepare('select id from participants').get() as { id: string };
		srcRaw.close();
		const raw = new Database(target);
		const ownId = (raw.prepare('select id from events where code = ?').get(own) as { id: string })
			.id;
		raw
			.prepare(
				'insert into participants (id, event_id, display_name, device_token_hash, status, created_at) values (?, ?, ?, ?, ?, ?)'
			)
			.run(ana.id, ownId, 'Zed', 'f'.repeat(64), 'approved', '2026-09-21T00:00:00.000Z');
		raw.close();
		const before = counts(target);

		expect(() => mergeEvent(target, source, wanted)).toThrow(
			/participants: the target holds 0 rows for the event, the source 1/
		);
		expect(eventRows(target, wanted)).toEqual({});
		expect(counts(target)).toEqual(before);
	});

	it('refuses to merge over a different event that already uses the code', () => {
		const dst = open(target);
		const taken = seed(dst.db, 'Already on the hub', ['Eve']);
		dst.close();
		const src = open(source);
		seed(src.db, 'Axis dinner', ['Ana']);
		src.close();
		const raw = new Database(source);
		raw.prepare('update events set code = ?').run(taken);
		raw.close();

		expect(() => mergeEvent(target, source, taken)).toThrow(/different event with code/);
		expect(counts(target)).toMatchObject({ events: 1, participants: 1 });
	});
});
