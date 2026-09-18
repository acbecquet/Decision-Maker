<script lang="ts">
	import type { EventPageView } from '$lib/shared/types';
	import LinkCard from './LinkCard.svelte';

	// eslint-disable-next-line svelte/no-unused-props -- onchange is wired by Task 16's host actions
	let { view, code }: { view: EventPageView; code: string; onchange: () => void } = $props();
	const event = $derived(view.event);
	const host = $derived(view.host);
</script>

<h1>{event.title}</h1>
{#if event.context}
	<p class="muted">{event.context}</p>
{/if}
<p>
	{#if event.state === 'open'}
		<span class="pill pill-success">Open</span>
	{:else if event.state === 'closed'}
		<span class="pill pill-warn">Closed</span>
	{:else}
		<span class="pill">Published</span>
	{/if}
	<span class="muted small" style="margin-left:8px">{host?.submittedCount ?? 0} submitted</span>
</p>
{#if event.state === 'open'}
	<LinkCard {code} />
{/if}
