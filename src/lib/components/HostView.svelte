<script lang="ts">
	import { untrack } from 'svelte';
	import { api, ApiError } from '$lib/client/api';
	import type { EventPageView } from '$lib/shared/types';
	import CloseDialog from './CloseDialog.svelte';
	import LinkCard from './LinkCard.svelte';
	import ResponseForm from './ResponseForm.svelte';
	import Roster from './Roster.svelte';
	import TalliesView from './TalliesView.svelte';

	let {
		view,
		code,
		onchange
	}: { view: EventPageView; code: string; onchange: () => Promise<void> | void } = $props();

	const event = $derived(view.event);
	const host = $derived(view.host);
	let error = $state('');
	let showForm = $state(false);
	let closesLocal = $state(untrack(() => toLocal(view.event.closesAt)));
	let closeDialog: ReturnType<typeof CloseDialog> | undefined = $state();

	/** ISO instant to the local wall-clock format a datetime-local input expects. */
	function toLocal(iso: string | null): string {
		if (!iso) return '';
		const d = new Date(iso);
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

	async function call(path: string, body?: unknown, method: 'POST' | 'PATCH' = 'POST') {
		error = '';
		try {
			await api(path, { method, body, code });
			await onchange();
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Something went wrong, try again';
		}
	}

	const setStatus = (id: string, status: 'approved' | 'rejected') =>
		call(`/api/events/${code}/participants/${id}`, { status }, 'PATCH');
	const approveAll = () => call(`/api/events/${code}/roster/approve-all`);
	const saveClosesAt = () =>
		call(
			`/api/events/${code}`,
			{ closesAt: closesLocal ? new Date(closesLocal).toISOString() : null },
			'PATCH'
		);
	const close = (pending: 'approve' | 'reject') => call(`/api/events/${code}/close`, { pending });
</script>

<h1>{event.title}</h1>
{#if event.context}
	<p class="muted">{event.context}</p>
{/if}
<p>
	{#if event.state === 'open'}
		<span class="pill pill-success">Open</span>
	{:else if event.state === 'closed'}
		<span class="pill pill-warn">Closed</span>
	{:else}
		<span class="pill">Published</span>
	{/if}
	<span class="muted small" style="margin-left:8px">{host?.submittedCount ?? 0} submitted</span>
</p>
{#if error}
	<p class="error" role="alert">{error}</p>
{/if}

{#if host && event.state === 'open'}
	<LinkCard {code} />

	{#if view.mine}
		<p class="small muted">Your own response is in.</p>
	{:else if showForm}
		<h2>Your response</h2>
		<ResponseForm
			{event}
			{code}
			oncancel={() => (showForm = false)}
			onsubmitted={async () => {
				try {
					await onchange();
				} finally {
					showForm = false;
				}
			}}
		/>
	{:else}
		<button type="button" class="btn-block" onclick={() => (showForm = true)}>
			Submit my response
		</button>
	{/if}

	<h2>Names</h2>
	<Roster roster={host.roster} readonly={false} onstatus={setStatus} />
	{#if host.pendingCount > 0}
		<button type="button" style="margin-top:8px" onclick={approveAll}>
			Approve all pending ({host.pendingCount})
		</button>
	{/if}

	<h2>Auto-close</h2>
	<label for="closes">Close submissions automatically at <span class="muted">optional</span></label>
	<input id="closes" type="datetime-local" bind:value={closesLocal} />
	<div class="actions">
		<button type="button" onclick={saveClosesAt}>Save time</button>
		{#if event.closesAt}
			<button
				type="button"
				onclick={() => {
					closesLocal = '';
					saveClosesAt();
				}}>Remove</button
			>
		{/if}
	</div>

	<h2>Close</h2>
	<p class="small muted">
		Closing is final. Names still pending are resolved in the next step, and nobody can submit or
		edit after that.
	</p>
	<button type="button" class="btn-primary btn-block" onclick={() => closeDialog?.open()}>
		Close submissions
	</button>
{:else if host && !event.rosterFinal}
	<div class="card">
		<h2 style="margin-top:0">Submissions closed automatically</h2>
		<p class="muted">Resolve the pending names to see the numbers. This is final.</p>
		<button type="button" class="btn-primary btn-block" onclick={() => closeDialog?.open()}>
			Resolve pending names
		</button>
	</div>
	<h2>Names</h2>
	<Roster roster={host.roster} readonly={false} onstatus={setStatus} />
{:else if host}
	<h2>Numbers</h2>
	{#if host.tallies}
		<TalliesView tallies={host.tallies} options={event.options} currency={event.currency} />
	{/if}
	<h2>Names</h2>
	<Roster roster={host.roster} readonly={true} />
	<p class="small muted">The roster is final.</p>
{/if}

{#if host}
	<CloseDialog bind:this={closeDialog} pendingCount={host.pendingCount} onconfirm={close} />
{/if}
