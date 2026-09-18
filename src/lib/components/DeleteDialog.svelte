<script lang="ts">
	let { onconfirm }: { onconfirm: () => Promise<boolean> } = $props();

	let dialog: HTMLDialogElement | undefined = $state();
	let busy = $state(false);
	let failed = $state(false);

	export function open() {
		failed = false;
		dialog?.showModal();
	}

	async function confirm() {
		busy = true;
		failed = false;
		try {
			const ok = await onconfirm();
			if (ok) dialog?.close();
			else failed = true;
		} finally {
			busy = false;
		}
	}
</script>

<dialog bind:this={dialog} aria-labelledby="delete-dialog-title">
	<h2 id="delete-dialog-title" style="margin-top:0">Delete this event?</h2>
	<p>Everything is removed, including the report.</p>
	<div class="stack">
		<button type="button" class="btn-block btn-danger" disabled={busy} onclick={confirm}
			>Delete</button
		>
		<button type="button" class="btn-block" disabled={busy} onclick={() => dialog?.close()}
			>Go back</button
		>
	</div>
	{#if failed}
		<p class="error" role="alert">Could not delete. Check your connection and try again.</p>
	{/if}
</dialog>
