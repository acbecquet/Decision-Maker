import { openDatabase, type Db } from './db';
import type { EventRow } from './db/schema';
import { createEvent } from './events';
import type { CreateEventInput, ResponseInput } from '$lib/shared/validation';

export const HOST_HASH = 'a'.repeat(64);

export function makeDb(): Db {
	return openDatabase(':memory:');
}

/** An event with four options: Tapas 25, Beach 15, Rooftop 45, Paella with no cost. */
export function makeEvent(db: Db, overrides: Partial<CreateEventInput> = {}): EventRow {
	return createEvent(
		db,
		{
			title: 'Saturday night',
			context: '',
			currency: 'EUR',
			mode: 'ranked',
			options: [
				{ label: 'Tapas', note: '', cost: 25 },
				{ label: 'Beach', note: '', cost: 15 },
				{ label: 'Rooftop', note: '', cost: 45 },
				{ label: 'Paella', note: '', cost: null }
			],
			closesAt: null,
			...overrides
		},
		HOST_HASH
	);
}

export function response(
	name: string,
	ranking: string[],
	extra: Partial<ResponseInput> = {}
): ResponseInput {
	return { name, ranking, vetoes: [], budget: null, opinion: '', suggestion: '', ...extra };
}
