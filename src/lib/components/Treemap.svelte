<script lang="ts">
	/**
	 * The map sheet: a zoomable 2-level treemap over any BudgetNode, drawn as an atlas
	 * page. Children are tinted city blocks with dark casing, a page roundel when they
	 * have their own map page, and a "continued" arrow when they open further. Children are the colored tiles; their
	 * children are drawn as subdivisions (a mouse shortcut; the keyboard reaches them by
	 * opening the parent tile). The chart is one tab stop: arrow keys move between tiles,
	 * Enter/Space opens one, Escape/Backspace goes up. On touch, the first tap shows the
	 * tile's details and a second tap opens it.
	 */
	import { hierarchy, treemap, treemapSquarify, type HierarchyRectangularNode } from 'd3';
	import { animate } from 'motion';
	import type { BudgetNode } from '#lib/data/schema.ts';
	import { money, pct, valueOf } from '#lib/format.ts';
	import { settings } from '#lib/settings.svelte.ts';
	import { CASING, inkOn } from '#lib/viz/palette.ts';
	import { refLabel, refSpoken, type AtlasRef } from '#lib/atlas.ts';
	import { wrapText } from '#lib/viz/labels.ts';
	import { nearestInDirection } from './tree/a11y.ts';
	import Tooltip from './Tooltip.svelte';

	interface Props {
		node: BudgetNode;
		colors: Map<string, string>;
		height?: number;
		onselect?: (chain: BudgetNode[]) => void;
		onup?: () => void;
		/** atlas reference for a chain of nodes below `node` (page, grid square, own page) */
		refOf?: (chain: BudgetNode[]) => AtlasRef | undefined;
	}
	let { node, colors, height = 460, onselect, onup, refOf }: Props = $props();

	type Via = 'mouse' | 'focus' | 'touch';
	let width = $state(800);
	let svg: SVGSVGElement | undefined = $state();
	let group: SVGGElement | undefined = $state();
	let hover = $state<{ x: number; y: number; chain: BudgetNode[]; via: Via } | null>(null);
	let busy = false;
	let pointerType = 'mouse';
	/** chain key of the tile a touch user has tapped once ("armed") */
	let armed = $state<string | null>(null);
	/** index of the tile that holds the single tab stop */
	let active = $derived.by(() => {
		void node;
		return 0;
	});
	let focusVisible = $state<number | null>(null);
	/** tile under the mouse, highlighted like a selected freeway */
	let hovered = $state<number | null>(null);
	const tileEls: (SVGGElement | undefined)[] = $state([]);

	type Shallow = { node: BudgetNode; children?: Shallow[] };
	const v = (n: BudgetNode) => Math.max(0, valueOf(n, settings.year, settings.fund) ?? 0);

	const root = $derived.by(() => {
		const build = (n: BudgetNode, depth: number): Shallow => ({
			node: n,
			children:
				depth < 2 && n.children?.length
					? n.children.filter((c) => v(c) > 0).map((c) => build(c, depth + 1))
					: undefined
		});
		const h = hierarchy<Shallow>(build(node, 0), (d) => (d.children?.length ? d.children : null))
			.sum((d) => (d.children?.length ? 0 : v(d.node)))
			.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
		return treemap<Shallow>()
			.tile(treemapSquarify.ratio(1.4))
			.size([Math.max(10, width), height])
			.paddingOuter((d) => (d.depth === 0 ? 1 : 0))
			.paddingTop((d) => {
				if (d.depth === 0) return 1;
				const w = d.x1 - d.x0;
				const h = d.y1 - d.y0;
				if (d.depth !== 1 || w < 44 || h <= 50) return 0;
				// room for the header as drawn: a wrapped name takes 14px a line
				return 8 + LINE * Math.max(1, headerOf(d.data.node, d.value ?? 0, w, h).rows);
			})
			.paddingInner(0)
			.round(true)(h);
	});
	type Tile = HierarchyRectangularNode<Shallow>;
	const tiles = $derived((root.children ?? []) as Tile[]);
	const total = $derived(root.value ?? 0);
	const subsOf = (t: Tile) => (t.children ?? []) as Tile[];
	const opens = (n: BudgetNode) => !!(n.children?.length || n.detailRef);

	// fade in when the node changes
	$effect(() => {
		void node;
		armed = null;
		hovered = null;
		if (!group) return;
		group.setAttribute('transform', '');
		if (settings.reducedMotion) return;
		animate(group, { opacity: [0.2, 1] }, { duration: 0.35 });
	});

	function select(t: Tile, sub?: Tile) {
		if (busy) return;
		hover = null;
		const chain = sub ? [t.data.node, sub.data.node] : [t.data.node];
		if (!opens(t.data.node) || settings.reducedMotion || !group) {
			onselect?.(chain);
			return;
		}
		busy = true;
		const g = group;
		const target = sub ?? t;
		const sx = width / Math.max(1, target.x1 - target.x0);
		const sy = height / Math.max(1, target.y1 - target.y0);
		animate(0, 1, {
			duration: 0.45,
			ease: [0.4, 0, 0.2, 1],
			onUpdate: (p) => {
				const kx = 1 + (sx - 1) * p;
				const ky = 1 + (sy - 1) * p;
				g.setAttribute(
					'transform',
					`translate(${-target.x0 * kx * p} ${-target.y0 * ky * p}) scale(${kx} ${ky})`
				);
				g.style.opacity = String(1 - 0.6 * p);
			}
		}).finished.then(() => {
			busy = false;
			onselect?.(chain);
		});
	}

	/** Sub-tile under the pointer, found from the event target (sub-tiles carry data-sub). */
	function subAt(e: Event, t: Tile): Tile | undefined {
		const i = (e.target as Element | null)?.closest('[data-sub]')?.getAttribute('data-sub');
		return i == null ? undefined : subsOf(t)[Number(i)];
	}
	const chainOf = (t: Tile, s?: Tile) => (s ? [t.data.node, s.data.node] : [t.data.node]);
	const keyOf = (chain: BudgetNode[]) => chain.map((n) => n.id).join('>');

	function showAt(t: Tile, via: Via, chain = chainOf(t)) {
		hover = { x: (t.x0 + t.x1) / 2, y: Math.min(t.y1 - 8, t.y0 + 28), chain, via };
	}

	function click(e: MouseEvent, t: Tile, i: number) {
		const s = subAt(e, t);
		active = i;
		if (pointerType === 'touch') {
			const k = keyOf(chainOf(t, s));
			if (armed !== k) {
				armed = k;
				const box = s ?? t;
				hover = {
					x: (box.x0 + box.x1) / 2,
					y: Math.min(box.y1 - 8, box.y0 + 28),
					chain: chainOf(t, s),
					via: 'touch'
				};
				return;
			}
		}
		armed = null;
		select(t, s);
	}

	function key(e: KeyboardEvent, t: Tile, i: number) {
		let next: number | null = null;
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			select(t);
		} else if ((e.key === 'Escape' || e.key === 'Backspace') && onup) {
			e.preventDefault();
			onup();
		} else if (e.key.startsWith('Arrow')) {
			next = nearestInDirection(tiles, i, e.key);
		} else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = tiles.length - 1;
		if (next != null) {
			e.preventDefault();
			active = next;
			tileEls[next]?.focus();
		}
	}

	function move(e: PointerEvent, t: Tile, i: number) {
		if (e.pointerType === 'touch' || !svg) return;
		hovered = i;
		const r = svg.getBoundingClientRect();
		hover = {
			x: e.clientX - r.left,
			y: e.clientY - r.top,
			chain: chainOf(t, subAt(e, t)),
			via: 'mouse'
		};
	}
	function focus(e: FocusEvent, t: Tile, i: number) {
		active = i;
		const el = e.currentTarget as Element;
		if (el.matches(':focus-visible')) {
			focusVisible = i;
			showAt(t, 'focus');
		}
	}
	function blur() {
		focusVisible = null;
		if (hover?.via === 'focus') hover = null;
	}

	const fits = (t: { x0: number; x1: number; y0: number; y1: number }, w: number, h: number) =>
		t.x1 - t.x0 > w && t.y1 - t.y0 > h;
	const LINE = 14;
	/**
	 * A block's header: its name wrapped to as many lines as the block's height allows
	 * (1 line, 2 from 90px, 3 from 140px), with its amount inline when it fits, else beneath.
	 * Shared by the layout (header band height) and the drawing so the two always agree.
	 */
	function headerOf(n: BudgetNode, value: number, w: number, h: number) {
		const own = refOf?.([n])?.own;
		const rw = roundelW(own);
		const room = w - ((own || opens(n)) && w >= rw + 12 && h >= 22 ? rw + 8 : 0);
		const none = { lines: [] as string[], amount: null as string | null, inline: true, rows: 0 };
		if (w < 44 || h < 18) return none;
		const maxL = h >= 140 ? 3 : h >= 90 ? 2 : 1;
		// the roundel sits beside the first line only; later lines get the block's full width
		const wrap = (lines: number) => wrapText(n.name, w - 14, 7.5, lines, room - 8);
		if (w < 150) {
			const lines = wrap(maxL);
			return { ...none, lines, rows: lines.length };
		}
		const amount = money(value);
		if (maxL === 1) {
			const lines = wrapText(n.name, room - 72, 7.5, 1);
			return { lines, amount, inline: true, rows: 1 };
		}
		let lines = wrap(maxL);
		const lastW = lines.length > 1 ? w - 14 : room - 8;
		const inline = (lines.at(-1)?.length ?? 0) * 7.5 + amount.length * 7 + 10 <= lastW;
		if (!inline && lines.length >= maxL) lines = wrap(maxL - 1);
		return { lines, amount, inline, rows: lines.length + (inline ? 0 : 1) };
	}
	const hint = (n: BudgetNode, via: Via, own?: number) => {
		const what = own ? `turn to page ${own}` : opens(n) ? 'see what’s inside' : 'see details';
		if (via === 'touch') return `Tap again to ${what}`;
		if (via === 'focus') return `Press Enter to ${what}`;
		return `Click to ${what}`;
	};
	const focused = $derived(focusVisible != null ? tiles[focusVisible] : undefined);
	const armedTile = $derived(
		armed ? tiles.find((t) => armed!.split('>')[0] === t.data.node.id) : undefined
	);
	/** highlighted tile: keyboard focus first, then the mouse, then a touch user's first tap */
	const lit = $derived(focused ?? (hovered != null ? tiles[hovered] : undefined) ?? armedTile);
	const casing = $derived(CASING[settings.mode]);
	const refs = $derived(new Map(tiles.map((t) => [t.data.node.id, refOf?.([t.data.node])])));
	/** roundel width for a page number (12px numerals, ~7px each) */
	const roundelW = (own: number | undefined) => (own ? String(own).length * 7 + 22 : 16);
	const spokenRef = (r: AtlasRef | undefined) =>
		r ? `, on ${refSpoken(r)}${r.own ? `; opens page ${r.own}` : ''}` : '';
