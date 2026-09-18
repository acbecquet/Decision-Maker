<script lang="ts">
	import { formatMoney } from '$lib/shared/money';
	import type { Budget } from '$lib/shared/types';

	let {
		costs,
		currency,
		value = $bindable(null)
	}: { costs: number[]; currency: string; value?: Budget } = $props();

	const same = (a: Budget, b: Budget) => JSON.stringify(a) === JSON.stringify(b);

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
