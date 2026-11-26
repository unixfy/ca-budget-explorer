<script lang="ts">
	/** One entry of the Street Index: name ········ p. 312 · C4 */
	import type { Snippet } from 'svelte';
	import type { AtlasRef } from '#lib/atlas.ts';
	import PageRef from './PageRef.svelte';

	interface Props {
		label: string;
		href: string;
		ref?: AtlasRef;
		/** Secondary text under the name (kind, parent, amount...). */
		detail?: Snippet;
		/** Right-hand value before the reference, e.g. an amount. */
		value?: string;
	}
	let { label, href, ref, detail, value }: Props = $props();
</script>

<li class="py-1.5">
	<!-- a long name wraps and the leader runs on from its last line, as in a printed index -->
	<div class="flex items-end gap-2">
		<a {href} class="min-w-0 font-medium text-pretty break-words no-underline hover:underline"
			>{label}</a
		>
		<span class="dot-leader" aria-hidden="true"></span>
		{#if value}<span class="shrink-0 tabular-nums">{value}</span>{/if}
		<PageRef {ref} class="shrink-0" />
	</div>
	{#if detail}<div class="text-xs text-base-content/75">{@render detail()}</div>{/if}
</li>
