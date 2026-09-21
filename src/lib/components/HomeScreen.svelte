<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api, ApiError } from '$lib/client/api';
	import type { AccountEvent, EventState } from '$lib/shared/types';
	import Roster from './Roster.svelte';

	/** New requests show up on their own at this cadence while the screen is visible. */
	const REFRESH_MS = 15_000;

	let email = $state('');
	let rows = $state<AccountEvent[] | null>(null);
	let error = $state('');
	const totalPending = $derived(rows?.reduce((n, r) => n + r.pendingCount, 0) ?? 0);

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

	async function refresh() {
		try {
			const me = await api<{ email: string; events: AccountEvent[] }>('/api/me');
			email = me.email;
			rows = me.events;
		} catch (err) {
			if (err instanceof ApiError && err.status === 401) await goto(resolve('/signin'));
			else if (rows === null)
				error = 'Could not load your events. Check your connection and try again.';
			// A failed background refresh keeps the last good list on screen.
		}
	}

	onMount(() => {
		void refresh();
		const tick = () => {
			if (document.visibilityState === 'visible') void refresh();
		};
		const timer = setInterval(tick, REFRESH_MS);
		document.addEventListener('visibilitychange', tick);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', tick);
		};
	});

	async function act(
		code: string,
		path: string,
		body?: unknown,
		method: 'POST' | 'PATCH' = 'POST'
	) {
		error = '';
		try {
			await api(path, { method, body, code });
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Something went wrong, try again';
		}
		await refresh();
	}
	const setStatus = (code: string) => (id: string, status: 'approved' | 'rejected') =>
		act(code, `/api/events/${code}/participants/${id}`, { status }, 'PATCH');
	const approveAll = (code: string) => act(code, `/api/events/${code}/roster/approve-all`);

	async function signOut() {
		try {
			await api('/api/auth/signout', { method: 'POST' });
			await goto(resolve('/'), { invalidateAll: true });
		} catch (err) {
			error =
				err instanceof ApiError
					? err.message
					: 'Could not sign out. Check your connection and try again.';
		}
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
	{/if}
	{#if rows === null}
		{#if !error}
			<p class="muted">Loading</p>
		{/if}
	{:else if rows.length === 0}
		<p class="muted">No events yet.</p>
	{:else}
		{#if totalPending > 0}
			<p class="notice" data-testid="pending-total">{totalPending} pending</p>
		{/if}
		<ul style="list-style:none;padding:0;margin:0" data-testid="my-events">
			{#each rows as row (row.code)}
				<li class="card" style="margin:8px 0" data-testid={`event-${row.code}`}>
					<a
						href={resolve('/e/[code]', { code: row.code })}
						style="text-decoration:none;color:inherit"
					>
						<strong>{row.title}</strong>
					</a>
					<p style="margin:6px 0 0">
						<span class={`pill ${pill[row.state]}`}>{label[row.state]}</span>
						<span class="muted small" style="margin-left:8px">{row.submittedCount} submitted</span>
						{#if row.pendingCount > 0}
							<span class="muted small" style="margin-left:8px">{row.pendingCount} pending</span>
						{/if}
					</p>
					{#if row.pending.length > 0}
						<div style="margin-top:8px">
							<Roster
								roster={row.pending}
								readonly={false}
								showStatus={false}
								onstatus={setStatus(row.code)}
							/>
							<button
								type="button"
								class="btn-block"
								style="margin-top:8px"
								onclick={() => approveAll(row.code)}
							>
								Approve all pending ({row.pendingCount})
							</button>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
	<div class="actions" style="margin-top:16px">
		<button type="button" class="btn-primary" onclick={() => goto(resolve('/new'))}>
			New event
		</button>
		<button type="button" onclick={signOut}>Sign out</button>
	</div>
</main>
