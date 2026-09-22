<script lang="ts">
	import { untrack } from 'svelte';
	import { api, ApiError } from '$lib/client/api';
	import { ensureToken } from '$lib/client/tokens';
	import { LIMITS } from '$lib/shared/constants';
	import { formatMoney } from '$lib/shared/money';
	import type { Budget, EventView, MineView } from '$lib/shared/types';
	import { checkResponseForMode, editResponseInput, responseInput } from '$lib/shared/validation';
	import BudgetChips from './BudgetChips.svelte';
	import PrivacyNotice from './PrivacyNotice.svelte';
	import RankingWidget from './RankingWidget.svelte';

	let {
		event,
		code,
		mine = null,
		oncancel,
		onsubmitted
	}: {
		event: EventView;
		code: string;
		mine?: MineView | null;
		oncancel?: () => void;
		onsubmitted: () => void;
	} = $props();

	/** The form is re-mounted whenever the submission changes, so a one-time prefill is intended. */
	const initial = untrack(() => mine);

	let name = $state(initial?.name ?? '');
	let ranked = $state<string[]>([...(initial?.ranking ?? [])]);
	let pick = $state<string | null>(initial?.ranking[0] ?? null);
	let vetoed = $state<string[]>([...(initial?.vetoes ?? [])]);
	let budget = $state<Budget>(initial?.budget ?? null);
	let opinion = $state(initial?.opinion ?? '');
	let suggestion = $state(initial?.suggestion ?? '');
	let error = $state('');
	let busy = $state(false);

	const costs = $derived(
		[...new Set(event.options.map((o) => o.cost).filter((c): c is number => c !== null))].sort(
			(a, b) => a - b
		)
	);
	const opinionPlaceholder = $derived(
		event.mode === 'freeform'
			? 'What you think the group should do, and why'
			: event.mode === 'single'
				? 'Why you picked it, dealbreakers, what would change your mind'
				: 'Anything you want the group to weigh: why you ranked it this way, dealbreakers, what would change your mind'
	);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		const payload = {
			name,
			ranking:
				event.mode === 'single' ? (pick ? [pick] : []) : event.mode === 'freeform' ? [] : ranked,
			vetoes: event.mode === 'ranked' ? vetoed : [],
			budget: event.mode === 'freeform' ? null : budget,
			opinion,
			suggestion
		};
		const parsed = mine ? editResponseInput.safeParse(payload) : responseInput.safeParse(payload);
		if (!parsed.success) {
			error = parsed.error.issues[0]?.message ?? 'Check the form';
			return;
		}
		const problem = checkResponseForMode(event.mode, parsed.data);
		if (problem) {
			error = problem;
			return;
		}
		busy = true;
		try {
			if (mine) {
				await api(`/api/events/${code}/responses`, { method: 'PUT', body: parsed.data, code });
			} else {
				ensureToken(code, 'participant');
				await api(`/api/events/${code}/responses`, { method: 'POST', body: parsed.data, code });
			}
			onsubmitted();
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Could not submit, try again';
		} finally {
			busy = false;
		}
	}
</script>

<form onsubmit={submit} novalidate>
	<PrivacyNotice />

	{#if mine}
		<p class="label">Your name</p>
		<p>{mine.name}</p>
	{:else}
		<label for="name">Your name</label>
		<input id="name" bind:value={name} maxlength={LIMITS.name} autocomplete="name" />
	{/if}

	{#if event.mode === 'ranked'}
		<p class="label">Rank the options <span class="muted">tap in order of preference</span></p>
		<RankingWidget options={event.options} currency={event.currency} bind:ranked bind:vetoed />
	{:else if event.mode === 'single'}
		<fieldset>
			<legend>Pick one option</legend>
			{#each event.options as option (option.id)}
				<label class="row">
					<input type="radio" name="pick" value={option.id} bind:group={pick} />
					<span class="grow" style="line-height:1.25">
						{option.label}
						{#if option.cost !== null}
							<span class="muted small">{formatMoney(option.cost, event.currency)}</span>
						{/if}
						{#if option.note}
							<span class="muted small" style="display:block">{option.note}</span>
						{/if}
					</span>
				</label>
			{/each}
		</fieldset>
	{/if}

	{#if event.mode !== 'freeform' && costs.length > 0}
		<p class="label">
			The most you'd comfortably spend per person <span class="muted">optional</span>
		</p>
		<BudgetChips {costs} currency={event.currency} bind:value={budget} />
	{/if}

	<label for="opinion"
		>Your opinion {#if event.mode !== 'freeform'}<span class="muted">optional</span>{/if}</label
	>
	<textarea
		id="opinion"
		bind:value={opinion}
		maxlength={LIMITS.opinion}
		placeholder={opinionPlaceholder}></textarea>

	{#if event.mode !== 'freeform'}
		<label for="suggestion">Something not listed? <span class="muted">optional</span></label>
		<input
			id="suggestion"
			bind:value={suggestion}
			maxlength={LIMITS.suggestion}
			placeholder="A flamenco show near the hotel"
		/>
	{/if}

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	<div class="actions">
		{#if oncancel}
			<button type="button" onclick={oncancel}>Cancel</button>
		{/if}
		<button type="submit" class="btn-primary" disabled={busy}>
			{mine ? 'Save changes' : 'Submit'}
		</button>
	</div>
</form>
