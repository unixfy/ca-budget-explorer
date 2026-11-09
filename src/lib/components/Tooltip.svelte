<script lang="ts">
	/** Map callout: a hairline inset box beside the pointer or focused mark. */
	import type { Snippet } from 'svelte';
	interface Props {
		x: number;
		y: number;
		/** width of the positioning container, used to keep the tooltip inside it */
		bound?: number;
		children: Snippet;
	}
	let { x, y, bound = Infinity, children }: Props = $props();
	/** max width: 16rem, or the container minus a small margin on narrow screens */
	const W = $derived(Math.max(160, Math.min(256, bound - 8)));
	const flip = $derived(x + 14 + W > bound);
	const left = $derived(flip ? Math.max(4, Math.min(x - 14, bound - 4) - W) : x + 14);
</script>

<div
	class="atlas-inset pointer-events-none absolute z-20 px-3 py-2 text-sm shadow-[0_2px_8px_rgb(0_0_0/0.18)]"
	style:left="{left}px"
	style:top="{y + 14}px"
	style:max-width="{W}px"
	style:width={flip ? `${W}px` : undefined}
	role="tooltip"
>
	{@render children()}
</div>
