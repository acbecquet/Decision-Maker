<script lang="ts">
	import { api, ApiError } from '$lib/client/api';

	let email = $state('');
	let sent = $state(false);
	let busy = $state(false);
	let error = $state('');

	async function send(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		busy = true;
		try {
			await api('/api/auth/magic-link', { method: 'POST', body: { email } });
			sent = true;
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
	{#if sent}
		<h1>Check your email</h1>
		<p class="muted">The link works once and expires in 15 minutes.</p>
	{:else}
		<h1>Sign in</h1>
		<form onsubmit={send} novalidate>
			<label for="email">Email</label>
			<input id="email" type="email" bind:value={email} autocomplete="email" inputmode="email" />
			{#if error}
				<p class="error" role="alert">{error}</p>
			{/if}
			<button type="submit" class="btn-primary btn-block" style="margin-top:16px" disabled={busy}>
				{busy ? 'Sending' : 'Send link'}
			</button>
		</form>
	{/if}
</main>
