<script lang="ts">
	import { onMount } from 'svelte';
	import { qrSvg } from '$lib/client/qr';

	let { code, title }: { code: string; title: string } = $props();

	const url = $derived(`${location.origin}/e/${code}`);
	let input: HTMLInputElement | undefined = $state();
	let status = $state<'idle' | 'copied' | 'failed'>('idle');
	let svg = $state('');
	const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

	onMount(async () => {
		svg = await qrSvg(url);
	});

	async function copy() {
		try {
			await navigator.clipboard.writeText(url);
			status = 'copied';
		} catch {
			input?.select();
			status = 'failed';
		}
	}

	async function share() {
		try {
			await navigator.share({ title, url });
		} catch {
			// Cancelled or unavailable; the link and QR code remain.
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
