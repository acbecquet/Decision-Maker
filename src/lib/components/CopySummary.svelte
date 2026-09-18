<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { ReportView } from '$lib/shared/report';
	import { copySummary } from '$lib/shared/summary';

	let { view }: { view: ReportView } = $props();
	let status = $state<'idle' | 'copied' | 'failed'>('idle');
	const text = $derived(copySummary(view));
	let resetTimer: ReturnType<typeof setTimeout> | undefined;

	async function copy() {
		clearTimeout(resetTimer);
		try {
			await navigator.clipboard.writeText(text);
			status = 'copied';
			resetTimer = setTimeout(() => (status = 'idle'), 2000);
		} catch {
			status = 'failed';
		}
	}

	onDestroy(() => clearTimeout(resetTimer));
</script>

<button type="button" class="btn-block" onclick={copy}
	>{status === 'copied' ? 'Copied' : 'Copy summary'}</button
>
{#if status === 'failed'}
	<p class="small error" role="alert">
		Copying is not available here, so the summary is below for you to copy by hand.
	</p>
	<textarea readonly value={text} style="min-height:200px"></textarea>
{/if}
