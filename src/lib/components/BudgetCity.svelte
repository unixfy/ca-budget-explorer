<script lang="ts">
	/**
	 * 3D "budget city" for any BudgetNode: districts = children, buildings = grandchildren
	 * (or the child itself when it has none); footprint ∝ dollars (treemap), height ∝ √dollars.
	 * Three.js is dynamically imported on mount; falls back to `fallback` without WebGL.
	 *
	 * The camera stays still under the page until the visitor presses "Explore the city":
	 * until then swipes and the wheel scroll the page (no scroll trap). Esc or "Done" releases.
	 * Keyboard and screen-reader users get `listHref`, a list with the same figures.
	 */
	import { onMount, type Snippet } from 'svelte';
	import { hierarchy, treemap, treemapSquarify } from 'd3';
	import type { BudgetNode } from '#lib/data/schema.ts';
	import { money, pct, valueOf, displayName } from '#lib/format.ts';
	import { settings, hasWebGL } from '#lib/settings.svelte.ts';
	import type { CityBlock, CityDistrict, CityScene } from '#lib/viz/city.ts';
	import Tooltip from './Tooltip.svelte';

	interface Props {
		node: BudgetNode;
		colors: Map<string, string>;
		height?: number | string;
		autoRotate?: boolean;
		labels?: number;
		onselect?: (chain: BudgetNode[]) => void;
		fallback?: Snippet;
		class?: string;
		/** Link to an accessible list of the same items (e.g. "#where-money-goes"). */
		listHref?: string;
		/** What that list is called, mid-sentence, e.g. "the list of agencies below". */
		listLabel?: string;
	}
	let {
		node,
		colors,
		height = 480,
		autoRotate = false,
		labels = 8,
		onselect,
		fallback,
		class: klass = '',
		listHref,
		listLabel = 'the table on this page'
	}: Props = $props();

	let canvas: HTMLCanvasElement | undefined = $state();
	let scene: CityScene | undefined = $state();
	let failed = $state(false);
	let loading = $state(true);
	let engaged = $state(false);
	let width = $state(800);
	let hover = $state<{ x: number; y: number; chain: BudgetNode[] } | null>(null);
	let labelEls: HTMLElement[] = $state([]);

	type Shallow = { node: BudgetNode; chain: BudgetNode[]; children?: Shallow[] };
	const v = (n: BudgetNode) => Math.max(0, valueOf(n, settings.year, settings.fund) ?? 0);

	const layout = $derived.by(() => {
		const SIZE = 100;
		const build = (n: BudgetNode, chain: BudgetNode[], d: number): Shallow => ({
			node: n,
			chain,
			children:
				d < 2 && n.children?.length
					? n.children.filter((c) => v(c) > 0).map((c) => build(c, [...chain, c], d + 1))
					: undefined
		});
		const h = hierarchy<Shallow>(build(node, [], 0), (d) =>
			d.children?.length ? d.children : null
		)
			.sum((d) => (d.children?.length ? 0 : v(d.node)))
			.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
		const t = treemap<Shallow>()
			.tile(treemapSquarify)
			.size([SIZE, SIZE])
			.paddingOuter(1.2)
			.paddingInner(0.6)(h);
		const leaves = t.leaves().filter((l) => l.depth > 0);
		const maxV = Math.max(1, ...leaves.map((l) => l.value ?? 0));
		const districts: (CityDistrict & { label: string; value: number })[] = (t.children ?? []).map(
			(c) => ({
				key: c.data.node.id,
				x0: c.x0,
				z0: c.y0,
				x1: c.x1,
				z1: c.y1,
				color: colors.get(c.data.node.id) ?? '#888',
				label: displayName(c.data.node),
				value: c.value ?? 0
			})
		);
		const blocks: CityBlock[] = leaves.map((l) => {
			const top = l.ancestors().find((a) => a.depth === 1)!;
			return {
				key: l.data.node.id,
				ref: l.data.chain,
				x0: l.x0,
				z0: l.y0,
				x1: l.x1,
				z1: l.y1,
				h: 1.5 + 44 * Math.sqrt((l.value ?? 0) / maxV),
				color: colors.get(top.data.node.id) ?? '#888'
			};
		});
		const heights = new Map<string, number>();
		for (const b of blocks) {
			const top = (b.ref as BudgetNode[])[0].id;
			heights.set(top, Math.max(heights.get(top) ?? 0, b.h));
		}
		return { blocks, districts, heights, total: t.value ?? 0 };
	});
	const topDistricts = $derived(layout.districts.slice(0, labels));

	onMount(() => {
		if (!hasWebGL()) {
			failed = true;
			loading = false;
			return;
		}
		let s: CityScene | undefined;
		let cancelled = false;
		import('#lib/viz/city.ts')
			.then(({ CityScene }) => {
				if (cancelled || !canvas) return;
				s = new CityScene(canvas, {
					autoRotate,
					interactive: false,
					reducedMotion: settings.reducedMotion,
					dark: settings.mode === 'dark',
					onHover: (b, x, y) => (hover = b ? { x, y, chain: b.ref as BudgetNode[] } : null),
					onClick: async (b) => {
						// drill one level: into the district the building belongs to
						const chain = (b.ref as BudgetNode[]).slice(0, 1);
						await s?.flyTo(b);
						onselect?.(chain);
					},
					onFrame: placeLabels,
					onContextLost: () => (failed = true)
				});
				scene = s;
				loading = false;
			})
			.catch((e) => {
				console.error('3D view failed to load', e);
				failed = true;
				loading = false;
			});
		return () => {
			cancelled = true;
			s?.dispose();
			scene = undefined;
		};
	});

	$effect(() => {
		scene?.setData(layout.blocks, layout.districts);
	});
	$effect(() => {
		scene?.setDark(settings.mode === 'dark');
	});
	$effect(() => {
		scene?.setInteractive(engaged);
	});

	function engage() {
		engaged = true;
		scene?.setAutoRotate(false);
		canvas?.focus({ preventScroll: true });
	}
	function release() {
		engaged = false;
		hover = null;
	}

	function placeLabels() {
		if (!scene) return;
		topDistricts.forEach((d, i) => {
			const el = labelEls[i];
			if (!el) return;
			const p = scene!.project(
				(d.x0 + d.x1) / 2,
				(layout.heights.get(d.key) ?? 0) + 3,
				(d.z0 + d.z1) / 2
			);
			el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
			el.style.opacity = p.visible ? '1' : '0';
		});
	}

	function onWindowKey(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		hover = null;
		if (engaged) release();
	}
