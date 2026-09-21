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

/** A migrated file database whose handle the test can close, as openDatabase sets it up. */
function open(path: string) {
	const client = new Database(path);
	client.pragma('journal_mode = WAL');
	client.pragma('foreign_keys = ON');
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
				ranking: [ids[0], ids[1]],
				vetoes: [],
				budget: null,
				opinion: `${name} says`,
				suggestion: ''
			},
			{ autoApprove: false }
		);
	}
	return event.code;
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

function codes(path: string): string[] {
	const db = new Database(path, { readonly: true });
	try {
		return db
			.prepare('select code from events order by code')
			.all()
			.map((r) => (r as { code: string }).code);
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

	it('copies one event with its options, participants, and responses, and only that event', () => {
		const src = open(source);
		const wanted = seed(src.db, 'Axis dinner', ['Ana', 'Ben', 'Cleo']);
		seed(src.db, 'Left behind', ['Dev']);
		src.close();
		const dst = open(target);
		const own = seed(dst.db, 'Already on the hub', ['Eve', 'Finn']);
		dst.close();

		const result = mergeEvent(target, source, wanted);

		expect(result).toEqual({
			code: wanted,
			title: 'Axis dinner',
			copied: { events: 1, options: 2, participants: 3, responses: 3 }
		});
		expect(counts(target)).toEqual({
			events: 2,
			options: 4,
			participants: 5,
			responses: 5,
			fkProblems: 0
		});
		expect(codes(target)).toEqual([own, wanted].sort());
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
});
