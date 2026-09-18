<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api } from '$lib/client/api';
	import { newToken, setToken } from '$lib/client/tokens';
	import EventForm from '$lib/components/EventForm.svelte';
	import type { CreateEventInput } from '$lib/shared/validation';

	async function create(input: CreateEventInput) {
		const hostToken = newToken();
		const { code } = await api<{ code: string }>('/api/events', {
			method: 'POST',
			body: input,
			headers: { 'x-host-token': hostToken }
		});
		setToken(code, 'host', hostToken);
		await goto(resolve('/e/[code]?created=1', { code }));
	}
</script>

<main>
	<h1>DecisionMaker</h1>
	<EventForm submitLabel="Create event" busyLabel="Creating" onsubmit={create} />
</main>
