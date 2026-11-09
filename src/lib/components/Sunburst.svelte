<script lang="ts">
	/**
	 * Rings view (a 3-ring sunburst) over any BudgetNode, in the atlas palette: city tints
	 * with dark casing, condensed map labels, freeway yellow for the selected segment. Click an arc to open it; the centre is a
	 * button that goes back up. Rings inherit the color of their top-level ancestor.
	 * Keyboard: the rings are one tab stop; Left/Right move around a ring, Down moves out
	 * to the next ring, Up moves back in, Enter/Space opens, Escape/Backspace goes up.
	 * Touch: the first tap shows an arc's details, a second tap opens it.
	 */
	import { arc as d3arc, hierarchy, partition, type HierarchyRectangularNode } from 'd3';
	import { animate } from 'motion';
	import type { BudgetNode } from '#lib/data/schema.ts';
	import { money, pct, valueOf } from '#lib/format.ts';
	import { settings } from '#lib/settings.svelte.ts';
	import { CASING } from '#lib/viz/palette.ts';
	import Tooltip from './Tooltip.svelte';

	interface Props {
		node: BudgetNode;
		colors: Map<string, string>;
		size?: number;
		depth?: number;
		onselect?: (chain: BudgetNode[]) => void;
		onup?: () => void;
		/** name of the level the centre button returns to */
		upLabel?: string;
	}
	let { node, colors, size = 460, depth = 3, onselect, onup, upLabel }: Props = $props();

	type Via = 'mouse' | 'focus' | 'touch';
	let width = $state(460);
	let hover = $state<{ x: number; y: number; chain: BudgetNode[]; via: Via } | null>(null);
	let g: SVGGElement | undefined = $state();
	let pointerType = 'mouse';
	let armed = $state<string | null>(null);
	let focusVisible = $state<number | null>(null);
	let hovered = $state<number | null>(null);
	const arcEls: (SVGPathElement | undefined)[] = $state([]);
	const S = $derived(Math.min(size, width));
	const R = $derived(S / 2 - 4);

	type Shallow = { node: BudgetNode; children?: Shallow[] };
	type Arc = HierarchyRectangularNode<Shallow>;
	const v = (n: BudgetNode) => Math.max(0, valueOf(n, settings.year, settings.fund) ?? 0);

	const root = $derived.by(() => {
		const build = (n: BudgetNode, d: number): Shallow => ({
			node: n,
			children:
				d < depth && n.children?.length
					? n.children.filter((c) => v(c) > 0).map((c) => build(c, d + 1))
					: undefined
		});
		const h = hierarchy<Shallow>(build(node, 0), (d) => (d.children?.length ? d.children : null))
			.sum((d) => (d.children?.length ? 0 : v(d.node)))
			.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
		return partition<Shallow>().size([2 * Math.PI, depth + 1])(h);
	});
	const arcs = $derived(
		root.descendants().filter((d) => d.depth > 0 && d.x1 - d.x0 > 0.002) as Arc[]
	);
	let active = $derived.by(() => {
		void node;
		return 0;
	});
	const ringW = $derived(R / (depth + 1));
	const path = $derived(
		d3arc<Arc>()
			.startAngle((d) => d.x0)
			.endAngle((d) => d.x1)
			.innerRadius((d) => d.y0 * ringW)
			.outerRadius((d) => d.y1 * ringW)
	);

	function chainOf(d: Arc) {
		return d
			.ancestors()
			.reverse()
			.slice(1)
			.map((a) => a.data.node);
	}
	const keyOf = (d: Arc) =>
		chainOf(d)
			.map((n) => n.id)
			.join('>');
	function colorOf(d: Arc) {
		const top = d.ancestors().find((a) => a.depth === 1)!;
		return colors.get(top.data.node.id) ?? '#888';
	}
	$effect(() => {
		void node;
		armed = null;
		hovered = null;
		if (!g || settings.reducedMotion) return;
		animate(g, { opacity: [0, 1], transform: ['scale(0.92)', 'scale(1)'] }, { duration: 0.4 });
	});
	/** svg-space point → container-space point (the svg is centred in the container) */
	const toBox = (x: number, y: number) => ({ x: x + width / 2, y: y + S / 2 });
	function showAt(d: Arc, via: Via) {
		const [cx, cy] = path.centroid(d);
		hover = { ...toBox(cx, cy), chain: chainOf(d), via };
	}
	function move(e: PointerEvent, d: Arc, i: number) {
		if (e.pointerType === 'touch') return;
		hovered = i;
		const r = (e.currentTarget as Element).closest('svg')!.getBoundingClientRect();
		hover = {
			x: e.clientX - r.left + (width - S) / 2,
			y: e.clientY - r.top,
			chain: chainOf(d),
			via: 'mouse'
		};
	}
	function open(d: Arc) {
		hover = null;
		onselect?.(chainOf(d));
	}
	function click(d: Arc, i: number) {
		active = i;
		if (pointerType === 'touch' && armed !== keyOf(d)) {
			armed = keyOf(d);
			showAt(d, 'touch');
			return;
		}
		armed = null;
		open(d);
	}

	/** Next arc for an arrow key: around the ring, outward to a child, or inward to the parent. */
	function step(i: number, key: string): number {
		const d = arcs[i];
		const ring = arcs.filter((a) => a.depth === d.depth).sort((a, b) => a.x0 - b.x0);
		const at = ring.indexOf(d);
		let target: Arc | undefined;
		if (key === 'ArrowRight') target = ring[(at + 1) % ring.length];
		else if (key === 'ArrowLeft') target = ring[(at - 1 + ring.length) % ring.length];
		else if (key === 'ArrowDown') target = arcs.find((a) => a.parent === d);
		else if (key === 'ArrowUp') target = d.depth > 1 ? (d.parent as Arc) : undefined;
		const j = target ? arcs.indexOf(target) : -1;
		return j >= 0 ? j : i;
	}
	function key(e: KeyboardEvent, d: Arc, i: number) {
		let next: number | null = null;
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			open(d);
		} else if ((e.key === 'Escape' || e.key === 'Backspace') && onup) {
			e.preventDefault();
			onup();
		} else if (e.key.startsWith('Arrow')) next = step(i, e.key);
		else if (e.key === 'Home') next = 0;
		if (next != null) {
			e.preventDefault();
			active = next;
			arcEls[next]?.focus();
		}
	}
	function focus(e: FocusEvent, d: Arc, i: number) {
		active = i;
		if ((e.currentTarget as Element).matches(':focus-visible')) {
			focusVisible = i;
			showAt(d, 'focus');
		}
	}
	function blur() {
		focusVisible = null;
		if (hover?.via === 'focus') hover = null;
	}
	function centreKey(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onup?.();
		}
	}
	const val = (n: BudgetNode) => valueOf(n, settings.year, settings.fund);
	/** fit the centre label to the hole: ~7.5px per condensed capital at 12px */
	const centreName = $derived.by(() => {
		const max = Math.max(6, Math.floor((2 * (ringW - 2) - 16) / 7.5));
		return node.name.length > max ? node.name.slice(0, max - 1).trimEnd() + '…' : node.name;
	});
	const hint = (n: BudgetNode, via: Via) => {
		const what = n.children?.length || n.detailRef ? 'see what’s inside' : 'see details';
		if (via === 'touch') return `Tap again to ${what}`;
		if (via === 'focus') return `Press Enter to ${what}`;
		return `Click to ${what}`;
	};
	const focused = $derived(focusVisible != null ? arcs[focusVisible] : undefined);
	const lit = $derived(
		focused ??
			(hovered != null ? arcs[hovered] : undefined) ??
			(armed ? arcs.find((a) => keyOf(a) === armed) : undefined)
	);
	const casing = $derived(CASING[settings.mode]);
