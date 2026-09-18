<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { api, ApiError } from '$lib/client/api';
	import {
		getAnalysisPrefs,
		getProviderKey,
		setAnalysisPrefs,
		setProviderKey
	} from '$lib/client/keys';
	import { beginOpenRouterConnect } from '$lib/client/openrouter';
	import { EFFORTS } from '$lib/shared/constants';
	import type {
		AnalysisStatus,
		ProviderId,
		ProviderInfo,
		ThinkingEffort
	} from '$lib/shared/report';

	let { code, onsucceeded }: { code: string; onsucceeded: () => Promise<void> | void } = $props();

	type Model = { id: string; label: string };
	const EFFORT_LABELS: Record<ThinkingEffort, string> = {
		low: 'Low',
		medium: 'Medium',
		high: 'High',
		max: 'Max'
	};

	let providers = $state<ProviderInfo[]>([]);
	let providerId = $state<ProviderId | null>(null);
	let key = $state('');
	let models = $state<Model[] | null>(null);
	let model = $state('');
	let effort = $state<ThinkingEffort>('max');
	let loading = $state(false);
	let status = $state<AnalysisStatus | null>(null);
	let error = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;

	const provider = $derived(providers.find((p) => p.id === providerId) ?? null);
	const needsKey = $derived(provider !== null && provider.auth !== 'none');
	const running = $derived(status?.status === 'running');
	const progress = $derived(
		!status || status.status !== 'running'
			? ''
			: status.stage === 'synthesize'
				? 'Writing the report'
				: `Rewriting ${Math.min(status.done + 1, Math.max(status.total - 1, 1))} of ${Math.max(status.total - 1, 1)}`
	);

	function pick(id: ProviderId) {
		providerId = id;
		key = getProviderKey(id) ?? '';
		models = null;
		model = '';
		error = '';
		if (provider?.auth === 'none' || key !== '') void loadModels();
	}

	async function loadModels() {
		if (!providerId) return;
		error = '';
		loading = true;
		try {
			if (needsKey) setProviderKey(providerId, key);
			const res = await api<{ models: Model[] }>(`/api/events/${code}/models`, {
				method: 'POST',
				body: { provider: providerId, key: needsKey ? key : 'demo' },
				code
			});
			models = res.models;
			const remembered = getAnalysisPrefs(code);
			model =
				remembered?.provider === providerId && models.some((m) => m.id === remembered.model)
					? remembered.model
					: (models[0]?.id ?? '');
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Could not reach the server, try again';
		} finally {
			loading = false;
		}
	}

	async function connect() {
		window.location.assign(await beginOpenRouterConnect(code, window.location.origin));
	}

	async function run() {
		if (!providerId || !model) return;
		error = '';
		setAnalysisPrefs(code, { provider: providerId, model, effort });
		try {
			await api(`/api/events/${code}/analysis`, {
				method: 'POST',
				body: { provider: providerId, key: needsKey ? key : 'demo', model, effort },
				code
			});
			status = {
				status: 'running',
				stage: 'anonymize',
				done: 0,
				total: 0,
				error: null,
				hasDraft: false
			};
			poll();
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Could not reach the server, try again';
		}
	}

	async function poll() {
		clearTimeout(timer);
		try {
			status = await api<AnalysisStatus>(`/api/events/${code}/analysis`, { code });
		} catch {
			timer = setTimeout(poll, 3000);
			return;
		}
		if (status.status === 'running') {
			timer = setTimeout(poll, 1500);
		} else if (status.status === 'succeeded') {
			await onsucceeded();
		} else if (status.status === 'failed') {
			error = status.error ?? 'The analysis failed, try again';
		}
	}

	onMount(async () => {
		try {
			providers = (await api<{ providers: ProviderInfo[] }>('/api/providers')).providers;
		} catch {
			error = 'Could not load the provider list, reload the page';
			return;
		}
		const remembered = getAnalysisPrefs(code);
		if (remembered) effort = remembered.effort;
		const initial = providers.find((p) => p.id === remembered?.provider) ?? providers[0];
		if (initial) pick(initial.id);
		await poll();
	});

	onDestroy(() => clearTimeout(timer));
</script>

<h2>Analysis</h2>
<div class="tabs" role="tablist" aria-label="Provider">
	{#each providers as p (p.id)}
		<button
			type="button"
			role="tab"
			class="chip"
			aria-selected={p.id === providerId}
			onclick={() => pick(p.id)}
		>
			{p.label}
		</button>
	{/each}
</div>

{#if provider}
	{#if needsKey}
		<label for="provider-key">API key</label>
		<input
			id="provider-key"
			type="password"
			bind:value={key}
			autocomplete="off"
			spellcheck="false"
		/>
	{/if}
	<div class="actions">
		{#if provider.auth === 'connect'}
			<button type="button" onclick={connect} disabled={running}>Connect OpenRouter</button>
		{/if}
		<button
			type="button"
			onclick={loadModels}
			disabled={loading || running || (needsKey && key.trim() === '')}
		>
			{loading ? 'Loading' : models ? 'Reload models' : 'Load models'}
		</button>
	</div>

	{#if models}
		<label for="model">Model</label>
		<select id="model" bind:value={model}>
			{#each models as m (m.id)}
				<option value={m.id}>{m.label}</option>
			{/each}
		</select>
		<label for="effort">Thinking</label>
		<select id="effort" bind:value={effort}>
			{#each EFFORTS as e (e)}
				<option value={e}>{EFFORT_LABELS[e]}</option>
			{/each}
		</select>
		<button
			type="button"
			class="btn-primary btn-block"
			style="margin-top:12px"
			onclick={run}
			disabled={running || !model}
		>
			{running ? 'Running' : 'Run analysis'}
		</button>
	{/if}
{/if}

{#if progress}
	<p class="small muted" role="status" style="margin-top:8px">{progress}</p>
{/if}
{#if error}
	<p class="error" role="alert">{error}</p>
{/if}
