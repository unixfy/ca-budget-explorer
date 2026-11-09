<script lang="ts">
	/** Three-year column chart for a single Triple; the budget year is set in freeway yellow. */
	import type { Triple } from '#lib/data/schema.ts';
	import { money, type YearKey } from '#lib/format.ts';
	interface Props {
		amounts: Triple;
		years: { py: string; cy: string; by: string };
		height?: number;
	}
	let { amounts, years, height = 140 }: Props = $props();
	const keys: YearKey[] = ['py', 'cy', 'by'];
	const max = $derived(Math.max(1, ...keys.map((k) => Math.abs(amounts[k] ?? 0))));
	const label = $derived(
		'Amounts by year: ' + keys.map((k) => `${years[k]}, ${money(amounts[k])}`).join('; ')
	);
</script>

<div class="flex items-end gap-6" style:height="{height}px" role="img" aria-label={label}>
	{#each keys as k (k)}
		{@const v = amounts[k]}
		<div class="flex h-full flex-1 flex-col items-center justify-end gap-1">
			<span class="text-xs font-semibold tabular-nums">{money(v)}</span>
			<div
				class="w-full max-w-16 border border-base-content {k === 'by'
					? 'bg-secondary'
					: 'bg-base-300'}"
				style:height="{(Math.abs(v ?? 0) / max) * (height - 40)}px"
			></div>
			<span class="map-label text-xs text-base-content/80 tabular-nums">{years[k]}</span>
		</div>
	{/each}
</div>
