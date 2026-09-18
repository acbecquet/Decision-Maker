<script lang="ts">
	import type { EventPageView } from '$lib/shared/types';
	import ResponseForm from './ResponseForm.svelte';
	import SubmittedCard from './SubmittedCard.svelte';

	let { view, code, onchange }: { view: EventPageView; code: string; onchange: () => void } =
		$props();
	const event = $derived(view.event);
	const mine = $derived(view.mine);
	let editing = $state(false);
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
		onsubmitted={() => {
			editing = false;
			onchange();
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
{:else}
	<div class="card">
		<p>The host shared results with the approved group.</p>
	</div>
{/if}
