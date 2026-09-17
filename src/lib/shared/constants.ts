export const CURRENCIES = [
	'EUR',
	'USD',
	'GBP',
	'CHF',
	'SEK',
	'NOK',
	'DKK',
	'PLN',
	'CZK',
	'HUF',
	'JPY',
	'AUD',
	'CAD',
	'NZD',
	'MXN',
	'BRL',
	'INR',
	'CNY',
	'ZAR',
	'AED'
] as const;
export type Currency = (typeof CURRENCIES)[number];

export const LIMITS = {
	title: 80,
	context: 200,
	optionLabel: 80,
	optionNote: 120,
	minOptions: 2,
	maxOptions: 12,
	name: 40,
	opinion: 2000,
	suggestion: 200,
	maxCost: 1_000_000
} as const;

export const RULES = {
	/** Below this many approved responses, no per-option breakdown is shown to anyone. */
	minBreakdownResponses: 5,
	/** Cost counts below this are never displayed. */
	minCostCount: 3
} as const;

export const EVENT_CODE_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
export const EVENT_CODE_LENGTH = 10;
export const TOKEN_HEX_LENGTH = 64;
export const EVENT_TTL_DAYS = 90;
