<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { api, ApiError } from '$lib/client/api';
	import { moveToken } from '$lib/client/tokens';
	import EventForm from '$lib/components/EventForm.svelte';
	import type { EventPageView } from '$lib/shared/types';
	import type { CreateEventInput } from '$lib/shared/validation';

	const code = $derived(page.params.code ?? '');
	const fromLink = $derived(page.url.searchParams.get('from') === 'link');
	let view = $state<EventPageView | null>(null);
	let error = $state('');

	const back = () => goto(resolve(fromLink ? '/e/[code]?created=1' : '/e/[code]', { code }));

	onMount(async () => {
		try {
			const loaded = await api<EventPageView>(`/api/events/${code}`, { code });
			const editable =
				loaded.role === 'host' &&
				loaded.event.state === 'open' &&
				loaded.host?.submittedCount === 0;
			if (!editable) {
				await goto(resolve('/e/[code]', { code }));
				return;
			}
			view = loaded;
		} catch (err) {
			error =
				err instanceof ApiError && err.status === 404
					? 'This event does not exist.'
					: 'Could not load the event. Check your connection and try again.';
		}
	});

	async function save(input: CreateEventInput) {
		const { code: next } = await api<{ code: string }>(`/api/events/${code}`, {
			method: 'PUT',
			body: input,
			code
		});
		moveToken(code, next, 'host');
		await goto(resolve('/e/[code]?created=1', { code: next }));
	}
</script>

<svelte:head>
	<title>Edit event</title>
</svelte:head>

<main>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{:else if !view}
		<p class="muted">Loading</p>
	{:else}
		<h1>Edit event</h1>
		<p class="small muted">Saving makes a new link. The old one stops working.</p>
		<EventForm
			initial={view.event}
			submitLabel="Save"
			busyLabel="Saving"
			oncancel={back}
			onsubmit={save}
		/>
	{/if}
</main>
