<script lang="ts">
	/** The atlas legend: a hairline inset box naming what each mark means. */
	import type { Snippet } from 'svelte';

	export interface LegendItem {
		label: string;
		/** Fill colour for a tint swatch, or stroke colour for a line. */
		color?: string;
		kind?: 'tint' | 'line' | 'dash' | 'casing';
		note?: string;
	}
	interface Props {
		title?: string;
		items: LegendItem[];
		children?: Snippet;
		class?: string;
	}
	let { title = 'Legend', items, children, class: klass = '' }: Props = $props();
</script>

<section class="atlas-inset p-3 text-sm {klass}" aria-label={title}>
	<h2 class="map-label mb-2 text-xs">{title}</h2>
	<ul class="space-y-1.5">
		{#each items as it (it.label)}
			<li class="flex items-start gap-2">
				<svg aria-hidden="true" viewBox="0 0 24 14" class="mt-1 h-3.5 w-6 shrink-0">
					{#if it.kind === 'line' || it.kind === 'dash'}
						<line
							x1="1"
							y1="7"
							x2="23"
							y2="7"
							stroke={it.color ?? 'currentColor'}
							stroke-width="3"
							stroke-dasharray={it.kind === 'dash' ? '4 3' : undefined}
						/>
					{:else}
						<rect
							x="0.5"
							y="0.5"
							width="23"
							height="13"
							fill={it.color ?? 'transparent'}
							stroke="currentColor"
							stroke-width={it.kind === 'casing' ? 2 : 1}
						/>
					{/if}
				</svg>
				<span>
					{it.label}
					{#if it.note}<span class="block text-xs text-base-content/75">{it.note}</span>{/if}
				</span>
			</li>
		{/each}
	</ul>
	{#if children}<div class="mt-3 border-t border-base-300 pt-2 text-xs">
			{@render children()}
		</div>{/if}
</section>
