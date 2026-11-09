<script lang="ts">
	/**
	 * Atlas citation for a single figure: "Source · Enacted Budget Summary Schedule 9, p. 14",
	 * the first official source behind it, plus a link to how the figure was built.
	 * Stays one compact line so it can sit directly under any number a visitor might repeat.
	 */
	import type { SourceRef } from '#lib/data/schema.ts';
	import { plainSource, sourceHref } from '#lib/sourceLabel.ts';
	import { routes } from '#lib/paths.ts';

	interface Props {
		sources?: (SourceRef | undefined)[];
		fy: string;
		pit: string;
		/** Data product this figure belongs to (expenditures, revenues, flows, ...). */
		product?: string;
	}
	let { sources = [], fy, pit, product }: Props = $props();
	const first = $derived(sources.find((s): s is SourceRef => !!s?.url));
	const s = $derived(first ? plainSource(first) : null);
</script>

{#if s}
	<span
		class="inline-flex max-w-full flex-wrap items-baseline gap-x-1.5 text-xs text-base-content/80"
	>
		<span class="map-label text-[0.6875rem] text-base-content">Source</span>
		<span aria-hidden="true">·</span>
		<a
			class="inline-flex min-w-0 items-baseline gap-1 text-primary underline-offset-2 hover:underline"
			href={sourceHref(s)}
			target="_blank"
			rel="noopener noreferrer"
		>
			<span class="min-w-0 break-words">{s.label}{s.page ? `, p. ${s.page}` : ''}</span>
			<svg
				aria-hidden="true"
				viewBox="0 0 16 16"
				class="size-3 shrink-0 self-center"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"><path d="M9 3h4v4M13 3 7 9M11 9.5V13H3V5h3.5" /></svg
			>
			<span class="sr-only">(opens official source in a new tab)</span>
		</a>
		<span aria-hidden="true">·</span>
		<a
			class="text-primary underline-offset-2 hover:underline"
			href={routes.dataSources(fy, pit, product)}>How we built this</a
		>
	</span>
{/if}
