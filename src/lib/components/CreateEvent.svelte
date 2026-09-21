<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api, ApiError } from '$lib/client/api';
	import { newToken, setToken, storageAvailable } from '$lib/client/tokens';
	import type { CreateEventInput } from '$lib/shared/validation';
	import EventForm from './EventForm.svelte';

	async function create(input: CreateEventInput) {
		if (!storageAvailable()) {
			throw new ApiError(
				0,
				'This browser blocks site storage, so it cannot keep the host link. Allow storage or use another browser.'
			);
		}
		const hostToken = newToken();
		const { code } = await api<{ code: string }>('/api/events', {
			method: 'POST',
			body: input,
			headers: { 'x-host-token': hostToken }
		});
		setToken(code, 'host', hostToken);
		// The search hangs off `/e/[code]`: resolve() leaves a stray slash before it when the
		// optional slug is the last segment, and the link screen's path must stay /e/<code>.
		await goto(resolve('/e/[code]?created=1', { code }));
	}
</script>

<main>
	<h1>DecisionMaker</h1>
	<EventForm submitLabel="Create event" busyLabel="Creating" onsubmit={create} />
	<p class="small" style="margin-top:24px"><a href={resolve('/me')}>My events</a></p>
</main>
