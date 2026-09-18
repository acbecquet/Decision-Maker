<script lang="ts">
	let {
		pendingNames,
		onconfirm
	}: { pendingNames: string[]; onconfirm: (pending: 'approve' | 'reject') => Promise<boolean> } =
		$props();

	let dialog: HTMLDialogElement | undefined = $state();
	let busy = $state(false);
	let failed = $state(false);
	const pendingCount = $derived(pendingNames.length);

	export function open() {
		failed = false;
		dialog?.showModal();
	}

	async function choose(pending: 'approve' | 'reject') {
		busy = true;
		failed = false;
		try {
			const ok = await onconfirm(pending);
			if (ok) dialog?.close();
			else failed = true;
		} finally {
			busy = false;
		}
	}
</script>

<dialog bind:this={dialog} aria-labelledby="close-dialog-title">
	<h2 id="close-dialog-title" style="margin-top:0">Close submissions?</h2>
	{#if pendingCount > 0}
		<p>
			{pendingCount}
			{pendingCount === 1 ? 'name is' : 'names are'} still pending: {pendingNames.join(', ')}.
			Closing is final, so decide what happens to them.
		</p>
		<div class="stack">
			<button
				type="button"
				class="btn-primary btn-block"
				disabled={busy}
				onclick={() => choose('approve')}
			>
				Approve pending and close
			</button>
			<button type="button" class="btn-block" disabled={busy} onclick={() => choose('reject')}>
				Reject pending and close
			</button>
			<button type="button" class="btn-block" disabled={busy} onclick={() => dialog?.close()}>
				Go back
			</button>
		</div>
	{:else}
		<p>Nobody can submit or edit after this, and there is no reopen.</p>
		<div class="stack">
			<button
				type="button"
				class="btn-primary btn-block"
				disabled={busy}
				onclick={() => choose('approve')}
			>
				Close now
			</button>
			<button type="button" class="btn-block" disabled={busy} onclick={() => dialog?.close()}>
				Go back
			</button>
		</div>
	{/if}
	{#if failed}
		<p class="error" role="alert">
			Could not close submissions. Check your connection and try again.
		</p>
	{/if}
</dialog>
