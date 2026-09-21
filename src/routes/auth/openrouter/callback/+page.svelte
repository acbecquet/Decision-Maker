<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { finishOpenRouterConnect, pendingConnectEventCode } from '$lib/client/openrouter';

	let error = $state('');
	const eventCode = $derived(pendingConnectEventCode());

	onMount(async () => {
		const code = page.url.searchParams.get('code');
		if (!code) {
			error = 'OpenRouter did not send a code.';
			return;
		}
		try {
			const back = await finishOpenRouterConnect(code);
			await goto(resolve('/e/[code]/[[slug]]', { code: back }));
		} catch (err) {
			error = err instanceof Error ? err.message : 'Connecting to OpenRouter failed.';
		}
	});
</script>

<svelte:head>
	<title>OpenRouter</title>
</svelte:head>

<main>
	{#if error}
		<p class="error" role="alert">{error}</p>
		{#if eventCode}
			<button
				type="button"
				onclick={() => goto(resolve('/e/[code]/[[slug]]', { code: eventCode }))}
			>
				Back to the event
			</button>
		{/if}
	{:else}
		<p class="muted">Connecting to OpenRouter</p>
	{/if}
</main>
