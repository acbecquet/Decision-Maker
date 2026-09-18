<script lang="ts">
	import type { ReportView } from '$lib/shared/report';
	import { copySummary } from '$lib/shared/summary';

	let { view }: { view: ReportView } = $props();
	let status = $state<'idle' | 'copied' | 'failed'>('idle');
	const text = $derived(copySummary(view));

	async function copy() {
		try {
			await navigator.clipboard.writeText(text);
			status = 'copied';
		} catch {
			status = 'failed';
		}
	}
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
