<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api, ApiError } from '$lib/client/api';
	import { newToken, setToken } from '$lib/client/tokens';
	import { CURRENCIES, LIMITS, type Currency } from '$lib/shared/constants';
	import { createEventInput } from '$lib/shared/validation';

	type OptionDraft = { id: string; label: string; note: string; cost: string };
	const blank = (): OptionDraft => ({ id: crypto.randomUUID(), label: '', note: '', cost: '' });

	let title = $state('');
	let context = $state('');
	let currency = $state<Currency>('EUR');
	let options = $state<OptionDraft[]>([blank(), blank()]);
	let closesAtLocal = $state('');
	let error = $state('');
	let busy = $state(false);

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
			options: options.map((o) => ({
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
		if (options.some((o) => o.cost.trim() !== '' && Number.isNaN(Number(o.cost)))) {
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
			const hostToken = newToken();
			const { code } = await api<{ code: string }>('/api/events', {
				method: 'POST',
				body: parsed.data,
				headers: { 'x-host-token': hostToken }
			});
			setToken(code, 'host', hostToken);
			await goto(resolve('/e/[code]?created=1', { code }));
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Something went wrong, try again';
		} finally {
			busy = false;
		}
	}
</script>

<main>
	<h1>DecisionMaker</h1>
	<p class="muted">
		Make a group decision without anyone stepping on toes. One link, honest answers, an anonymous
		report.
	</p>

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

		<label for="closes">Auto-close submissions at <span class="muted">optional</span></label>
		<input id="closes" type="datetime-local" bind:value={closesAtLocal} />

		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}
		<button type="submit" class="btn-primary btn-block" style="margin-top:16px" disabled={busy}>
			{busy ? 'Creating' : 'Create event'}
		</button>
	</form>
</main>
