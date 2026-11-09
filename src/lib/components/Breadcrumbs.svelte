<script lang="ts">
	/**
	 * The atlas running head: where this page sits, with each level's page number
	 * ("Key Map › 100 Health and Human Services › 101 Health Care Services").
	 * Still a breadcrumb nav for assistive tech; the current page is bold.
	 */
	import type { BudgetNode } from '#lib/data/schema.ts';
	interface Props {
		trail: BudgetNode[];
		/** href for a prefix of the trail (index of last item included) */
		hrefFor?: (i: number) => string;
		onpick?: (i: number) => void;
		prefix?: { label: string; href: string; page?: number | string }[];
		/** accessible name of the nav landmark (use a distinct one when two are on a page) */
		label?: string;
		/** page number printed before a trail item's name */
		pageOf?: (n: BudgetNode, i: number) => number | string | undefined;
		/** visible name for the first trail item (e.g. "Key Map" for a tree's root) */
		rootLabel?: string;
	}
	let {
		trail,
		hrefFor,
		onpick,
		prefix = [],
		label = 'Breadcrumb',
		pageOf,
		rootLabel
	}: Props = $props();
	/** full names, visually truncated; the full name is always in the title */
	const crumb = 'inline-block max-w-[12rem] truncate align-bottom sm:max-w-[18rem]';
	const nameOf = (n: BudgetNode, i: number) => (i === 0 && rootLabel ? rootLabel : n.name);
</script>

{#snippet pg(p: number | string | undefined)}
	{#if p != null && p !== ''}<span class="mr-1 tabular-nums"
			><span class="sr-only">page </span>{p}<span class="sr-only">,</span></span
		>{/if}
{/snippet}

{#snippet sep()}
	<svg
		aria-hidden="true"
		viewBox="0 0 8 12"
		class="mx-1.5 h-2.5 w-1.5 shrink-0 text-base-content/50"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
		stroke-linejoin="round"><path d="M2 1.5 6.5 6 2 10.5" /></svg
	>
{/snippet}

<nav class="map-label text-xs text-base-content/80" aria-label={label}>
	<ol class="flex flex-wrap items-center gap-y-1">
		{#each prefix as p, i (p.href)}
			<li class="flex items-center">
				{#if i}{@render sep()}{/if}
				<a href={p.href} title={p.label} class="no-underline hover:text-base-content hover:underline"
					>{@render pg(p.page)}<span class={crumb}>{p.label}</span></a
				>
			</li>
		{/each}
		{#each trail as n, i (n.id)}
			{@const name = nameOf(n, i)}
			<li class="flex items-center">
				{#if i || prefix.length}{@render sep()}{/if}
				{#if i === trail.length - 1}
					<span aria-current="page" class="font-bold text-base-content" title={n.name}
						>{@render pg(pageOf?.(n, i))}<span class="{crumb} sm:max-w-[28rem]">{name}</span></span
					>
				{:else if hrefFor}
					<a
						href={hrefFor(i)}
						title={n.name}
						class="no-underline hover:text-base-content hover:underline"
						>{@render pg(pageOf?.(n, i))}<span class={crumb}>{name}</span></a
					>
				{:else if onpick}
					<button
						type="button"
						class="map-label cursor-pointer hover:text-base-content hover:underline"
						onclick={() => onpick(i)}
						title={n.name}>{@render pg(pageOf?.(n, i))}<span class={crumb}>{name}</span></button
					>
				{:else}
					<span title={n.name}>{@render pg(pageOf?.(n, i))}<span class={crumb}>{name}</span></span>
				{/if}
			</li>
		{/each}
	</ol>
</nav>
