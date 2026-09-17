import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { openDatabase } from './index';
import { participants } from './schema';

const expectedTables = [
	'accounts',
	'magic_links',
	'sessions',
	'events',
	'options',
	'participants',
	'responses',
	'anonymized_points',
	'analysis_jobs'
];

describe('openDatabase', () => {
	it('migrates every table into a fresh database', () => {
		const db = openDatabase(':memory:');
		const rows = db.all<{ name: string }>(
			sql`select name from sqlite_master where type = 'table' order by name`
		);
		const names = rows.map((r) => r.name);
		for (const table of expectedTables) expect(names).toContain(table);
	});

	it('enforces foreign keys', () => {
		const db = openDatabase(':memory:');
		expect(() =>
			db
				.insert(participants)
				.values({
					id: 'p1',
					eventId: 'missing',
					displayName: 'Alex',
					deviceTokenHash: 'x',
					createdAt: new Date().toISOString()
				})
				.run()
		).toThrow(/FOREIGN KEY/);
	});
});
