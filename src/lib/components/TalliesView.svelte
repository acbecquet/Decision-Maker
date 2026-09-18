<script lang="ts">
	import { RULES } from '$lib/shared/constants';
	import { formatMoney } from '$lib/shared/money';
	import type { OptionView, PresentedTallies } from '$lib/shared/types';

	let {
		tallies,
		options,
		currency
	}: { tallies: PresentedTallies; options: OptionView[]; currency: string } = $props();

	const label = (id: string) => options.find((o) => o.id === id)?.label ?? id;
	const breakdown = $derived(tallies.breakdown);
	const maxFirst = $derived(
		breakdown ? Math.max(1, ...breakdown.firstChoice.map((f) => f.count)) : 1
	);
	/** Darker for higher ranks; the last segment (last place or unranked) is the lightest. */
	function shade(index: number, count: number): string {
		const t = count <= 1 ? 1 : index / (count - 1);
		return `hsl(214 70% ${Math.round(32 + t * 48)}%)`;
	}

	/** Splits a rank row into proportional segments, folding unranked into the last position. */
	function segments(ranks: number[], unranked: number): { width: number; color: string }[] {
		const total = ranks.reduce((sum, n) => sum + n, 0) + unranked;
		if (total === 0) return [];
		const last = ranks.length - 1;
		return ranks
			.map((n, i) => (i === last ? n + unranked : n))
			.map((n, i) => ({ width: (n / total) * 100, color: shade(i, ranks.length) }))
			.filter((s) => s.width > 0);
	}
</script>

<p class="small muted">
	{tallies.approvedCount} approved {tallies.approvedCount === 1 ? 'response' : 'responses'}
</p>

{#if !breakdown}
	<div class="card">
		<p>Numbers appear once at least {RULES.minBreakdownResponses} approved responses are in.</p>
	</div>
{:else}
	<h3>First choices</h3>
	<div data-testid="first-choices">
		{#each breakdown.firstChoice as f (f.optionId)}
			<div class="bar">
				<span class="name">{label(f.optionId)}</span>
				<div class="track">
					<div
						class="seg"
						style={`width:${(f.count / maxFirst) * 100}%;background:var(--accent)`}
					></div>
				</div>
				<span class="val" data-testid={`first-${f.optionId}`}>{f.count}</span>
			</div>
		{/each}
	</div>

	<h3>Where each option ranked</h3>
	{#each breakdown.rankMatrix as r (r.optionId)}
		<div class="bar">
			<span class="name">{label(r.optionId)}</span>
			<div class="track">
				{#each segments(r.ranks, r.unranked) as s, i (i)}
					<div class="seg" style={`width:${s.width}%;background:${s.color}`}></div>
				{/each}
			</div>
			<span class="val"></span>
		</div>
	{/each}
	<p class="small muted">
		Darker means ranked higher. The lightest segment is last place or unranked.
	</p>

	{#if breakdown.vetoes.some((v) => v.count > 0)}
		<h3>Won't work for</h3>
		{#each breakdown.vetoes.filter((v) => v.count > 0) as v (v.optionId)}
			<p class="small">{label(v.optionId)}: {v.count}</p>
		{/each}
	{/if}

	{#if breakdown.condorcetWinner}
		<p class="small muted">
			{label(breakdown.condorcetWinner)} beats every other option head to head.
		</p>
	{/if}

	{#if breakdown.cost}
		<h3>Cost</h3>
		{#if breakdown.cost.answered !== null}
			<p class="small muted">{breakdown.cost.answered} of {tallies.approvedCount} set a limit.</p>
		{/if}
		{#each breakdown.cost.rows as c (c.optionId)}
			<div class="bar">
				<span class="name">{label(c.optionId)}</span>
				<span class="grow">{formatMoney(c.cost, currency)}</span>
				{#if c.overBudget !== null}
					<span class="small" style="color:var(--warn)" data-testid={`over-${c.optionId}`}>
						over budget for {c.overBudget}
					</span>
				{/if}
			</div>
		{/each}
	{/if}
{/if}
