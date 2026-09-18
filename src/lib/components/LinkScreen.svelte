<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import LinkCard from './LinkCard.svelte';

	let { code, title, canEdit }: { code: string; title: string; canEdit: boolean } = $props();
</script>

{#if canEdit}
	<button
		type="button"
		class="link-btn"
		onclick={() => goto(resolve('/e/[code]/edit?from=link', { code }))}
	>
		← Edit event
	</button>
{/if}
<h1>Your event is ready</h1>
<p class="muted">{title}</p>
<LinkCard {code} />
<p class="small muted">Host controls stay in this browser.</p>
<button
	type="button"
	class="btn-primary btn-block"
	onclick={() => goto(resolve('/e/[code]', { code }))}
>
	Continue to host view
</button>
