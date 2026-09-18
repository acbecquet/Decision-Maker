<script lang="ts">
	let { code }: { code: string } = $props();
	const url = $derived(`${location.origin}/e/${code}`);
	let status = $state<'idle' | 'copied' | 'failed'>('idle');
	let input: HTMLInputElement | undefined = $state();

	async function copy() {
		try {
			await navigator.clipboard.writeText(url);
			status = 'copied';
		} catch {
			status = 'failed';
			input?.select();
		}
		setTimeout(() => (status = 'idle'), 3000);
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
	</div>
	{#if status === 'failed'}
		<p class="small error" role="alert">
			Copying is not available here, so the link is selected for you to copy by hand.
		</p>
	{/if}
</div>
