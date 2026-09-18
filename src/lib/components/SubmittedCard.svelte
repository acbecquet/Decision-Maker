<script lang="ts">
	import { formatMoney } from '$lib/shared/money';
	import type { EventView, MineView } from '$lib/shared/types';

	let { event, mine, onedit }: { event: EventView; mine: MineView; onedit: () => void } = $props();
	const label = (id: string) => event.options.find((o) => o.id === id)?.label ?? id;
</script>

<div class="card">
	<span class="pill pill-success">Submitted</span>
	<h2 style="margin-top:8px">Thanks, {mine.name}</h2>
	<p class="muted">The host approves names before anything is shared.</p>
	<p class="label">Your ranking</p>
	<ol style="margin:0 0 8px;padding-left:20px">
		{#each mine.ranking as id (id)}
			<li>{label(id)}</li>
		{/each}
	</ol>
	{#if mine.vetoes.length > 0}
		<p class="small muted">Won't work: {mine.vetoes.map(label).join(', ')}</p>
	{/if}
	{#if mine.budget}
		<p class="small muted">
			Budget: {mine.budget.kind === 'limit'
				? `up to ${formatMoney(mine.budget.amount, event.currency)}`
				: 'no limit'}
		</p>
	{/if}
	{#if mine.opinion}
		<p class="label">Your opinion</p>
		<p style="white-space:pre-wrap">{mine.opinion}</p>
	{/if}
	{#if mine.suggestion}
		<p class="small muted">Suggested: {mine.suggestion}</p>
	{/if}
	<button type="button" onclick={onedit}>Edit my answers</button>
</div>
