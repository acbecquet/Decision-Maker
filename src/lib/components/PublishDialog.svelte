<script lang="ts">
	import type { EventMode } from '$lib/shared/types';

	let {
		onconfirm,
		message,
		mode
	}: { onconfirm: () => Promise<boolean>; message?: string; mode: EventMode } = $props();

	const deleted = {
		ranked: 'Raw rankings and opinions are deleted',
		single: 'Raw picks and opinions are deleted',
		freeform: 'Raw opinions are deleted'
	} as const;

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

<dialog bind:this={dialog} aria-labelledby="publish-dialog-title">
	<h2 id="publish-dialog-title" style="margin-top:0">Publish results?</h2>
	<p>{deleted[mode]}, and anyone with the link sees the report.</p>
	<div class="stack">
		<button type="button" class="btn-primary btn-block" disabled={busy} onclick={confirm}
			>Publish</button
		>
		<button type="button" class="btn-block" disabled={busy} onclick={() => dialog?.close()}
			>Go back</button
		>
	</div>
	{#if failed}
		<p class="error" role="alert">
			{message || 'Could not publish. Check your connection and try again.'}
		</p>
	{/if}
</dialog>
