<script lang="ts">
	import { api, ApiError } from '$lib/client/api';
	import type { ReportView as ReportData } from '$lib/shared/report';
	import type { EventPageView } from '$lib/shared/types';
	import ReportView from './ReportView.svelte';
	import ResponseForm from './ResponseForm.svelte';
	import SubmittedCard from './SubmittedCard.svelte';

	let {
		view,
		code,
		onchange
	}: { view: EventPageView; code: string; onchange: () => Promise<void> | void } = $props();
	const event = $derived(view.event);
	const mine = $derived(view.mine);
	let editing = $state(false);

	let report = $state<ReportData | null>(null);
	// svelte-ignore state_referenced_locally -- deliberate: this seeds the initial state from the
	// event state at mount only; every later transition is driven explicitly by the $effect below.
	let reportState = $state<'loading' | 'shown' | 'hidden' | 'error'>(
		view.event.state === 'published' ? 'loading' : 'hidden'
	);
	let reportRequested = false;

	$effect(() => {
		if (view.event.state !== 'published' || reportRequested) return;
		reportRequested = true;
		(async () => {
			try {
				report = await api<ReportData>(`/api/events/${code}/report`, { code });
				reportState = 'shown';
			} catch (err) {
				reportState = err instanceof ApiError && err.status === 404 ? 'hidden' : 'error';
			}
		})();
	});
</script>

<h1>{event.title}</h1>
{#if event.context}
	<p class="muted">{event.context}</p>
{/if}

{#if event.state === 'open' && (!mine || editing)}
	<ResponseForm
		{event}
		{code}
		mine={editing ? mine : null}
		oncancel={editing ? () => (editing = false) : undefined}
		onsubmitted={async () => {
			try {
				await onchange();
			} finally {
				editing = false;
			}
		}}
	/>
{:else if event.state === 'open' && mine}
	<SubmittedCard {event} {mine} onedit={() => (editing = true)} />
{:else if event.state === 'closed'}
	<div class="card">
		<h2 style="margin-top:0">Submissions are closed</h2>
		{#if mine}
			<p class="muted">Results are on the way.</p>
		{/if}
	</div>
{:else if reportState === 'shown' && report}
	<ReportView view={report} />
{:else if reportState === 'error'}
	<p class="error" role="alert">Could not load the report. Check your connection and try again.</p>
{:else if reportState === 'loading'}
	<p class="muted">Loading</p>
{:else}
	<div class="card">
		<p>The host shared results with the approved group.</p>
	</div>
{/if}
