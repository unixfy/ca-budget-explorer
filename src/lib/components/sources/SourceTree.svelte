<script lang="ts">
	/**
	 * Collapsible tidy tree of the sources catalog (publisher → publication → document type →
	 * document), with a column of the explorer's data products on the right and links showing
	 * which sources feed which product. Drawn as an atlas road map: branches are cased streets,
	 * sources are cased tint roundels, the pages they feed are page tabs, and the selection or
	 * highlight runs in freeway yellow. d3 is used for layout only; rendering is Svelte.
	 * Keyboard: roving tabindex over visible nodes (↑/↓ move, → expand / first child,
	 * ← collapse / parent, Enter/Space select & toggle, Home/End).
	 */
	import { hierarchy, type HierarchyPointNode } from 'd3';
	import { animate } from 'motion';
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import type { CatalogNode, Product, SourcesCatalog } from '#lib/data/sources-catalog.ts';
	import { settings } from '#lib/settings.svelte.ts';
	import { CASING, INK, OTHER } from '#lib/viz/palette.ts';
	import {
		type Agg,
		dominantFormat,
		formatColor,
		PRODUCT_LABEL,
		truncate
	} from '#lib/viz/sourceTree.ts';

	interface Props {
		catalog: SourcesCatalog;
		agg: Map<string, Agg>;
		/** Selected node id ("product:{id}" for a product). */
		selected?: string | null;
		expanded: SvelteSet<string>;
		usedOnly?: boolean;
		showLinks?: boolean;
		/** Pain-point id to highlight. */
		highlight?: string | null;
		onselect?: (id: string) => void;
	}
	let {
		catalog,
		agg,
		selected = $bindable(null),
		expanded,
		usedOnly = false,
		showLinks = true,
		highlight = null,
		onselect
	}: Props = $props();

	const ink = $derived(INK[settings.mode]);
	const casing = $derived(CASING[settings.mode]);
	const ROW = 24;
	const COL = [0, 44, 300, 570, 830];
	const LEAF_CHARS = 56;
	const CH = 6.5; // px per character at 12px
	const PRODUCT_GAP = 90;

	// ---------------------------------------------------------------- layout
	const layout = $derived.by(() => {
		const h = hierarchy(catalog.root, (n) =>
			expanded.has(n.id) ? (n.children ?? []).filter((c) => !usedOnly || c.used) : null
		);
		// Dendrogram-style rows: every visible leaf gets its own row (with a half-row gap between
		// sibling groups) and a parent sits midway between its first and last child, so a long leaf
		// label never runs into a node of a neighbouring subtree.
		const t = h as HierarchyPointNode<CatalogNode>;
		let row = 0;
		let prevParent: unknown = null;
		t.eachAfter((n) => {
			n.y = n.depth;
			if (!n.children?.length) {
				if (prevParent && n.parent !== prevParent) row += 0.5;
				prevParent = n.parent;
				n.x = row++ * ROW;
			} else n.x = (n.children[0].x + n.children[n.children.length - 1].x) / 2;
		});
		const nodes = t.descendants();
		let minX = Infinity;
		let maxX = -Infinity;
		for (const n of nodes) {
			minX = Math.min(minX, n.x);
			maxX = Math.max(maxX, n.x);
		}
		const labelOf = (n: HierarchyPointNode<CatalogNode>) => {
			if (n.depth === 0) return 'All sources'; // drawn above the root dot
			const open = !!n.children?.length;
			const max = open
				? Math.floor((COL[n.depth + 1] - COL[n.depth] - 34) / CH)
				: n.depth === 0
					? 30
					: LEAF_CHARS;
			return truncate(n.data.name, max);
		};
		const items = nodes.map((n) => {
			const label = labelOf(n);
			// a closed branch says how much is inside: "+12"
			const kids = n.data.children?.length ?? 0;
			const more = kids && !n.children?.length && n.depth > 0 ? ` +${kids}` : '';
			return {
				id: n.data.id,
				node: n,
				x: COL[Math.min(n.depth, COL.length - 1)],
				y: n.x - minX,
				label,
				more,
				labelEnd:
					n.depth === 0
						? radius(n.data.id) + 4
						: COL[Math.min(n.depth, COL.length - 1)] + 12 + (label.length + more.length) * CH + 6
			};
		});
		const treeH = maxX - minX;
		const maxEnd = Math.max(...items.map((i) => i.labelEnd), COL[COL.length - 1]);
		const px = Math.max(COL[2] + 260, maxEnd + PRODUCT_GAP);
		const prods = catalog.products;
		const pGap = Math.max(36, Math.min(64, treeH / Math.max(1, prods.length - 1)));
		const pTop = Math.max(0, treeH / 2 - (pGap * (prods.length - 1)) / 2);
		const products = prods.map((p, i) => ({ ...p, x: px, y: pTop + i * pGap }));
		const height = Math.max(treeH, pTop * 2 + pGap * (prods.length - 1));
		const byId = new Map(items.map((i) => [i.id, i]));
		return { items, byId, products, height, width: px + 170 };
	});

	// ---------------------------------------------------------------- animated positions
	type P = { x: number; y: number };
	let disp: Record<string, P> = $state.raw({});
	let stop: (() => void) | undefined;
	$effect(() => {
		const { items } = layout;
		const target: Record<string, P> = {};
		for (const it of items) target[it.id] = { x: it.x, y: it.y };
		const prev = untrack(() => disp);
		stop?.();
		if (settings.reducedMotion || !Object.keys(prev).length) {
			disp = target;
			return;
		}
		// new nodes grow out of their nearest previously visible ancestor
		const from: Record<string, P> = {};
		for (const it of items) {
			let a: HierarchyPointNode<CatalogNode> | null = it.node;
			while (a && !prev[a.data.id]) a = a.parent;
			from[it.id] = prev[it.id] ?? (a ? prev[a.data.id] : target[it.id]);
		}
		const c = animate(0, 1, {
			duration: 0.4,
			ease: [0.22, 1, 0.36, 1],
			onUpdate: (p) => {
				const d: Record<string, P> = {};
				for (const id in target) {
					const f = from[id];
					const t = target[id];
					d[id] = { x: f.x + (t.x - f.x) * p, y: f.y + (t.y - f.y) * p };
				}
				disp = d;
			}
		});
		stop = () => c.stop();
		return () => c.stop();
	});
	const pos = (id: string, fb: P): P => disp[id] ?? fb;

	// ---------------------------------------------------------------- encodings
	const radius = (id: string) => {
		const d = agg.get(id)?.docs ?? 1;
		return Math.min(13, 3.5 + Math.sqrt(d) * 0.9);
	};
	const colorOf = (n: CatalogNode) => formatColor(dominantFormat(n, agg.get(n.id)), settings.mode);
	const isHi = (id: string) => !!highlight && !!agg.get(id)?.pain.has(highlight);

	/** Links from each visible frontier node (no visible children) to the products it feeds. */
	const productLinks = $derived.by(() => {
		if (!showLinks) return [];
		const out: { from: string; product: Product; w: number }[] = [];
		for (const it of layout.items) {
			if (it.node.children?.length || it.node.depth === 0) continue;
			const a = agg.get(it.id);
			if (!a?.used) continue;
			for (const p of a.feeds) out.push({ from: it.id, product: p, w: a.backs[p] ?? 1 });
		}
		return out;
	});
	const strokeW = (w: number) => Math.min(7, 0.8 + Math.sqrt(w) / 3.2);
	const selProduct = $derived(selected?.startsWith('product:') ? selected.slice(8) : null);
	/** Ids on the path root→selected and the selected subtree (to emphasize links). */
	const selSet = $derived.by(() => {
		const s = new Set<string>();
		if (!selected || selProduct) return s;
		const it = layout.byId.get(selected);
		if (!it) return s;
		it.node.descendants().forEach((d) => s.add(d.data.id));
		return s;
	});
	const linkOpacity = (from: string, product: string) => {
		if (selProduct) return product === selProduct ? 0.95 : 0.06;
		if (selSet.size) return selSet.has(from) ? 0.95 : 0.08;
		return 0.4;
	};

	const treePath = (a: P, aEnd: number, b: P) => {
		const x0 = aEnd - 4;
		const mx = (x0 + b.x) / 2;
		return `M${x0},${a.y}C${mx},${a.y} ${mx},${b.y} ${b.x - 6},${b.y}`;
	};
	const prodPath = (a: P, aEnd: number, b: P) => {
		const mx = aEnd + (b.x - aEnd) * 0.55;
		return `M${aEnd},${a.y}C${mx},${a.y} ${mx},${b.y} ${b.x - 9},${b.y}`;
	};

	// ---------------------------------------------------------------- interaction
	let focusId = $state('root');
	let svgEl: SVGSVGElement | undefined = $state();
	let hover = $state<{ id: string; x: number; y: number } | null>(null);

	function toggle(n: CatalogNode) {
		if (!n.children?.length) return;
		if (expanded.has(n.id)) expanded.delete(n.id);
		else expanded.add(n.id);
	}
	function choose(id: string) {
		selected = id;
		onselect?.(id);
	}
	function activate(n: CatalogNode) {
		toggle(n);
		choose(n.id);
	}
	function focusNode(id: string) {
		focusId = id;
		requestAnimationFrame(() =>
			svgEl?.querySelector<SVGGElement>(`[data-node="${CSS.escape(id)}"]`)?.focus()
		);
	}
	function onkey(e: KeyboardEvent, it: (typeof layout.items)[number]) {
		const order = layout.items; // breadth-first; keyboard order is vertical
		const vert = [...order].sort((a, b) => a.y - b.y || a.x - b.x);
		const i = vert.findIndex((v) => v.id === it.id);
		const n = it.node;
		switch (e.key) {
			case 'ArrowDown':
				if (vert[i + 1]) focusNode(vert[i + 1].id);
				break;
			case 'ArrowUp':
				if (vert[i - 1]) focusNode(vert[i - 1].id);
				break;
			case 'ArrowRight':
				if (n.data.children?.length && !expanded.has(n.data.id)) expanded.add(n.data.id);
				else if (n.children?.[0]) focusNode(n.children[0].data.id);
				break;
			case 'ArrowLeft':
				if (expanded.has(n.data.id) && n.children?.length) expanded.delete(n.data.id);
				else if (n.parent) focusNode(n.parent.data.id);
				break;
			case 'Home':
				focusNode(vert[0].id);
				break;
			case 'End':
				focusNode(vert[vert.length - 1].id);
				break;
			case 'Enter':
			case ' ':
				activate(n.data);
				break;
			default:
				return;
		}
		e.preventDefault();
	}
	// keep the roving focus target valid when nodes disappear
	$effect(() => {
		if (!layout.byId.has(focusId)) untrack(() => (focusId = 'root'));
	});

	const M = { t: 26, r: 12, b: 20, l: 14 };
	const hoverItem = $derived(hover ? layout.byId.get(hover.id) : undefined);
