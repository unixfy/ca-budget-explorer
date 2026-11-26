<script lang="ts">
	/**
	 * The black page tab an atlas prints at the outer edge of every page.
	 * Budget pages show their page number beside the name; every other page
	 * (overview, tree roots, search, sources…) shows just its name, black.
	 */
	interface Props {
		/** Page number, for pages that draw a budget item. */
		page?: number;
		/** What this page is, e.g. "Spending", "Health and Human Services". */
		label: string;
		class?: string;
	}
	let { page, label, class: klass = '' }: Props = $props();
</script>

<p class="inline-flex items-stretch text-sm leading-none {klass}">
	{#if page}
		<span class="map-label bg-base-content px-2.5 py-1.5 text-base-100 tabular-nums">
			<span class="sr-only">Page </span>{page}
		</span>
		<span class="map-label border border-base-content px-2.5 py-[calc(0.375rem-1px)]">{label}</span>
	{:else}
		<span class="map-label bg-base-content px-2.5 py-1.5 text-base-100">{label}</span>
	{/if}
</p>
