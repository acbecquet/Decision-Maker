<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { api, ApiError } from '$lib/client/api';
	import HostView from '$lib/components/HostView.svelte';
	import LinkScreen from '$lib/components/LinkScreen.svelte';
	import type { EventPageView } from '$lib/shared/types';

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
	<title>{view ? view.event.title : 'DecisionMaker'}</title>
</svelte:head>

<main>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{:else if !view}
		<p class="muted">Loading</p>
	{:else if view.role === 'host' && page.url.searchParams.get('created')}
		<LinkScreen {code} title={view.event.title} />
	{:else if view.role === 'host'}
		<HostView {view} {code} onchange={load} />
	{:else}
		<h1>{view.event.title}</h1>
		{#if view.event.context}
			<p class="muted">{view.event.context}</p>
		{/if}
	{/if}
</main>