</script>

<svelte:window onkeydown={onWindowKey} />

<div
	bind:clientWidth={width}
	class="relative w-full overflow-hidden {klass}"
	style:height={typeof height === 'number' ? `${height}px` : height}
>
	{#if failed}
		{#if fallback}{@render fallback()}{:else}
			<div class="flex h-full items-center justify-center text-base-content/75">
				3D view unavailable on this device.
			</div>
		{/if}
	{:else}
		<canvas
			bind:this={canvas}
			class="block h-full w-full touch-pan-y {engaged ? 'cursor-grab' : ''}"
			aria-label="3D city of {node.name}: each district is one part of the budget and building height shows dollars. The same figures are in {listLabel}."
			tabindex={engaged ? 0 : -1}
		></canvas>
		{#if loading}
			<div class="absolute inset-0 flex items-center justify-center">
				<span class="loading loading-lg loading-ring" aria-label="Loading the 3D view"></span>
			</div>
		{:else}
			<div class="absolute right-4 bottom-4 z-10 flex flex-wrap items-center justify-end gap-2">
				{#if listHref}
					<a class="btn bg-base-100/90 btn-sm max-sm:min-h-11" href={listHref}>Show as a list</a>
				{/if}
				{#if engaged}
					<button class="btn btn-neutral btn-sm max-sm:min-h-11" onclick={release}>
						Done exploring <kbd class="kbd hidden kbd-xs sm:inline-flex">Esc</kbd>
					</button>
				{:else}
					<button class="btn bg-base-100/90 btn-sm max-sm:min-h-11" onclick={engage}>
						Explore the city
					</button>
				{/if}
			</div>
			{#if engaged}
				<p
					class="pointer-events-none absolute bottom-16 left-1/2 w-max max-w-[90%] -translate-x-1/2 rounded-field bg-base-100/90 px-3 py-1 text-center text-xs text-base-content shadow-sm sm:bottom-4"
					aria-live="polite"
				>
					Drag to turn, scroll or pinch to zoom, click a building to open it.
				</p>
			{/if}
		{/if}
		<div class="pointer-events-none absolute inset-0" aria-hidden="true">
			{#each topDistricts as d, i (d.key)}
				<div
					bind:this={labelEls[i]}
					class="absolute top-0 left-0 flex max-w-[15rem] items-center rounded-full bg-base-100/90 px-2 py-0.5 text-xs font-medium whitespace-nowrap shadow transition-opacity"
				>
					<span class="mr-1 inline-block size-2 shrink-0 rounded-full" style:background={d.color}
					></span><span class="min-w-0 truncate">{d.label}</span>
					<span class="ml-1 shrink-0 text-base-content/75">{money(d.value)}</span>
				</div>
			{/each}
		</div>
		{#if hover}
			{@const last = hover.chain[hover.chain.length - 1]}
			<Tooltip x={hover.x} y={hover.y} bound={width}>
				{#if hover.chain.length > 1}
					<div class="text-xs text-base-content/75">{hover.chain[0].name}</div>
				{/if}
				<div class="font-semibold">{last.name}</div>
				<div class="tabular-nums">
					{money(valueOf(last, settings.year, settings.fund))}
					<span class="text-base-content/75"
						>· {pct((valueOf(last, settings.year, settings.fund) ?? 0) / (layout.total || 1))}</span
					>
				</div>
				<div class="text-xs text-base-content/75">Click to open</div>
			</Tooltip>
		{/if}
	{/if}
</div>
