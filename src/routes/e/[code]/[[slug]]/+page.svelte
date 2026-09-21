<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { api, ApiError } from '$lib/client/api';
	import HostView from '$lib/components/HostView.svelte';
	import LinkScreen from '$lib/components/LinkScreen.svelte';
	import ParticipantView from '$lib/components/ParticipantView.svelte';
	import type { EventPageView } from '$lib/shared/types';

	let { data } = $props();

	const code = $derived(page.params.code ?? '');
	let view = $state<EventPageView | null>(null);
	let error = $state('');

	async function load() {
		try {
			view = await api<EventPageView>(`/api/events/${code}`, { code });
			error = '';
		} catch (err) {
			error =
				err instanceof ApiError && err.status === 404
					? 'This event does not exist.'
					: 'Could not load the event. Check your connection and try again.';
		}
	}

	onMount(load);
</script>

<svelte:head>
	<title>{view?.event.title ?? data.preview?.title ?? 'DecisionMaker'}</title>
	{#if data.preview}
		<meta property="og:type" content="website" />
		<meta property="og:title" content={data.preview.title} />
		<meta property="og:url" content={data.preview.url} />
	{/if}
</svelte:head>

<main>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{:else if !view}
		<p class="muted">Loading</p>
	{:else if view.role === 'host' && page.url.searchParams.get('created')}
		<LinkScreen
			{code}
			title={view.event.title}
			canEdit={view.event.state === 'open' && view.host?.submittedCount === 0}
		/>
	{:else if view.role === 'host'}
		<HostView {view} {code} onchange={load} />
	{:else}
		<ParticipantView {view} {code} onchange={load} />
	{/if}
</main>
