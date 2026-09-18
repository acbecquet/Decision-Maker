<script lang="ts">
	let {
		pendingCount,
		onconfirm
	}: { pendingCount: number; onconfirm: (pending: 'approve' | 'reject') => void } = $props();

	let dialog: HTMLDialogElement | undefined = $state();

	export function open() {
		dialog?.showModal();
	}

	function choose(pending: 'approve' | 'reject') {
		dialog?.close();
		onconfirm(pending);
	}
</script>

<dialog bind:this={dialog}>
	<h2 style="margin-top:0">Close submissions?</h2>
	{#if pendingCount > 0}
		<p>
			{pendingCount}
			{pendingCount === 1 ? 'name is' : 'names are'} still pending. Closing is final, so decide what happens
			to them.
		</p>
		<div class="stack">
			<button type="button" class="btn-primary btn-block" onclick={() => choose('approve')}>
				Approve pending and close
			</button>
			<button type="button" class="btn-block" onclick={() => choose('reject')}>
				Reject pending and close
			</button>
			<button type="button" class="btn-block" onclick={() => dialog?.close()}>Go back</button>
		</div>
	{:else}
		<p>Nobody can submit or edit after this, and there is no reopen.</p>
		<div class="stack">
			<button type="button" class="btn-primary btn-block" onclick={() => choose('approve')}>
				Close now
			</button>
			<button type="button" class="btn-block" onclick={() => dialog?.close()}>Go back</button>
		</div>
	{/if}
</dialog>
