import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Repository functions accept either the database or a transaction handle. */
export type DbLike = Db | Tx;

/** Opens (creating if needed) a SQLite database in WAL mode and applies pending migrations. */
export function openDatabase(url: string, migrationsFolder = 'drizzle'): Db {
	if (url !== ':memory:') mkdirSync(dirname(url), { recursive: true });
	const client = new Database(url);
	client.pragma('journal_mode = WAL');
	client.pragma('foreign_keys = ON');
	client.pragma('busy_timeout = 5000');
	const db = drizzle(client, { schema });
	migrate(db, { migrationsFolder });
	return db;
}

let instance: Db | undefined;

/** The process-wide database, opened lazily from DATABASE_URL. */
export function getDb(): Db {
	if (!instance) {
		const url = process.env.DATABASE_URL;
		if (!url) throw new Error('DATABASE_URL is not set');
		instance = openDatabase(url);
	}
	return instance;
}
