<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api, ApiError } from '$lib/client/api';
	import { toLocalInput } from '$lib/client/datetime';
	import { clearEventTokens } from '$lib/client/tokens';
	import type { EventPageView } from '$lib/shared/types';
	import AnalysisSection from './AnalysisSection.svelte';
	import CloseDialog from './CloseDialog.svelte';
	import DeleteDialog from './DeleteDialog.svelte';
	import LinkCard from './LinkCard.svelte';
	import ResponseForm from './ResponseForm.svelte';
	import Roster from './Roster.svelte';
	import SubmittedCard from './SubmittedCard.svelte';
	import TalliesView from './TalliesView.svelte';

	let {
		view,
		code,
		onchange
	}: { view: EventPageView; code: string; onchange: () => Promise<void> | void } = $props();

	const event = $derived(view.event);
	const host = $derived(view.host);
	const pendingNames = $derived(
		host?.roster.filter((r) => r.status === 'pending').map((r) => r.name) ?? []
	);
	let error = $state('');
	let showForm = $state(false);
	let editingOwn = $state(false);
	let closesLocal = $state(untrack(() => toLocalInput(view.event.closesAt)));
	let closeDialog: ReturnType<typeof CloseDialog> | undefined = $state();
	let deleteDialog: ReturnType<typeof DeleteDialog> | undefined = $state();

	async function call(
		path: string,
		body?: unknown,
		method: 'POST' | 'PATCH' = 'POST'
	): Promise<boolean> {
		error = '';
		try {
			await api(path, { method, body, code });
			await onchange();
			return true;
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Something went wrong, try again';
			try {
				await onchange();
			} catch {
				// The error above is what the host needs to see.
			}
			return false;
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

	let deleteError = $state('');

	async function remove(): Promise<boolean> {
		deleteError = '';
		try {
			await api(`/api/events/${code}`, { method: 'DELETE', code });
			clearEventTokens(code);
			await goto(resolve('/'));
			return true;
		} catch (err) {
			deleteError = err instanceof ApiError ? err.message : '';
			return false;
		}
	}
</script>

<p class="small" style="margin:0 0 8px"><a href={resolve('/me')}>My events</a></p>
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
	<LinkCard {code} title={event.title} />
	{#if host.submittedCount === 0}
		<button
			type="button"
			class="btn-block"
			onclick={() => goto(resolve('/e/[code]/edit', { code }))}
		>
			Edit event
		</button>
	{/if}

	{#if view.mine && editingOwn}
		<h2>Your response</h2>
		<ResponseForm
			{event}
			{code}
			mine={view.mine}
			oncancel={() => (editingOwn = false)}
			onsubmitted={async () => {
				try {
					await onchange();
				} finally {
					editingOwn = false;
				}
			}}
		/>
	{:else if view.mine}
		<SubmittedCard {event} mine={view.mine} onedit={() => (editingOwn = true)} />
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
	<button type="button" class="btn-primary btn-block" onclick={() => closeDialog?.open()}>
		Close submissions
	</button>
{:else if host && !event.rosterFinal}
	<div class="card">
		<h2 style="margin-top:0">Submissions closed automatically</h2>
		<button type="button" class="btn-primary btn-block" onclick={() => closeDialog?.open()}>
			Finish closing
		</button>
	</div>
	<h2>Names</h2>
	<Roster roster={host.roster} readonly={false} onstatus={setStatus} />
{:else if host}
	{#if !host.hasDraft && event.state !== 'published'}
		{#if event.mode !== 'freeform'}
			<h2>Numbers</h2>
		{/if}
		{#if host.tallies}
			<TalliesView
				tallies={host.tallies}
				options={event.options}
				currency={event.currency}
				mode={event.mode}
			/>
		{/if}
	{/if}
	<AnalysisSection {view} {code} {onchange} />
	<h2>Names</h2>
	<Roster roster={host.roster} readonly={true} />
{/if}

{#if host && !event.rosterFinal}
	<CloseDialog
		bind:this={closeDialog}
		{pendingNames}
		closed={event.state === 'closed'}
		onconfirm={close}
	/>
{/if}

{#if host}
	<button
		type="button"
		class="btn-block btn-danger"
		style="margin-top:32px"
		onclick={() => deleteDialog?.open()}
	>
		Delete event
	</button>
	<DeleteDialog bind:this={deleteDialog} onconfirm={remove} message={deleteError} />
{/if}
