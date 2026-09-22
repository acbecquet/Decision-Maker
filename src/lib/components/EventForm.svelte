<script lang="ts">
	import { untrack } from 'svelte';
	import { ApiError } from '$lib/client/api';
	import { toLocalInput } from '$lib/client/datetime';
	import { CURRENCIES, LIMITS, MODE_LABELS, MODES, type Currency } from '$lib/shared/constants';
	import type { EventMode, EventView } from '$lib/shared/types';
	import { createEventInput, type CreateEventInput } from '$lib/shared/validation';

	let {
		initial = null,
		submitLabel,
		busyLabel,
		oncancel,
		onsubmit
	}: {
		initial?: EventView | null;
		submitLabel: string;
		busyLabel: string;
		oncancel?: () => void;
		onsubmit: (input: CreateEventInput) => Promise<void>;
	} = $props();

	type OptionDraft = { id: string; label: string; note: string; cost: string };
	const blank = (): OptionDraft => ({ id: crypto.randomUUID(), label: '', note: '', cost: '' });
	const seed = untrack(() => initial);

	let title = $state(seed?.title ?? '');
	let context = $state(seed?.context ?? '');
	let mode = $state<EventMode>(seed?.mode ?? 'ranked');
	let currency = $state<Currency>(
		seed && (CURRENCIES as readonly string[]).includes(seed.currency)
			? (seed.currency as Currency)
			: 'EUR'
	);
	let options = $state<OptionDraft[]>(
		seed
			? seed.options.map((o) => ({
					id: crypto.randomUUID(),
					label: o.label,
					note: o.note,
					cost: o.cost === null ? '' : String(o.cost)
				}))
			: [blank(), blank()]
	);
	let closesAtLocal = $state(toLocalInput(seed?.closesAt ?? null));
	let error = $state('');
	let busy = $state(false);

	// An event created as opinions only has no options, so leaving that mode needs somewhere to type them.
	$effect(() => {
		if (mode !== 'freeform' && untrack(() => options.length) === 0) options = [blank(), blank()];
	});

	function addOption() {
		if (options.length < LIMITS.maxOptions) options.push(blank());
	}

	function removeOption(index: number) {
		if (options.length > LIMITS.minOptions) options.splice(index, 1);
	}

	function payload() {
		return {
			title,
			context,
			currency,
			mode,
			options:
				mode === 'freeform'
					? []
					: options.map((o) => ({
							label: o.label,
							note: o.note,
							cost: o.cost.trim() === '' ? null : Number(o.cost)
						})),
			closesAt: closesAtLocal ? new Date(closesAtLocal).toISOString() : null
		};
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		if (
			mode !== 'freeform' &&
			options.some((o) => o.cost.trim() !== '' && Number.isNaN(Number(o.cost)))
		) {
			error = 'Cost has to be a number';
			return;
		}
		const parsed = createEventInput.safeParse(payload());
		if (!parsed.success) {
			error = parsed.error.issues[0]?.message ?? 'Check the form';
			return;
		}
		if (parsed.data.closesAt && Date.parse(parsed.data.closesAt) <= Date.now()) {
			error = 'The auto-close time has to be in the future';
			return;
		}
		busy = true;
		try {
			await onsubmit(parsed.data);
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Something went wrong, try again';
		} finally {
			busy = false;
		}
	}
</script>

<form onsubmit={submit} novalidate>
	<label for="title">What are you deciding?</label>
	<input
		id="title"
		bind:value={title}
		maxlength={LIMITS.title}
		placeholder="Saturday night in Barcelona"
	/>

	<label for="context">Context <span class="muted">optional</span></label>
	<input
		id="context"
		bind:value={context}
		maxlength={LIMITS.context}
		placeholder="Dinner plans for the group, budget around 30 euros"
	/>

	<fieldset>
		<legend>How people answer</legend>
		{#each MODES as m (m)}
			<label class="row">
				<input type="radio" name="mode" value={m} bind:group={mode} />
				<span class="grow">{MODE_LABELS[m]}</span>
			</label>
		{/each}
	</fieldset>

	{#if mode !== 'freeform'}
		<label for="currency">Currency</label>
		<select id="currency" bind:value={currency}>
			{#each CURRENCIES as c (c)}
				<option value={c}>{c}</option>
			{/each}
		</select>

		<h2>Options</h2>
		{#each options as option, i (option.id)}
			<div class="card">
				<label for={`label-${option.id}`}>Option {i + 1}</label>
				<input
					id={`label-${option.id}`}
					bind:value={option.label}
					maxlength={LIMITS.optionLabel}
					placeholder="Tapas crawl in El Born"
				/>
				<label for={`note-${option.id}`}>Note <span class="muted">optional</span></label>
				<input
					id={`note-${option.id}`}
					bind:value={option.note}
					maxlength={LIMITS.optionNote}
					placeholder="Central, easy to split into tables"
				/>
				<label for={`cost-${option.id}`}>Cost per person <span class="muted">optional</span></label>
				<input
					id={`cost-${option.id}`}
					bind:value={option.cost}
					inputmode="decimal"
					placeholder="25"
				/>
				{#if options.length > LIMITS.minOptions}
					<button
						type="button"
						class="btn-danger"
						style="margin-top:10px"
						onclick={() => removeOption(i)}>Remove option</button
					>
				{/if}
			</div>
		{/each}
		{#if options.length < LIMITS.maxOptions}
			<button type="button" onclick={addOption}>Add option</button>
		{/if}
	{/if}

	<label for="closes">Auto-close submissions at <span class="muted">optional</span></label>
	<input id="closes" type="datetime-local" bind:value={closesAtLocal} />

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	<div class="actions" style="margin-top:16px">
		{#if oncancel}
			<button type="button" onclick={oncancel} disabled={busy}>Cancel</button>
		{/if}
		<button type="submit" class="btn-primary" disabled={busy}>
			{busy ? busyLabel : submitLabel}
		</button>
	</div>
</form>
