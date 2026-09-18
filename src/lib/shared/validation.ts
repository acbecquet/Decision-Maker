import { z } from 'zod';
import { CURRENCIES, EFFORTS, LIMITS, PROVIDER_IDS } from './constants';

const trimmed = (max: number) => z.string().trim().max(max, `At most ${max} characters`);

const twoDecimals = (n: number) => Math.round(n * 100) / 100 === n;

export const money = z
	.number()
	.min(0, 'Cost cannot be negative')
	.max(LIMITS.maxCost, 'Cost is too large')
	.refine(twoDecimals, 'Use at most two decimals');

const isoInstant = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Not a valid date');

export const optionInput = z.object({
	label: trimmed(LIMITS.optionLabel).min(1, 'Every option needs a label'),
	note: trimmed(LIMITS.optionNote).default(''),
	cost: money.nullable().default(null)
});

export const createEventInput = z.object({
	title: trimmed(LIMITS.title).min(1, 'Enter a title'),
	context: trimmed(LIMITS.context).default(''),
	currency: z.enum(CURRENCIES, 'Pick a currency'),
	options: z
		.array(optionInput)
		.min(LIMITS.minOptions, 'Add at least two options')
		.max(LIMITS.maxOptions, `At most ${LIMITS.maxOptions} options`),
	closesAt: isoInstant.nullable().default(null)
});

export const budgetInput = z
	.union([
		z.object({ kind: z.literal('limit'), amount: money }),
		z.object({ kind: z.literal('no_limit') })
	])
	.nullable();

export const responseInput = z.object({
	name: trimmed(LIMITS.name).min(1, 'Enter your name'),
	ranking: z.array(z.string().min(1)).min(1, 'Rank at least one option').max(LIMITS.maxOptions),
	vetoes: z.array(z.string().min(1)).max(LIMITS.maxOptions).default([]),
	budget: budgetInput.default(null),
	opinion: trimmed(LIMITS.opinion).default(''),
	suggestion: trimmed(LIMITS.suggestion).default('')
});

export const editResponseInput = responseInput.omit({ name: true });

export const closeInput = z.object({ pending: z.enum(['approve', 'reject']) });

export const patchEventInput = z.object({ closesAt: isoInstant.nullable() });

export const participantStatusInput = z.object({ status: z.enum(['approved', 'rejected']) });

const providerKey = z.string().min(1, 'Enter a key').max(4096);

/** The fake provider accepts any non-empty key; a real provider's key must at least look like one. */
const looksLikeKey = (v: { provider: (typeof PROVIDER_IDS)[number]; key: string }) =>
	v.provider === 'fake' || v.key.length >= 16;
const keyLengthIssue = { message: 'That does not look like an API key', path: ['key'] };

export const modelsInput = z
	.object({
		provider: z.enum(PROVIDER_IDS, 'Unknown provider'),
		key: providerKey
	})
	.refine(looksLikeKey, keyLengthIssue);

export const runAnalysisInput = z
	.object({
		provider: z.enum(PROVIDER_IDS, 'Unknown provider'),
		key: providerKey,
		model: z.string().trim().min(1, 'Pick a model').max(200),
		effort: z.enum(EFFORTS).default('max')
	})
	.refine(looksLikeKey, keyLengthIssue);

export type CreateEventInput = z.infer<typeof createEventInput>;
export type ResponseInput = z.infer<typeof responseInput>;
export type EditResponseInput = z.infer<typeof editResponseInput>;
export type ModelsInput = z.infer<typeof modelsInput>;
export type RunAnalysisInput = z.infer<typeof runAnalysisInput>;

/** Returns a problem description, or null when every id refers to a known option exactly once. */
export function checkOptionRefs(
	ranking: string[],
	vetoes: string[],
	optionIds: string[]
): string | null {
	const known = new Set(optionIds);
	if (new Set(ranking).size !== ranking.length) return 'Ranking repeats an option';
	if (ranking.some((id) => !known.has(id))) return 'Ranking refers to an unknown option';
	if (vetoes.some((id) => !known.has(id))) return 'Veto refers to an unknown option';
	return null;
}
