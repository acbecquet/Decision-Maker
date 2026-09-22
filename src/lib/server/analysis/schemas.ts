import { z } from 'zod';
import { ANALYSIS } from '$lib/shared/constants';
import type { EventMode } from '$lib/shared/types';

export type JsonSchema = Record<string, unknown>;

const POINT_TYPES = ['reason', 'condition', 'constraint', 'suggestion', 'cost'] as const;

const stringArray = { type: 'array', items: { type: 'string' } };

export const ANONYMIZE_SCHEMA: JsonSchema = {
	type: 'object',
	properties: {
		points: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					text: { type: 'string', description: 'One rewritten point, one or two plain sentences.' },
					type: { type: 'string', enum: [...POINT_TYPES] },
					optionIds: { ...stringArray, description: 'Ids of the options this point is about.' }
				},
				required: ['text', 'type', 'optionIds'],
				additionalProperties: false
			}
		}
	},
	required: ['points'],
	additionalProperties: false
};

const optionRef = (extra: Record<string, unknown>) => ({
	type: 'object',
	properties: { optionId: { type: 'string' }, ...extra },
	required: ['optionId', ...Object.keys(extra)],
	additionalProperties: false
});

const unexpectedSchema = (kinds: readonly string[]) => ({
	anyOf: [
		{
			type: 'object',
			properties: {
				kind: { type: 'string', enum: [...kinds] },
				optionId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
				title: { type: 'string' },
				rationale: { type: 'string' }
			},
			required: ['kind', 'optionId', 'title', 'rationale'],
			additionalProperties: false
		},
		{ type: 'null' }
	]
});

/** What every mode reports: what the group said, what is left open, and the paragraph. */
const SYNTHESIZE_THEMES: Record<string, unknown> = {
	themes: {
		type: 'array',
		items: {
			type: 'object',
			properties: {
				title: { type: 'string' },
				summary: { type: 'string' },
				quotePointIds: {
					...stringArray,
					description: 'Up to three ids from the quotable points.'
				}
			},
			required: ['title', 'summary', 'quotePointIds'],
			additionalProperties: false
		}
	},
	stillToSettle: stringArray,
	summary: { type: 'string', description: 'One plain paragraph for the group chat.' }
};

export const SYNTHESIZE_SCHEMA: JsonSchema = {
	type: 'object',
	properties: {
		best: optionRef({
			verdict: { type: 'string', description: 'One line.' },
			rationale: { type: 'string' },
			consensus: { type: 'string', enum: ['strong', 'moderate', 'split'] }
		}),
		runnerUp: optionRef({ rationale: { type: 'string' } }),
		worst: optionRef({ rationale: { type: 'string', description: 'Factual, not harsh.' } }),
		unexpected: unexpectedSchema(['option', 'suggestion', 'compromise']),
		...SYNTHESIZE_THEMES
	},
	required: ['best', 'runnerUp', 'worst', 'unexpected', 'themes', 'stillToSettle', 'summary'],
	additionalProperties: false
};

/** An opinions-only event has no options, so no decision and no unexpected option either. */
export const SYNTHESIZE_SCHEMA_FREEFORM: JsonSchema = {
	type: 'object',
	properties: {
		unexpected: unexpectedSchema(['suggestion', 'compromise']),
		...SYNTHESIZE_THEMES
	},
	required: ['unexpected', 'themes', 'stillToSettle', 'summary'],
	additionalProperties: false
};

export const synthesizeSchemaFor = (mode: EventMode): JsonSchema =>
	mode === 'freeform' ? SYNTHESIZE_SCHEMA_FREEFORM : SYNTHESIZE_SCHEMA;

/** Throws when any object in the schema tree is not strict. Used by tests. */
export function assertStrict(schema: unknown, path = '$'): void {
	if (!schema || typeof schema !== 'object') return;
	const node = schema as Record<string, unknown>;
	if (node.type === 'object' || node.properties) {
		const props = Object.keys((node.properties as Record<string, unknown>) ?? {});
		const required = (node.required as string[]) ?? [];
		if (props.some((p) => !required.includes(p))) {
			throw new Error(`${path}: every property must be required`);
		}
		if (node.additionalProperties !== false) {
			throw new Error(`${path}: additionalProperties must be false`);
		}
		for (const p of props)
			assertStrict((node.properties as Record<string, unknown>)[p], `${path}.${p}`);
	}
	if (node.items) assertStrict(node.items, `${path}[]`);
	if (Array.isArray(node.anyOf)) node.anyOf.forEach((s, i) => assertStrict(s, `${path}|${i}`));
}

const nonEmpty = z.string().trim().min(1);

/**
 * A verbose rewrite is trimmed, not fatal: the job caps the point count and point length after
 * parsing (see `job.ts`), so this validator only enforces shape.
 */
export const anonymizeOutput = z.object({
	points: z.array(
		z.object({
			text: nonEmpty,
			type: z.enum(POINT_TYPES),
			optionIds: z.array(z.string())
		})
	)
});

const synthesizeThemes = {
	themes: z
		.array(
			z.object({
				title: nonEmpty,
				summary: nonEmpty,
				quotePointIds: z.array(z.string()).max(ANALYSIS.maxQuotesPerTheme)
			})
		)
		.min(ANALYSIS.minThemes)
		.max(ANALYSIS.maxThemes),
	stillToSettle: z.array(nonEmpty),
	summary: nonEmpty
};

export const synthesizeOutput = z.object({
	best: z.object({
		optionId: nonEmpty,
		verdict: nonEmpty,
		rationale: nonEmpty,
		consensus: z.enum(['strong', 'moderate', 'split'])
	}),
	runnerUp: z.object({ optionId: nonEmpty, rationale: nonEmpty }),
	worst: z.object({ optionId: nonEmpty, rationale: nonEmpty }),
	unexpected: z
		.object({
			kind: z.enum(['option', 'suggestion', 'compromise']),
			optionId: z.string().nullable(),
			title: nonEmpty,
			rationale: nonEmpty
		})
		.nullable(),
	...synthesizeThemes
});

export const synthesizeOutputFreeform = z.object({
	unexpected: z
		.object({
			kind: z.enum(['suggestion', 'compromise']),
			optionId: z.string().nullable(),
			title: nonEmpty,
			rationale: nonEmpty
		})
		.nullable(),
	...synthesizeThemes
});

export type AnonymizeOutput = z.infer<typeof anonymizeOutput>;
export type SynthesizeOutput = z.infer<typeof synthesizeOutput>;
export type SynthesizeOutputFreeform = z.infer<typeof synthesizeOutputFreeform>;

export const synthesizeOutputFor = (mode: EventMode) =>
	mode === 'freeform' ? synthesizeOutputFreeform : synthesizeOutput;
