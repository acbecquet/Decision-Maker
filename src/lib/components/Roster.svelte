<script lang="ts">
	import type { RosterRow } from '$lib/shared/types';

	let {
		roster,
		readonly,
		onstatus
	}: {
		roster: RosterRow[];
		readonly: boolean;
		onstatus?: (id: string, status: 'approved' | 'rejected') => void;
	} = $props();

	const labels = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' } as const;
</script>

{#if roster.length === 0}
	<p class="muted">Nobody has submitted yet. Share the link.</p>
{:else}
	<ul style="list-style:none;padding:0;margin:0" data-testid="roster" role="list">
		{#each roster as row, i (row.id)}
			<li class="row">
				<span class="grow">
					{row.name}
					{#if row.duplicate}
						<span class="pill pill-warn">Duplicate name</span>
					{/if}
				</span>
				<span
					class="pill"
					class:pill-success={row.status === 'approved'}
					class:pill-danger={row.status === 'rejected'}>{labels[row.status]}</span
				>
				{#if !readonly && onstatus}
					{#if row.status !== 'approved'}
						<button
							type="button"
							class="icon-btn"
							aria-label={`Approve ${row.name}${row.duplicate ? ` (${i + 1})` : ''}`}
							onclick={() => onstatus(row.id, 'approved')}>✓</button
						>
					{/if}
					{#if row.status !== 'rejected'}
						<button
							type="button"
							class="icon-btn"
							aria-label={`Reject ${row.name}${row.duplicate ? ` (${i + 1})` : ''}`}
							onclick={() => onstatus(row.id, 'rejected')}>✕</button
						>
					{/if}
				{/if}
			</li>
		{/each}
	</ul>
{/if}
