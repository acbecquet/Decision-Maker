import { RULES } from './constants';
import { formatMoney } from './money';
import type { ReportView } from './report';

/** Plain text for the group chat: the paragraph, the headlines the mode has, the cost line, and the footer. */
export function copySummary(view: ReportView): string {
	const option = (id: string) => view.options.find((o) => o.id === id);
	const name = (id: string) => option(id)?.label ?? 'an option';
	const priced = (id: string) => {
		const cost = option(id)?.cost;
		return cost === null || cost === undefined
			? name(id)
			: `${name(id)} (${formatMoney(cost, view.currency)})`;
	};
	const r = view.report;
	const lines = [view.title, '', r.summary];
	if (r.decision) {
		const voted = view.mode === 'single';
		lines.push(
			'',
			`${voted ? 'Winner' : 'Best'}: ${priced(r.decision.best.optionId)}`,
			`Runner-up: ${priced(r.decision.runnerUp.optionId)}`
		);
		// With two options the runner-up is also the last one, and one line says it once.
		if (r.decision.worst.optionId !== r.decision.runnerUp.optionId) {
			lines.push(`${voted ? 'Fewest votes' : 'Worst'}: ${priced(r.decision.worst.optionId)}`);
		}
	}
	if (r.unexpected) {
		if (!r.decision) lines.push('');
		lines.push(`Unexpected: ${r.unexpected.title}`);
	}
	/** An opinions-only event shows no numbers anywhere, so it has no cost line either. */
	const cost = view.mode === 'freeform' ? null : view.tallies.breakdown?.cost;
	if (cost) {
		const over = cost.rows
			.filter((row) => row.overBudget !== null && row.overBudget > 0)
			.map((row) => `${name(row.optionId)} is over budget for ${row.overBudget}`);
		lines.push(
			'',
			over.length
				? `Cost: ${over.join(', ')}`
				: `Cost: no option is over budget for ${RULES.minCostCount} or more people`
		);
	}
	lines.push(
		'',
		`${view.tallies.approvedCount} responses. Opinions were rewritten by AI to protect anonymity.`
	);
	return lines.join('\n');
}
