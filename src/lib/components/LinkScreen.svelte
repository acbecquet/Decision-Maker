<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import LinkCard from './LinkCard.svelte';

	let { code, title }: { code: string; title: string } = $props();
</script>

<h1>Your event is ready</h1>
<p class="muted">{title}</p>
<LinkCard {code} />
<p class="small muted">
	This device is the host. Keep using this browser to approve names, close submissions, and run the
	analysis.
</p>
<button
	type="button"
	class="btn-primary btn-block"
	onclick={() => goto(resolve('/e/[code]', { code }))}
>
	Continue to host view
</button>