</script>

<div class="relative">
	<svg
		bind:this={svgEl}
		width={layout.width + M.l + M.r}
		height={layout.height + M.t + M.b}
		viewBox="0 0 {layout.width + M.l + M.r} {layout.height + M.t + M.b}"
		class="block select-none"
		role="tree"
		aria-label="Tree of budget data sources"
		style="font: 500 12px var(--font-sans)"
	>
		<g transform="translate({M.l},{M.t})">
			<!-- column headers -->
			<g aria-hidden="true" fill={ink.secondary} class="map-label" style="font-size:11px">
				<text x={COL[1] - 4} y={-12}>Publisher</text>
				<text x={COL[2] - 4} y={-12}>Publication</text>
				<text x={COL[3] - 4} y={-12}>Kind of document</text>
				<text x={COL[4] - 4} y={-12}>Document or data feed</text>
				{#if layout.products[0]}
					<text x={layout.products[0].x - 6} y={-12}>Used on these pages</text>
				{/if}
			</g>

			<!-- tree links: cased streets (dashed trail for sources not used here) -->
			<g fill="none" stroke-linecap="round" aria-hidden="true">
				{#each layout.items as it (it.id)}
					{#if it.node.parent}
						{@const p = layout.byId.get(it.node.parent.data.id)!}
						{@const d = treePath(pos(p.id, p), pos(p.id, p).x + (p.labelEnd - p.x), pos(it.id, it))}
						{#if it.node.data.used || isHi(it.id)}
							<path {d} stroke={casing} stroke-width={isHi(it.id) ? 6 : 4} />
							<path
								{d}
								stroke={isHi(it.id) ? 'var(--color-secondary)' : ink.surface}
								stroke-width={isHi(it.id) ? 3.5 : 2}
							/>
						{:else}
							<path {d} stroke={ink.muted} stroke-width="1.25" stroke-dasharray="3 3" />
						{/if}
					{/if}
				{/each}
			</g>

			<!-- product links -->
			<g fill="none" aria-hidden="true">
				{#each productLinks as l (l.from + '>' + l.product)}
					{@const it = layout.byId.get(l.from)!}
					{@const pr = layout.products.find((x) => x.id === l.product)}
					{#if pr}
						{@const a = pos(it.id, it)}
						{@const d = prodPath(a, a.x + (it.labelEnd - it.x), pr)}
						<g opacity={linkOpacity(l.from, l.product)} stroke-linecap="round">
							<title
								>{it.node.data.name} → {PRODUCT_LABEL[l.product]} ({l.w.toLocaleString()} citations)</title
							>
							<path {d} stroke={casing} stroke-width={strokeW(l.w) + 2} />
							<path {d} stroke={colorOf(it.node.data)} stroke-width={strokeW(l.w)} />
						</g>
					{/if}
				{/each}
			</g>

			<!-- nodes -->
			{#each layout.items as it (it.id)}
				{@const n = it.node.data}
				{@const p = pos(it.id, it)}
				{@const hasKids = !!n.children?.length}
				{@const open = expanded.has(n.id)}
				{@const c = colorOf(n)}
				{@const r = radius(n.id)}
				{@const a = agg.get(n.id)}
				<g
					data-node={n.id}
					transform="translate({p.x},{p.y})"
					role="treeitem"
					aria-level={it.node.depth + 1}
					aria-expanded={hasKids ? open : undefined}
					aria-selected={selected === n.id}
					aria-label="{n.name}{n.missing
						? ', expected but not published'
						: n.used
							? ''
							: ', not used by this explorer'}{a ? `, ${a.docs.toLocaleString()} documents` : ''}"
					tabindex={focusId === n.id ? 0 : -1}
					class="cursor-pointer outline-none [&:focus-visible>.ring]:opacity-100"
					onclick={() => {
						focusId = n.id;
						activate(n);
					}}
					onkeydown={(e) => onkey(e, it)}
					onfocus={() => (focusId = n.id)}
					onpointerenter={() => (hover = { id: n.id, x: p.x, y: p.y })}
					onpointerleave={() => (hover = null)}
				>
					<!-- generous hit target -->
					<rect
						x={-r - 4}
						y={-ROW / 2}
						width={it.labelEnd - it.x + r + 4}
						height={ROW}
						fill="transparent"
					/>
					<rect
						class="opacity-0 ring"
						x={-r - 4}
						y={-ROW / 2 + 1}
						width={it.labelEnd - it.x + r + 2}
						height={ROW - 2}
						rx="1"
						fill="none"
						stroke={ink.primary}
						stroke-width="2"
					/>
					{#if selected === n.id}
						<rect
							x={-r - 4}
							y={-ROW / 2 + 1}
							width={it.labelEnd - it.x + r + 2}
							height={ROW - 2}
							rx="1"
							fill="var(--color-secondary)"
							opacity="0.55"
						/>
					{/if}
					{#if isHi(n.id)}
						<circle r={r + 4} fill="none" stroke={casing} stroke-width="5" />
						<circle r={r + 4} fill="none" stroke="var(--color-secondary)" stroke-width="3" />
					{/if}
					{#if n.missing}
						<circle
							{r}
							fill="none"
							stroke={ink.secondary}
							stroke-width="2"
							stroke-dasharray="2 2"
						/>
						<path d="M-3,-3L3,3M3,-3L-3,3" stroke={ink.secondary} stroke-width="1.75" />
					{:else if n.used}
						<circle {r} fill={c} stroke={casing} stroke-width={hasKids && !open ? 2.25 : 1.25} />
					{:else}
						<circle
							{r}
							fill={ink.surface}
							stroke={n.kind === 'analysis' ? OTHER[settings.mode] : c}
							stroke-width="1.75"
							stroke-dasharray="2.5 2"
						/>
					{/if}
					<text
						x={it.node.depth === 0 ? -r : r + 6}
						y={it.node.depth === 0 ? -r - 8 : 0}
						dy="0.32em"
						fill={n.used ? ink.primary : ink.secondary}
						font-weight={it.node.depth <= 1 ? 600 : 400}
						font-style={n.used ? undefined : 'italic'}
						paint-order="stroke"
						stroke={ink.surface}
						stroke-width="3"
						stroke-linejoin="round"
						>{it.label}{#if it.more}<tspan fill={ink.secondary} font-weight="600">{it.more}</tspan
							>{/if}</text
					>
				</g>
			{/each}

			<!-- products -->
			{#each layout.products as pr (pr.id)}
				{@const sel = selProduct === pr.id}
				<g
					transform="translate({pr.x},{pr.y})"
					data-product={pr.id}
					role="button"
					tabindex="0"
					aria-pressed={sel}
					aria-label="{PRODUCT_LABEL[pr.id]}: show its sources"
					class="cursor-pointer outline-none focus-visible:[&>rect]:stroke-[3]"
					onclick={() => choose(sel ? '' : `product:${pr.id}`)}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							choose(sel ? '' : `product:${pr.id}`);
						}
					}}
				>
					<rect
						x="-9"
						y="-12"
						width="160"
						height="24"
						rx="1"
						fill={sel ? ink.primary : ink.surface}
						stroke={ink.primary}
						stroke-width="1.25"
					/>
					<text
						x="0"
						dy="0.34em"
						class="map-label"
						style="font-size:11px"
						fill={sel ? ink.surface : ink.primary}>{PRODUCT_LABEL[pr.id]}</text
					>
				</g>
			{/each}
		</g>
	</svg>

	{#if hover && hoverItem}
		{@const n = hoverItem.node.data}
		{@const a = agg.get(n.id)}
		{@const p = pos(hover.id, hoverItem)}
		<div
			class="atlas-inset pointer-events-none absolute z-10 max-w-xs px-3 py-2 text-xs shadow-md"
			style="left:{p.x + M.l + 16}px; top:{p.y + M.t + 14}px"
			role="presentation"
		>
			<p class="font-semibold">{n.name}</p>
			{#if a}
				<p class="text-base-content/80">
					{a.docs.toLocaleString()} document{a.docs === 1 ? '' : 's'}{a.files
						? ` · ${a.files.toLocaleString()} downloaded`
						: ''}{a.pages ? ` · ${a.pages.toLocaleString()} PDF pages` : ''}
				</p>
			{/if}
			<p class="text-base-content/75">
				{n.missing
					? 'Expected, but not published'
					: n.used
						? 'Used by this explorer'
						: 'Not used here'} · select for details
			</p>
		</div>
	{/if}
</div>
