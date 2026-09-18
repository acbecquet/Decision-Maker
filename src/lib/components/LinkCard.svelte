<script lang="ts">
	let { code }: { code: string } = $props();
	const url = $derived(`${location.origin}/e/${code}`);
	let copied = $state(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(url);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			copied = false;
		}
	}
</script>

<div class="card">
	<label for="event-link">Share this link</label>
	<input id="event-link" readonly value={url} onfocus={(e) => e.currentTarget.select()} />
	<div class="actions">
		<button type="button" onclick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
	</div>
</div>
