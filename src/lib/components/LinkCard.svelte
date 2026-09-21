<script lang="ts">
	import { onMount } from 'svelte';
	import { qrSvg } from '$lib/client/qr';
	import { slugify } from '$lib/shared/slug';

	let { code, title }: { code: string; title: string } = $props();

	const slug = $derived(slugify(title));
	const url = $derived(`${location.origin}/e/${code}${slug ? `/${slug}` : ''}`);
	let input: HTMLInputElement | undefined = $state();
	let status = $state<'idle' | 'copied' | 'failed'>('idle');
	let shareFailed = $state(false);
	let svg = $state('');
	const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

	onMount(async () => {
		try {
			svg = await qrSvg(url);
		} catch (err) {
			// The QR code is a convenience; without it the link and the copy button still work.
			console.error('QR code failed', err instanceof Error ? err.message : err);
		}
	});

	async function copy() {
		try {
			await navigator.clipboard.writeText(url);
			status = 'copied';
		} catch {
			input?.select();
			status = 'failed';
		}
		setTimeout(() => (status = 'idle'), 3000);
	}

	async function share() {
		shareFailed = false;
		try {
			await navigator.share({ title, url });
		} catch (err) {
			// A cancelled sheet is not a failure; anything else deserves a visible fallback.
			if (err instanceof Error && err.name === 'AbortError') return;
			shareFailed = true;
		}
	}
</script>

<div class="card">
	<label for="event-link">Share this link</label>
	<input
		id="event-link"
		bind:this={input}
		readonly
		value={url}
		onfocus={(e) => e.currentTarget.select()}
	/>
	<div class="actions">
		<button type="button" onclick={copy}>{status === 'copied' ? 'Copied' : 'Copy link'}</button>
		{#if canShare}
			<button type="button" onclick={share}>Share</button>
		{/if}
	</div>
	{#if shareFailed}
		<p class="small error" role="alert">Sharing did not work here. Copy the link instead.</p>
	{/if}
	{#if status === 'failed'}
		<p class="small error" role="alert">
			Copying is not available here, so the link is selected for you to copy by hand.
		</p>
	{/if}
	{#if svg}
		<!-- {@html} is safe here: svg is generated locally by qrSvg from this app's own event URL, never from user input or the network. -->
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		<div class="qr" data-testid="qr">{@html svg}</div>
	{/if}
</div>