</script>

<div
	class="relative w-full"
	bind:clientWidth={width}
	onpointerleave={() => {
		hovered = null;
		if (hover?.via === 'mouse') hover = null;
	}}
	role="presentation"
>
	{#if tiles.length === 0}
		<div
			class="flex items-center justify-center bg-base-200 p-4 text-center text-base-content/75"
			style:height="{height}px"
		>
			Nothing to draw here: every amount at this level is zero or negative. See the table below.
		</div>
	{:else}
		<svg
			bind:this={svg}
			{width}
			{height}
			viewBox="0 0 {width} {height}"
			role="group"
			aria-label="Map of {node.name}, {tiles.length} parts. Use arrow keys to move between parts."
			class="block h-auto max-w-full overflow-hidden select-none"
		>
			<g bind:this={group}>
				{#each tiles as t, i (t.data.node.id)}
					{@const c = colors.get(t.data.node.id) ?? '#888'}
					{@const w = t.x1 - t.x0}
					{@const h = t.y1 - t.y0}
					{@const n = t.data.node}
					{@const ref = refs.get(n.id)}
					{@const rw = roundelW(ref?.own)}
					{@const mark = (ref?.own || opens(n)) && w >= rw + 12 && h >= 22}
					{@const hd = headerOf(n, t.value ?? 0, w, h)}
					{@const hx = t.x0 + (w >= 150 ? 6 : 5)}
					<g
						bind:this={tileEls[i]}
						role="button"
						tabindex={i === active ? 0 : -1}
						aria-label="{n.name}: {money(t.value)}, {pct(
							(t.value ?? 0) / (total || 1)
						)} of {node.name}{spokenRef(ref)}"
						class="cursor-pointer outline-none"
						onpointerdown={(e) => (pointerType = e.pointerType)}
						onclick={(e) => click(e, t, i)}
						onkeydown={(e) => key(e, t, i)}
						onpointermove={(e) => move(e, t, i)}
						onfocus={(e) => focus(e, t, i)}
						onblur={blur}
					>
						<rect x={t.x0} y={t.y0} width={w} height={h} fill={c} />
						{#each subsOf(t) as s, si (s.data.node.id)}
							<!-- sub-tiles: the block's streets, a mouse shortcut one level down -->
							<rect
								data-sub={si}
								x={s.x0}
								y={s.y0}
								width={s.x1 - s.x0}
								height={s.y1 - s.y0}
								fill="white"
								fill-opacity={armed === keyOf(chainOf(t, s)) ? 0.4 : 0}
								stroke="white"
								stroke-opacity="0.8"
								stroke-width="1"
								class="transition-[fill-opacity] hover:[fill-opacity:0.3]"
								aria-hidden="true"
							/>
							{#if fits(s, 80, 30)}
								<text
									x={s.x0 + 5}
									y={s.y0 + 15}
									font-size="12"
									font-weight="500"
									class="font-map"
									fill={inkOn(c)}
									fill-opacity="0.9"
									pointer-events="none"
									aria-hidden="true"
								>
									{#each wrapText(s.data.node.name, s.x1 - s.x0 - 8, 6.5, Math.min(3, Math.floor((s.y1 - s.y0 - 8) / LINE))) as l, li (li)}<tspan
											x={s.x0 + 5}
											dy={li ? LINE : 0}>{l}</tspan
										>{/each}
								</text>
							{/if}
						{/each}
						<!-- casing: the dark outline an atlas draws around every block -->
						<rect
							x={t.x0}
							y={t.y0}
							width={w}
							height={h}
							fill="none"
							stroke={casing}
							stroke-width="1.5"
							pointer-events="none"
						/>
						{#if hd.lines.length || hd.amount}
							<text
								x={hx}
								y={t.y0 + 15}
								font-size="12"
								class="map-label"
								fill={inkOn(c)}
								pointer-events="none"
								aria-hidden="true"
							>
								{#each hd.lines as l, li (li)}<tspan x={hx} dy={li ? LINE : 0}>{l}</tspan>{/each}
								{#if hd.amount && hd.inline}<tspan
										class="font-sans tracking-normal normal-case tabular-nums"
										font-weight="500">&nbsp;{hd.amount}</tspan
									>{:else if hd.amount || (!t.children && h >= (hd.rows + 1) * LINE + 8)}<tspan
										x={hx}
										dy={LINE}
										class="font-sans tracking-normal normal-case tabular-nums"
										font-weight="500">{hd.amount ?? money(t.value)}</tspan
									>{/if}
							</text>
						{/if}
						{#if mark}
							<!-- page roundel with a "continued on page" arrow (arrow only below the indexed pages) -->
							{@const rx = t.x1 - rw - 4}
							{@const ry = t.y0 + 4}
							<g pointer-events="none" aria-hidden="true">
								<rect x={rx} y={ry} width={rw} height="16" rx="8" class="fill-base-content" />
								{#if ref?.own}
									<text
										x={rx + 7}
										y={ry + 12.5}
										font-size="12"
										font-weight="700"
										class="fill-base-100 font-map tabular-nums">{ref.own}</text
									>
								{/if}
								<path
									d="M{rx + rw - 12} {ry + 8}h6m-2.5 -3 3 3 -3 3"
									fill="none"
									class="stroke-base-100"
									stroke-width="1.5"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</g>
						{/if}
					</g>
				{/each}
				{#if lit}
					<!-- selection drawn on top as a freeway: yellow line with dark casing -->
					<rect
						x={lit.x0 + 2}
						y={lit.y0 + 2}
						width={Math.max(0, lit.x1 - lit.x0 - 4)}
						height={Math.max(0, lit.y1 - lit.y0 - 4)}
						fill="none"
						stroke={casing}
						stroke-width="6"
						pointer-events="none"
					/>
					<rect
						x={lit.x0 + 2}
						y={lit.y0 + 2}
						width={Math.max(0, lit.x1 - lit.x0 - 4)}
						height={Math.max(0, lit.y1 - lit.y0 - 4)}
						fill="none"
						class="stroke-secondary"
						stroke-width="3"
						pointer-events="none"
					/>
				{/if}
			</g>
		</svg>
		{#if hover}
			{@const last = hover.chain[hover.chain.length - 1]}
			{@const ref = refOf?.(hover.chain)}
			<Tooltip x={hover.x} y={hover.y} bound={width}>
				{#if hover.chain.length > 1}
					<div class="text-xs text-base-content/75">{hover.chain[0].name}</div>
				{/if}
				<div class="font-semibold">{last.name}</div>
				<div class="tabular-nums">
					{money(valueOf(last, settings.year, settings.fund))}
					<span class="text-base-content/75"
						>· {pct((valueOf(last, settings.year, settings.fund) ?? 0) / (total || 1))} of {node.name}</span
					>
				</div>
				{#if ref}<div class="map-label text-xs tabular-nums">{refLabel(ref)}</div>{/if}
				<div class="text-xs text-base-content/75">{hint(last, hover.via, ref?.own)}</div>
			</Tooltip>
		{/if}
	{/if}
</div>
