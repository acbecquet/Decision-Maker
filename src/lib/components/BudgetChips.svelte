<script lang="ts">
	import { formatMoney } from '$lib/shared/money';
	import type { Budget } from '$lib/shared/types';

	let {
		costs,
		currency,
		value = $bindable(null)
	}: { costs: number[]; currency: string; value?: Budget } = $props();

	function same(a: Budget, b: Budget): boolean {
		if (a === null || b === null) return a === b;
		if (a.kind !== b.kind) return false;
		return a.kind === 'limit' && b.kind === 'limit' ? a.amount === b.amount : true;
	}

	function pick(next: Budget) {
		value = same(value, next) ? null : next;
	}
</script>

<div class="chips">
	{#each costs as cost (cost)}
		<button
			type="button"
			class="chip"
			aria-pressed={value?.kind === 'limit' && value.amount === cost}
			onclick={() => pick({ kind: 'limit', amount: cost })}
		>
			Up to {formatMoney(cost, currency)}
		</button>
	{/each}
	<button
		type="button"
		class="chip"
		aria-pressed={value?.kind === 'no_limit'}
		onclick={() => pick({ kind: 'no_limit' })}>No limit</button
	>
</div>
