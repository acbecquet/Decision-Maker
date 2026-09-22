import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type {
	Aggregates,
	EventMode,
	EventState,
	ParticipantStatus,
	PointType
} from '../../shared/types';

export const accounts = sqliteTable('accounts', {
	id: text('id').primaryKey(),
	email: text('email').notNull().unique(),
	createdAt: text('created_at').notNull()
});

export const magicLinks = sqliteTable('magic_links', {
	tokenHash: text('token_hash').primaryKey(),
	email: text('email').notNull(),
	expiresAt: text('expires_at').notNull(),
	usedAt: text('used_at'),
	nonceHash: text('nonce_hash')
});

export const sessions = sqliteTable('sessions', {
	tokenHash: text('token_hash').primaryKey(),
	accountId: text('account_id')
		.notNull()
		.references(() => accounts.id, { onDelete: 'cascade' }),
	expiresAt: text('expires_at').notNull()
});

export const events = sqliteTable('events', {
	id: text('id').primaryKey(),
	code: text('code').notNull().unique(),
	title: text('title').notNull(),
	context: text('context').notNull().default(''),
	currency: text('currency').notNull(),
	mode: text('mode').$type<EventMode>().notNull().default('ranked'),
	state: text('state').$type<EventState>().notNull().default('open'),
	rosterFinal: integer('roster_final', { mode: 'boolean' }).notNull().default(false),
	hostTokenHash: text('host_token_hash').notNull(),
	accountId: text('account_id').references(() => accounts.id, { onDelete: 'set null' }),
	closesAt: text('closes_at'),
	closedAt: text('closed_at'),
	publishedAt: text('published_at'),
	expiresAt: text('expires_at').notNull(),
	provider: text('provider'),
	model: text('model'),
	promptVersion: text('prompt_version'),
	aggregates: text('aggregates', { mode: 'json' }).$type<Aggregates>(),
	report: text('report', { mode: 'json' }).$type<unknown>(),
	createdAt: text('created_at').notNull()
});

export const options = sqliteTable(
	'options',
	{
		id: text('id').primaryKey(),
		eventId: text('event_id')
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		position: integer('position').notNull(),
		label: text('label').notNull(),
		note: text('note').notNull().default(''),
		costPerPerson: real('cost_per_person')
	},
	(t) => [index('options_event_idx').on(t.eventId)]
);

export const participants = sqliteTable(
	'participants',
	{
		id: text('id').primaryKey(),
		eventId: text('event_id')
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		displayName: text('display_name').notNull(),
		deviceTokenHash: text('device_token_hash').notNull(),
		status: text('status').$type<ParticipantStatus>().notNull().default('pending'),
		createdAt: text('created_at').notNull()
	},
	(t) => [uniqueIndex('participants_event_device_idx').on(t.eventId, t.deviceTokenHash)]
);

export const responses = sqliteTable('responses', {
	participantId: text('participant_id')
		.primaryKey()
		.references(() => participants.id, { onDelete: 'cascade' }),
	ranking: text('ranking', { mode: 'json' }).$type<string[]>().notNull(),
	vetoes: text('vetoes', { mode: 'json' }).$type<string[]>().notNull(),
	budgetKind: text('budget_kind').$type<'limit' | 'no_limit'>(),
	budgetAmount: real('budget_amount'),
	opinion: text('opinion').notNull().default(''),
	suggestion: text('suggestion').notNull().default(''),
	updatedAt: text('updated_at').notNull()
});

export const anonymizedPoints = sqliteTable(
	'anonymized_points',
	{
		id: text('id').primaryKey(),
		eventId: text('event_id')
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		participantId: text('participant_id')
			.notNull()
			.references(() => participants.id, { onDelete: 'cascade' }),
		text: text('text').notNull(),
		type: text('type').$type<PointType>().notNull(),
		optionIds: text('option_ids', { mode: 'json' }).$type<string[]>().notNull(),
		model: text('model').notNull()
	},
	(t) => [index('anonymized_points_event_idx').on(t.eventId)]
);

export const analysisJobs = sqliteTable('analysis_jobs', {
	id: text('id').primaryKey(),
	eventId: text('event_id')
		.notNull()
		.references(() => events.id, { onDelete: 'cascade' }),
	status: text('status').$type<'running' | 'succeeded' | 'failed'>().notNull(),
	stage: text('stage'),
	done: integer('done').notNull().default(0),
	total: integer('total').notNull().default(0),
	error: text('error'),
	startedAt: text('started_at').notNull(),
	finishedAt: text('finished_at')
});

export type EventRow = typeof events.$inferSelect;
export type OptionRow = typeof options.$inferSelect;
export type ParticipantRow = typeof participants.$inferSelect;
export type ResponseRow = typeof responses.$inferSelect;
