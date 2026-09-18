<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/client/api';
	import type { ReportView as ReportData } from '$lib/shared/report';
	import type { EventPageView } from '$lib/shared/types';
	import CopySummary from './CopySummary.svelte';
	import ModelPanel from './ModelPanel.svelte';
	import PublishDialog from './PublishDialog.svelte';
	import ReportView from './ReportView.svelte';

	let {
		view,
		code,
		onchange
	}: { view: EventPageView; code: string; onchange: () => Promise<void> | void } = $props();

	const published = $derived(view.event.state === 'published');
	const hasDraft = $derived(view.host?.hasDraft ?? false);
	let report = $state<ReportData | null>(null);
	let rerun = $state(false);
	let loadError = $state('');
	let publishDialog: ReturnType<typeof PublishDialog> | undefined = $state();

	async function loadReport() {
		try {
			report = await api<ReportData>(`/api/events/${code}/report`, { code });
			loadError = '';
		} catch {
			loadError = 'Could not load the report. Check your connection and try again.';
		}
	}

	async function publish(): Promise<boolean> {
		try {
			await api(`/api/events/${code}/publish`, { method: 'POST', code });
			await onchange();
			await loadReport();
			return true;
		} catch {
			return false;
		}
	}

	onMount(() => {
		if (hasDraft || published) loadReport();
	});
</script>

{#if published}
	{#if report}
		<ReportView view={report} />
		<div style="margin-top:12px"><CopySummary view={report} /></div>
	{:else if loadError}
		<p class="error" role="alert">{loadError}</p>
	{:else}
		<p class="muted">Loading</p>
	{/if}
{:else if hasDraft && !rerun}
	<h2>Draft</h2>
	{#if report}
		<ReportView view={report} />
	{:else if loadError}
		<p class="error" role="alert">{loadError}</p>
	{:else}
		<p class="muted">Loading</p>
	{/if}
	<div class="actions">
		<button type="button" onclick={() => (rerun = true)}>Run again</button>
		<button type="button" class="btn-primary" onclick={() => publishDialog?.open()}>Publish</button>
	</div>
	<PublishDialog bind:this={publishDialog} onconfirm={publish} />
{:else}
	<ModelPanel
		{code}
		onsucceeded={async () => {
			rerun = false;
			await onchange();
			await loadReport();
		}}
	/>
	{#if hasDraft}
		<button type="button" style="margin-top:12px" onclick={() => (rerun = false)}
			>Back to the draft</button
		>
	{/if}
{/if}
