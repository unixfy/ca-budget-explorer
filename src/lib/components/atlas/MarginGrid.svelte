<script lang="ts">
	/**
	 * The lettered and numbered margin of an atlas map: A–J across the top,
	 * 1–7 down the side. Wrap any map (treemap, key map) with it so grid
	 * references like "C4" can be found by eye. The rails are decorative for
	 * assistive tech (the same reference is always given in text) and hide on
	 * phones, where they would cost the map too much width.
	 */
	import type { Snippet } from 'svelte';
	import { GRID_COLS, GRID_ROWS } from '#lib/atlas.ts';

	interface Props {
		children: Snippet;
		class?: string;
	}
	let { children, class: klass = '' }: Props = $props();
</script>

<div
	class="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[1.25rem_minmax(0,1fr)] sm:grid-rows-[1.25rem_auto] {klass}"
>
	<div
		aria-hidden="true"
		class="map-label hidden text-[0.75rem] text-base-content/70 sm:col-start-2 sm:row-start-1 sm:flex"
	>
		{#each GRID_COLS as c (c)}<span class="flex-1 text-center leading-[1.25rem]">{c}</span>{/each}
	</div>
	<div
		aria-hidden="true"
		class="map-label hidden flex-col text-[0.75rem] text-base-content/70 sm:col-start-1 sm:row-start-2 sm:flex"
	>
		{#each Array.from({ length: GRID_ROWS }, (_, i) => i + 1) as r (r)}
			<span class="flex flex-1 items-center justify-center">{r}</span>
		{/each}
	</div>
	<div class="min-w-0 sm:col-start-2 sm:row-start-2">{@render children()}</div>
</div>
