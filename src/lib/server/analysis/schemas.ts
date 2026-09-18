import { z } from 'zod';
import { ANALYSIS } from '$lib/shared/constants';

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
		unexpected: {
			anyOf: [
				{
					type: 'object',
					properties: {
						kind: { type: 'string', enum: ['option', 'suggestion', 'compromise'] },
						optionId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
						title: { type: 'string' },
						rationale: { type: 'string' }
					},
					required: ['kind', 'optionId', 'title', 'rationale'],
					additionalProperties: false
				},
				{ type: 'null' }
			]
		},
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
	},
	required: ['best', 'runnerUp', 'worst', 'unexpected', 'themes', 'stillToSettle', 'summary'],
	additionalProperties: false
};

/** Throws when any object in the schema tree is not strict. Used by tests and at startup. */
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

export const anonymizeOutput = z.object({
	points: z
		.array(
			z.object({
				text: nonEmpty.max(600),
				type: z.enum(POINT_TYPES),
				optionIds: z.array(z.string())
			})
		)
		.max(ANALYSIS.maxPointsPerResponse)
});

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
});

export type AnonymizeOutput = z.infer<typeof anonymizeOutput>;
export type SynthesizeOutput = z.infer<typeof synthesizeOutput>;
