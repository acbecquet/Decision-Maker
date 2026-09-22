<script lang="ts">
	import { formatMoney } from '$lib/shared/money';
	import type { ReportView } from '$lib/shared/report';
	import TalliesView from './TalliesView.svelte';

	let { view }: { view: ReportView } = $props();

	const option = (id: string) => view.options.find((o) => o.id === id);
	const name = (id: string) => option(id)?.label ?? 'an option';
	const price = (id: string) => {
		const cost = option(id)?.cost;
		return cost === null || cost === undefined ? null : formatMoney(cost, view.currency);
	};
	const consensus = {
		strong: 'Strong consensus',
		moderate: 'Moderate consensus',
		split: 'Split'
	} as const;
	/** Null in an opinions-only event: there is nothing to pick between, so there are no cards. */
	const decision = $derived(view.report.decision);
	const labels = $derived(
		view.mode === 'single'
			? { best: 'Winner', runnerUp: 'Runner-up', worst: 'Fewest votes' }
			: { best: 'Best option', runnerUp: 'Runner-up', worst: 'Worst' }
	);
	const published = $derived(
		view.publishedAt
			? new Date(view.publishedAt).toLocaleDateString(undefined, {
					day: 'numeric',
					month: 'short',
					year: 'numeric'
				})
			: null
	);
</script>

<div data-testid="report">
	<p class="small muted">
		{view.tallies.approvedCount} approved {view.tallies.approvedCount === 1
			? 'response'
			: 'responses'}{published ? `, published ${published}` : ', draft'}
	</p>

	{#if decision}
		<div class="card highlight">
			<p class="label" style="margin-top:0">{labels.best}</p>
			<p style="margin:0 0 6px">
				<strong>{name(decision.best.optionId)}</strong>
				{#if price(decision.best.optionId)}<span class="muted small"
						>{price(decision.best.optionId)}</span
					>{/if}
			</p>
			<span class="pill">{consensus[decision.best.consensus]}</span>
			<p style="margin:10px 0 4px"><strong>{decision.best.verdict}</strong></p>
			<p style="margin:0">{decision.best.rationale}</p>
		</div>

		<div class="pair">
			<div class="card">
				<p class="label" style="margin-top:0">{labels.runnerUp}</p>
				<p style="margin:0"><strong>{name(decision.runnerUp.optionId)}</strong></p>
				{#if price(decision.runnerUp.optionId)}<p class="small muted" style="margin:0 0 6px">
						{price(decision.runnerUp.optionId)}
					</p>{/if}
				<p class="small" style="margin:0">{decision.runnerUp.rationale}</p>
			</div>
			<div class="card">
				<p class="label" style="margin-top:0">{labels.worst}</p>
				<p style="margin:0"><strong>{name(decision.worst.optionId)}</strong></p>
				{#if price(decision.worst.optionId)}<p class="small muted" style="margin:0 0 6px">
						{price(decision.worst.optionId)}
					</p>{/if}
				<p class="small" style="margin:0">{decision.worst.rationale}</p>
			</div>
		</div>
	{/if}

	{#if view.report.unexpected}
		<div class="card">
			<p class="label" style="margin-top:0">Unexpected</p>
			<p style="margin:0"><strong>{view.report.unexpected.title}</strong></p>
			<p class="small" style="margin:6px 0 0">{view.report.unexpected.rationale}</p>
		</div>
	{/if}

	{#if decision}
		<h2>Numbers</h2>
		<TalliesView
			tallies={view.tallies}
			options={view.options}
			currency={view.currency}
			mode={view.mode}
		/>
	{/if}

	<h2>What people said</h2>
	{#each view.report.themes as theme, i (i)}
		<h3>{theme.title}</h3>
		<p class="small">{theme.summary}</p>
		{#each theme.quotes as quote (quote.pointId)}
			<blockquote class="quote">{quote.text}</blockquote>
		{/each}
	{/each}

	{#if view.report.stillToSettle.length > 0}
		<h2>Still to settle</h2>
		<ul style="margin:0;padding-left:20px">
			{#each view.report.stillToSettle as item, i (i)}
				<li>{item}</li>
			{/each}
		</ul>
	{/if}

	<p class="small muted" style="margin-top:24px">
		Opinions were rewritten by AI to protect anonymity. Model: {view.report.model}.
	</p>
</div>