</script>

<div
	class="relative flex w-full justify-center"
	bind:clientWidth={width}
	onpointerleave={() => {
		hovered = null;
		if (hover?.via === 'mouse') hover = null;
	}}
	role="presentation"
>
	<svg
		width={S}
		height={S}
		viewBox="{-S / 2} {-S / 2} {S} {S}"
		role="group"
		aria-label="Rings of {node.name}. Use arrow keys to move between parts."
	>
		<g bind:this={g} style="transform-origin: 0 0">
			{#each arcs as d, i (d.data.node.id + ':' + d.depth)}
				<path
					bind:this={arcEls[i]}
					d={path(d)}
					fill={colorOf(d)}
					fill-opacity={1 - (d.depth - 1) * 0.25}
					stroke={casing}
					stroke-width={d.depth === 1 ? 1.5 : 0.75}
					class="cursor-pointer outline-none"
					role="button"
					tabindex={i === active ? 0 : -1}
					aria-label="{chainOf(d)
						.map((n) => n.name)
						.join(', ')}: {money(d.value)}, {pct(
						(d.value ?? 0) / (root.value || 1)
					)} of {node.name}"
					onpointerdown={(e) => (pointerType = e.pointerType)}
					onclick={() => click(d, i)}
					onkeydown={(e) => key(e, d, i)}
					onpointermove={(e) => move(e, d, i)}
					onfocus={(e) => focus(e, d, i)}
					onblur={blur}
				/>
			{/each}
			{#if lit}
				<!-- selection as a freeway: yellow line with dark casing, drawn on top -->
				<path d={path(lit)} fill="none" stroke={casing} stroke-width="6" pointer-events="none" />
				<path
					d={path(lit)}
					fill="none"
					class="stroke-secondary"
					stroke-width="3"
					pointer-events="none"
				/>
			{/if}
			{#if onup}
				<g
					role="button"
					tabindex="0"
					aria-label="Go back up{upLabel ? ` to ${upLabel}` : ''}"
					class="group cursor-pointer outline-none"
					onclick={() => onup?.()}
					onkeydown={centreKey}
				>
					<title>Go back up{upLabel ? ` to ${upLabel}` : ''}</title>
					<circle
						r={ringW - 2}
						stroke={casing}
						stroke-width="1"
						class="fill-base-100 group-hover:fill-base-200 group-focus-visible:stroke-secondary group-focus-visible:stroke-[3px]"
					/>
					{@render centre()}
					<g aria-hidden="true" class="fill-base-content/75">
						<path
							d="M-30 33v-8m-3.5 3.5 3.5-3.5 3.5 3.5"
							fill="none"
							class="stroke-base-content/75"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
						<text x="-22" y="34" font-size="12" class="map-label">Back up</text>
					</g>
				</g>
			{:else}
				<g>
					<circle r={ringW - 2} stroke={casing} stroke-width="1" class="fill-base-100" />
					{@render centre()}
				</g>
			{/if}
		</g>
	</svg>
	{#if hover}
		{@const last = hover.chain[hover.chain.length - 1]}
		<Tooltip x={hover.x} y={hover.y} bound={width}>
			{#if hover.chain.length > 1}
				<div class="text-xs text-base-content/75">
					{hover.chain
						.slice(0, -1)
						.map((n) => n.name)
						.join(' › ')}
				</div>
			{/if}
			<div class="font-semibold">{last.name}</div>
			<div class="tabular-nums">
				{money(val(last))}
				<span class="text-base-content/75">· {pct((val(last) ?? 0) / (root.value || 1))}</span>
			</div>
			<div class="text-xs text-base-content/75">{hint(last, hover.via)}</div>
		</Tooltip>
	{/if}
</div>

{#snippet centre()}
	<text
		text-anchor="middle"
		y="-6"
		font-size="12"
		class="map-label fill-base-content/75"
		aria-hidden="true"
	>
		<title>{node.name}</title>
		{centreName}
	</text>
	<text
		text-anchor="middle"
		y="14"
		font-size="16"
		font-weight="600"
		class="fill-base-content tabular-nums"
		aria-hidden="true"
	>
		{money(root.value)}
	</text>
{/snippet}
