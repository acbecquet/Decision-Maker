/** Formats an amount in the event's currency, hiding decimals for whole numbers. */
export function formatMoney(amount: number, currency: string, locale?: string): string {
	const whole = Number.isInteger(amount);
	return new Intl.NumberFormat(locale, {
		style: 'currency',
		currency,
		minimumFractionDigits: whole ? 0 : 2,
		maximumFractionDigits: whole ? 0 : 2
	}).format(amount);
}
