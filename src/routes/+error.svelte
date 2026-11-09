<script lang="ts">
	import { page } from '$app/state';
	import { href } from '#lib/paths.ts';

	const notFound = $derived(page.status === 404);
</script>

<svelte:head>
	<title>{notFound ? 'Page not found' : 'Something went wrong'} · California Budget Explorer</title>
</svelte:head>

<main class="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center px-4 py-12">
	<h1 class="text-3xl font-bold text-balance">
		{notFound ? 'We couldn’t find that part of the budget' : 'Something went wrong'}
	</h1>
	<p class="mt-3 text-base-content/80">
		{#if notFound}
			The link may be out of date, or this budget hasn’t been published here yet. The latest budget
			is a click away.
		{:else}
			The budget data didn’t load. This is usually a connection problem: try again, or start from
			the latest budget.
		{/if}
	</p>
	<div class="mt-6 flex flex-wrap gap-2">
		<a class="btn btn-primary" href={href('/')}>Go to the latest budget</a>
		{#if !notFound}
			<button class="btn btn-outline" onclick={() => location.reload()}>Try again</button>
		{/if}
	</div>
	{#if page.error?.message}
		<details class="mt-8 text-sm text-base-content/75">
			<summary class="cursor-pointer">Technical details</summary>
			<p class="mt-2">Error {page.status}: {page.error.message}</p>
		</details>
	{/if}
</main>
