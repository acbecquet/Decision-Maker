<script lang="ts">
	import type { EventMode } from '$lib/shared/types';

	let { mode }: { mode: EventMode } = $props();

	/** Only name what the mode actually asks for: opinions only has no ranking and no budget. */
	const answer = $derived(
		mode === 'freeform'
			? 'your opinion'
			: mode === 'single'
				? 'your pick, budget, or opinion'
				: 'your ranking, budget, or opinion'
	);
</script>

<div class="notice" role="note">
	<span aria-hidden="true">🔒</span>
	<span>
		Only the host sees your name. Nobody sees {answer}, not even the host. An AI rewrites opinions
		before anything is shared, and everything you type is deleted when the results are published.
	</span>
</div>
