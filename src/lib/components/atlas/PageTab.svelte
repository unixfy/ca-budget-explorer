<script lang="ts">
	/**
	 * The black page tab an atlas prints at the outer edge of every page:
	 * the page number (or KEY MAP) and the page's name in map caps.
	 */
	interface Props {
		/**
		 * Page number, a front-matter page ("ii"), or 0 / undefined for the Key Map.
		 * Front matter: Flows "ii", Reconciliation "iii", Sources "iv", Street Index "Index".
		 */
		page?: number | string;
		/** What this page is, e.g. "Spending", "Health and Human Services". */
		label: string;
		class?: string;
	}
	let { page, label, class: klass = '' }: Props = $props();
</script>

<p class="inline-flex items-stretch text-sm leading-none {klass}">
	<span class="map-label bg-base-content px-2.5 py-1.5 text-base-100 tabular-nums">
		<span class="sr-only">Page </span>{page ? page : 'Key Map'}
	</span>
	<span class="map-label border border-base-content px-2.5 py-[calc(0.375rem-1px)]">{label}</span>
</p>
