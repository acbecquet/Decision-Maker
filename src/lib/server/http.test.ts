import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { readJson } from './http';

const schema = z.object({ a: z.number() });
const post = (body: string, type?: string) =>
	new Request('http://x.test/', {
		method: 'POST',
		body,
		headers: type ? { 'content-type': type } : {}
	});

describe('readJson', () => {
	it('parses a JSON body with the JSON content type, with or without a charset', async () => {
		expect(await readJson(post('{"a":1}', 'application/json'), schema)).toEqual({ a: 1 });
		expect(await readJson(post('{"a":2}', 'Application/JSON; charset=utf-8'), schema)).toEqual({
			a: 2
		});
	});

	it('refuses a body without the JSON content type, however well formed', async () => {
		await expect(readJson(post('{"a":1}'), schema)).rejects.toThrow(/must be JSON/);
		await expect(readJson(post('{"a":1}', 'text/plain'), schema)).rejects.toThrow(/must be JSON/);
		await expect(
			readJson(post('a=1', 'application/x-www-form-urlencoded'), schema)
		).rejects.toThrow(/must be JSON/);
	});

	it('reports the first schema issue', async () => {
		await expect(readJson(post('{"a":"x"}', 'application/json'), schema)).rejects.toThrow();
	});
});
