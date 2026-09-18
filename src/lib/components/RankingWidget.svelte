<script lang="ts">
	import { formatMoney } from '$lib/shared/money';
	import type { OptionView } from '$lib/shared/types';

	let {
		options,
		currency,
		ranked = $bindable([]),
		vetoed = $bindable([])
	}: { options: OptionView[]; currency: string; ranked?: string[]; vetoed?: string[] } = $props();

	const unranked = $derived(options.filter((o) => !ranked.includes(o.id)));
	const byId = (id: string) => options.find((o) => o.id === id);

	function add(id: string) {
		ranked = [...ranked, id];
	}

	function remove(id: string) {
		ranked = ranked.filter((r) => r !== id);
	}

	function move(id: string, delta: number) {
		const i = ranked.indexOf(id);
		const j = i + delta;
		if (i < 0 || j < 0 || j >= ranked.length) return;
		const next = [...ranked];
		[next[i], next[j]] = [next[j], next[i]];
		ranked = next;
	}

	function toggleVeto(id: string) {
		vetoed = vetoed.includes(id) ? vetoed.filter((v) => v !== id) : [...vetoed, id];
	}
</script>

<ol data-testid="ranked" style="list-style:none;padding:0;margin:0">
	{#each ranked as id, i (id)}
		{@const option = byId(id)}
		{#if option}
			<li class="row">
				<span class="num">{i + 1}</span>
				<span class="grow">
					{option.label}
					{#if option.cost !== null}
						<span class="muted small">{formatMoney(option.cost, currency)}</span>
					{/if}
					{#if option.note}
						<span class="muted small" style="display:block">{option.note}</span>
					{/if}
				</span>
				<button
					type="button"
					class="icon-btn"
					aria-label={`Move ${option.label} up`}
					disabled={i === 0}
					onclick={() => move(id, -1)}>↑</button
				>
				<button
					type="button"
					class="icon-btn"
					aria-label={`Move ${option.label} down`}
					disabled={i === ranked.length - 1}
					onclick={() => move(id, 1)}>↓</button
				>
				<button
					type="button"
					class="icon-btn"
					aria-label={`Remove ${option.label} from ranking`}
					onclick={() => remove(id)}>×</button
				>
				<button
					type="button"
					class="veto"
					aria-label={`Won't work for ${option.label}`}
					aria-pressed={vetoed.includes(id)}
					onclick={() => toggleVeto(id)}>Won't work</button
				>
			</li>
		{/if}
	{/each}
</ol>

{#if unranked.length > 0}
	<p class="small muted" style="margin:8px 0 6px">
		{ranked.length === 0 ? 'Tap your first choice' : 'Not ranked yet, tap to add'}
	</p>
	<ul data-testid="unranked" style="list-style:none;padding:0;margin:0">
		{#each unranked as option (option.id)}
			<li class="row dashed">
				<button
					type="button"
					class="grow"
					style="text-align:left;border:none;background:transparent;padding:0;font-weight:500"
					onclick={() => add(option.id)}
				>
					{option.label}
					{#if option.cost !== null}
						<span class="muted small">{formatMoney(option.cost, currency)}</span>
					{/if}
					{#if option.note}
						<span class="muted small" style="display:block;font-weight:400">{option.note}</span>
					{/if}
				</button>
				<button
					type="button"
					class="veto"
					aria-label={`Won't work for ${option.label}`}
					aria-pressed={vetoed.includes(option.id)}
					onclick={() => toggleVeto(option.id)}>Won't work</button
				>
			</li>
		{/each}
	</ul>
{/if}
