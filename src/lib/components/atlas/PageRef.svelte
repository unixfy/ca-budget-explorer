<script lang="ts">
	/** An atlas reference, "p. 312 · C4": where an item sits on its map page. */
	import { refLabel, refSpoken, type AtlasRef } from '#lib/atlas.ts';

	interface Props {
		ref: AtlasRef | undefined;
		/** Link to the page that draws the item. */
		href?: string;
		class?: string;
	}
	let { ref, href, class: klass = '' }: Props = $props();
</script>

{#if ref}
	{#if href}
		<a
			{href}
			class="map-label text-xs whitespace-nowrap tabular-nums no-underline hover:underline {klass}"
			aria-label="On {refSpoken(ref)}">{refLabel(ref)}</a
		>
	{:else}
		<span class="map-label text-xs whitespace-nowrap tabular-nums {klass}">
			<span class="sr-only">On {refSpoken(ref)}</span><span aria-hidden="true">{refLabel(ref)}</span
			>
		</span>
	{/if}
{/if}
