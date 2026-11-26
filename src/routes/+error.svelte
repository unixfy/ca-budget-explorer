<script lang="ts">
	import { page } from '$app/state';
	import { href } from '#lib/paths.ts';
	import PageTab from '#lib/components/atlas/PageTab.svelte';

	const notFound = $derived(page.status === 404);
</script>

<svelte:head>
	<title>{notFound ? 'Page not found' : 'Something went wrong'} · California Budget Explorer</title>
</svelte:head>

<main class="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center px-4 py-12">
	<PageTab label={notFound ? 'Page not found' : 'Page didn’t load'} />
	<h1 class="mt-4 text-3xl leading-tight font-bold tracking-tight text-balance md:text-4xl">
		{notFound ? 'This page isn’t in the atlas' : 'Something went wrong'}
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
	<div class="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
		<a
			class="map-label inline-flex min-h-11 items-center bg-primary px-4 text-sm text-primary-content no-underline"
			href={href('/')}>Go to the overview</a
		>
		{#if !notFound}
			<button
				class="map-label min-h-11 border border-base-content px-4 text-sm"
				onclick={() => location.reload()}>Try again</button
			>
		{/if}
	</div>
	{#if page.error?.message}
		<details class="mt-8 text-sm text-base-content/75">
			<summary class="cursor-pointer">Technical details</summary>
			<p class="mt-2">Error {page.status}: {page.error.message}</p>
		</details>
	{/if}
</main>
