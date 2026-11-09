<script lang="ts">
	/**
	 * The atlas "Sources" inset: the official documents behind the current view,
	 * in plain words, one per line. `compact` drops the inset box for use inside
	 * an existing section.
	 */
	import type { SourceRef } from '#lib/data/schema.ts';
	import { plainSource, sourceHref, type PlainSource } from '#lib/sourceLabel.ts';
	interface Props {
		sources?: (SourceRef | undefined)[];
		title?: string;
		compact?: boolean;
	}
	let { sources = [], title = 'Sources', compact = false }: Props = $props();
	/** Many raw endpoints read as the same document once labelled for people: show each once. */
	const uniq = $derived.by(() => {
		const seen = new Set<string>();
		const out: PlainSource[] = [];
		for (const s of sources) {
			if (!s?.url) continue;
			const p = plainSource(s);
			const k = sourceHref(p) + '#' + p.label;
			if (seen.has(k)) continue;
			seen.add(k);
			out.push(p);
		}
		return out;
	});
</script>

{#if uniq.length}
	<aside class="text-sm {compact ? '' : 'atlas-inset max-w-3xl p-3 sm:p-4'}" aria-label={title}>
		<h3 class="map-label mb-1.5 text-xs">{title}</h3>
		<ul class="divide-y divide-base-300">
			{#each uniq as s (sourceHref(s) + s.label)}
				<li class="flex items-baseline gap-2 py-1">
					<a
						class="min-w-0 break-words text-primary underline-offset-2 hover:underline"
						href={sourceHref(s)}
						target="_blank"
						rel="noopener noreferrer"
						title={s.dataUrl ? `Machine-readable data: ${s.dataUrl}` : undefined}
					>
						{s.label}<span class="sr-only"> (opens in a new tab)</span>
					</a>
					<span class="dot-leader" aria-hidden="true"></span>
					<span class="map-label shrink-0 text-xs text-base-content/80 tabular-nums">
						{#if s.page}p. {s.page}{:else}
							<svg
								aria-hidden="true"
								viewBox="0 0 16 16"
								class="inline size-3 align-[-1px]"
								fill="none"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"><path d="M9 3h4v4M13 3 7 9M11 9.5V13H3V5h3.5" /></svg
							>{/if}
					</span>
				</li>
			{/each}
		</ul>
	</aside>
{/if}
