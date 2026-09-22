import { RULES } from './constants';
import { formatMoney } from './money';
import type { ReportView } from './report';

/** Plain text for the group chat: the paragraph, the four headlines, the cost line, and the footer. */
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
	const decision = r.decision!;
	const lines = [
		view.title,
		'',
		r.summary,
		'',
		`Best: ${priced(decision.best.optionId)}`,
		`Runner-up: ${priced(decision.runnerUp.optionId)}`,
		`Worst: ${priced(decision.worst.optionId)}`
	];
	if (r.unexpected) lines.push(`Unexpected: ${r.unexpected.title}`);
	const cost = view.tallies.breakdown?.cost;
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
