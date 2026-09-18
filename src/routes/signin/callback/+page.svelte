<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { api, ApiError } from '$lib/client/api';
	import { allHostTokens } from '$lib/client/tokens';

	const token = $derived(page.url.searchParams.get('token') ?? '');
	let busy = $state(false);
	let error = $state('');

	async function finish() {
		error = '';
		busy = true;
		try {
			await api('/api/auth/session', {
				method: 'POST',
				body: { token, hostTokens: allHostTokens() }
			});
			await goto(resolve('/me'));
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Something went wrong, try again';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Sign in</title>
</svelte:head>

<main>
	<h1>Sign in</h1>
	{#if !token}
		<p class="error" role="alert">This sign-in link is not valid.</p>
	{:else}
		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}
		<button type="button" class="btn-primary btn-block" onclick={finish} disabled={busy}>
			{busy ? 'Signing in' : 'Finish signing in'}
		</button>
	{/if}
</main>
