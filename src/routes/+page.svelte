<script lang="ts">
	import CreateEvent from '$lib/components/CreateEvent.svelte';
	import HomeScreen from '$lib/components/HomeScreen.svelte';

	let { data } = $props();
</script>

{#if data.signedIn}
	<HomeScreen />
{:else}
	<CreateEvent />
{/if}
