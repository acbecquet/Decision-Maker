<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api, ApiError } from '$lib/client/api';
	import type { EventState } from '$lib/shared/types';

	type Row = {
		code: string;
		title: string;
		state: EventState;
		submittedCount: number;
		createdAt: string;
	};
	let email = $state('');
	let rows = $state<Row[] | null>(null);
	let error = $state('');

	const pill: Record<EventState, string> = {
		open: 'pill-success',
		closed: 'pill-warn',
		published: ''
	};
	const label: Record<EventState, string> = {
		open: 'Open',
		closed: 'Closed',
		published: 'Published'
	};

	onMount(async () => {
		try {
			const me = await api<{ email: string; events: Row[] }>('/api/me');
			email = me.email;
			rows = me.events;
		} catch (err) {
			if (err instanceof ApiError && err.status === 401) await goto(resolve('/signin'));
			else error = 'Could not load your events. Check your connection and try again.';
		}
	});

	async function signOut() {
		await api('/api/auth/signout', { method: 'POST' });
		await goto(resolve('/'));
	}
</script>

<svelte:head>
	<title>My events</title>
</svelte:head>

<main>
	<h1>My events</h1>
	{#if email}
		<p class="small muted">{email}</p>
	{/if}
	{#if error}
		<p class="error" role="alert">{error}</p>
	{:else if rows === null}
		<p class="muted">Loading</p>
	{:else if rows.length === 0}
		<p class="muted">No events yet.</p>
	{:else}
		<ul style="list-style:none;padding:0;margin:0" data-testid="my-events">
			{#each rows as row (row.code)}
				<li class="card" style="margin:8px 0">
					<a
						href={resolve('/e/[code]', { code: row.code })}
						style="text-decoration:none;color:inherit"
					>
						<strong>{row.title}</strong>
					</a>
					<p style="margin:6px 0 0">
						<span class={`pill ${pill[row.state]}`}>{label[row.state]}</span>
						<span class="muted small" style="margin-left:8px">{row.submittedCount} submitted</span>
					</p>
				</li>
			{/each}
		</ul>
	{/if}
	<div class="actions" style="margin-top:16px">
		<button type="button" class="btn-primary" onclick={() => goto(resolve('/'))}>New event</button>
		<button type="button" onclick={signOut}>Sign out</button>
	</div>
</main>
