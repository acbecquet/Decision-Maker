import { error } from '@sveltejs/kit';
import type { z } from 'zod';
import { AppError, badRequest } from './errors';

/** Parses a JSON body against a schema. Throws a 400 AppError with the first issue's message. */
export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw badRequest('Body must be JSON');
	}
	const result = schema.safeParse(body);
	if (!result.success) throw badRequest(result.error.issues[0]?.message ?? 'Invalid input');
	return result.data;
}

/** Converts an AppError into a SvelteKit HTTP error and rethrows anything else. */
export function raise(e: unknown): never {
	if (e instanceof AppError) error(e.status, e.message);
	throw e;
}
