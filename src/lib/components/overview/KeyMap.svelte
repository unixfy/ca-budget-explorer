<script lang="ts">
	/**
	 * The Key Map: the whole budget as one atlas page. Each agency is a tinted block with a
	 * dark casing line, its departments drawn as the white streets inside it, a black
	 * page-number roundel (the agency's own page in the atlas index) and its name in map caps.
	 *
	 * The sheet is laid out exactly like the atlas index's 10 × 7 key sheet (budget-year size,
	 * squarified), so the A–J / 1–7 margin around it finds the same squares the index prints.
	 * Blocks stay put when the year or fund filter changes, the way a printed map does; the
	 * figures inside them follow the filter.
	 *
	 * One tab stop: arrow keys move between agencies, Enter turns to the agency's page.
	 */
	import { hierarchy, treemap, treemapSquarify, type HierarchyRectangularNode } from 'd3';
	import type { BudgetNode } from '#lib/data/schema.ts';
	import type { AtlasIndex } from '#lib/atlas.ts';
	import { money, valueOf } from '#lib/format.ts';
	import { settings } from '#lib/settings.svelte.ts';
	import { CASING, inkOn } from '#lib/viz/palette.ts';
	import { nearestInDirection } from '#lib/components/tree/a11y.ts';

	interface Props {
		node: BudgetNode;
		colors: Map<string, string>;
		index: AtlasIndex;
		hrefOf: (n: BudgetNode) => string;
	}
	let { node, colors, index, hrefOf }: Props = $props();

	let width = $state(0);
	let wide = $state(true);
	$effect(() => {
		const mq = matchMedia('(min-width: 640px)');
		wide = mq.matches;
		const on = (e: MediaQueryListEvent) => (wide = e.matches);
		mq.addEventListener('change', on);
		return () => mq.removeEventListener('change', on);
	});
	// 10 × 7 like the index sheet where the margin grid shows; taller on phones (no margin)
	const height = $derived(Math.round(width * (wide ? 0.7 : 1.25)));

	const size = (n: BudgetNode) => Math.max(0, n.amounts.by ?? 0);
	type Leaf = { node?: BudgetNode; children?: Leaf[] };
	type Rect = HierarchyRectangularNode<Leaf>;

	function sheet(kids: BudgetNode[], x0: number, y0: number, w: number, h: number): Rect[] {
		const live = kids.filter((k) => size(k) > 0);
		if (!live.length || w <= 0 || h <= 0) return [];
		const root = hierarchy<Leaf>({ children: live.map((n) => ({ node: n })) })
			.sum((d) => (d.node ? size(d.node) : 0))
			.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
		treemap<Leaf>().tile(treemapSquarify).size([w, h])(root);
		const out = root.leaves() as Rect[];
		for (const l of out) {
			l.x0 += x0;
			l.x1 += x0;
			l.y0 += y0;
			l.y1 += y0;
		}
		return out;
	}

	const blocks = $derived(
		width > 0
			? sheet(node.children ?? [], 0, 0, width, height).map((r) => {
					const n = r.data.node!;
					const streets = sheet(n.children ?? [], r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
					return { n, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, streets };
				})
			: []
	);

	let active = $state(0);
	let hot = $state<number | null>(null);
	const els: (HTMLAnchorElement | undefined)[] = $state([]);

	function key(e: KeyboardEvent, i: number) {
		let next: number | null = null;
		if (e.key === ' ') {
			e.preventDefault();
			els[i]?.click();
		} else if (e.key.startsWith('Arrow')) next = nearestInDirection(blocks, i, e.key);
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = blocks.length - 1;
		if (next != null) {
			e.preventDefault();
			active = next;
			hot = next;
			els[next]?.focus();
		}
	}

	/** Greedy word wrap for map caps (~0.62em per condensed capital incl. tracking). */
	function wrap(s: string, px: number, font: number, maxLines: number): string[] {
		const per = Math.floor(px / (font * 0.62));
		if (per < 4 || maxLines < 1) return [];
		const lines: string[] = [];
		let cur = '';
		for (const w of s.split(/\s+/)) {
			const next = cur ? `${cur} ${w}` : w;
			if (next.length <= per) cur = next;
			else {
				if (cur) lines.push(cur);
				cur = w.length > per ? w.slice(0, per - 1) + '…' : w;
			}
		}
		if (cur) lines.push(cur);
		if (lines.length > maxLines) {
			const kept = lines.slice(0, maxLines);
			const last = kept[maxLines - 1];
			kept[maxLines - 1] = (last.length >= per ? last.slice(0, per - 1) : last) + '…';
			return kept;
		}
		return lines;
	}

	const casing = $derived(CASING[settings.mode]);
	const val = (n: BudgetNode) => valueOf(n, settings.year, settings.fund);
	const shown = $derived(blocks[hot ?? active]);
	const shownRef = $derived(shown ? index.ref(shown.n.id) : undefined);
</script>

<div class="w-full" bind:clientWidth={width}>
	{#if width > 0}
		<svg
			{width}
			{height}
			role="group"
			aria-label="Key Map of the {blocks.length} agencies, sized by dollars. Use the arrow keys to move between agencies and Enter to turn to an agency's page."
			class="block select-none"
		>
			{#each blocks as b, i (b.n.id)}
				{@const c = colors.get(b.n.id) ?? '#888'}
				{@const w = b.x1 - b.x0}
				{@const h = b.y1 - b.y0}
				{@const r = index.ref(b.n.id)}
				{@const roundel = w >= 34 && h >= 34}
				{@const font = w >= 150 && h >= 90 ? 14 : 12}
				{@const lines = roundel
					? wrap(b.n.name, w - 14, font, Math.floor((h - 40 - (h > 76 ? 18 : 0)) / (font + 2)))
					: []}
				<a
					bind:this={els[i]}
					href={hrefOf(b.n)}
					tabindex={i === active ? 0 : -1}
					aria-label="{b.n.name}: {money(val(b.n))}. Turn to page {r?.own ?? ''}."
					class="outline-none"
					onkeydown={(e) => key(e, i)}
					onfocus={() => ((active = i), (hot = i))}
					onblur={() => hot === i && (hot = null)}
					onpointerenter={() => (hot = i)}
					onpointerleave={() => hot === i && (hot = null)}
				>
					<title>{b.n.name}: {money(val(b.n))}</title>
					<rect x={b.x0} y={b.y0} width={w} height={h} fill={c} />
					{#each b.streets as s (s.data.node!.id)}
						<rect
							x={s.x0 + 0.5}
							y={s.y0 + 0.5}
							width={Math.max(0, s.x1 - s.x0 - 1)}
							height={Math.max(0, s.y1 - s.y0 - 1)}
							fill="none"
							class="stroke-base-100"
							stroke-opacity="0.7"
							stroke-width="1"
							aria-hidden="true"
						/>
					{/each}
					<rect
						x={b.x0 + 0.75}
						y={b.y0 + 0.75}
						width={Math.max(0, w - 1.5)}
						height={Math.max(0, h - 1.5)}
						fill="none"
						stroke={casing}
						stroke-width="1.5"
					/>
					{#if roundel && r?.own}
						<g aria-hidden="true" pointer-events="none">
							<circle cx={b.x0 + 17} cy={b.y0 + 17} r="12" class="fill-base-content" />
							<text
								x={b.x0 + 17}
								y={b.y0 + 21}
								text-anchor="middle"
								font-size={String(r.own).length > 3 ? 9.5 : 11}
								class="map-label fill-base-100 tabular-nums"
								style="letter-spacing: 0">{r.own}</text
							>
						</g>
					{/if}
					{#if lines.length}
						<text
							aria-hidden="true"
							pointer-events="none"
							font-size={font}
							class="map-label"
							fill={inkOn(c)}
						>
							{#each lines as line, li (li)}
								<tspan x={b.x0 + 8} y={b.y0 + 44 + li * (font + 2)}>{line}</tspan>
							{/each}
							{#if h > 76 && w >= 60}
								<tspan
									x={b.x0 + 8}
									y={b.y0 + 44 + lines.length * (font + 2) + 4}
									font-size="12"
									class="font-sans tabular-nums"
									style="text-transform: none; letter-spacing: 0; font-weight: 500"
									>{money(val(b.n))}</tspan
								>
							{/if}
						</text>
					{/if}
				</a>
			{/each}
			{#if wide}
				<!-- the atlas grid: faint lines at every lettered column and numbered row -->
				<g
					aria-hidden="true"
					pointer-events="none"
					class="stroke-base-content"
					stroke-opacity="0.14"
				>
					{#each Array.from({ length: 9 }, (_, k) => k + 1) as k (k)}
						<line x1={(width * k) / 10} x2={(width * k) / 10} y1="0" y2={height} />
					{/each}
					{#each Array.from({ length: 6 }, (_, k) => k + 1) as k (k)}
						<line y1={(height * k) / 7} y2={(height * k) / 7} x1="0" x2={width} />
					{/each}
				</g>
			{/if}
			{#if hot != null && blocks[hot]}
				{@const b = blocks[hot]}
				<!-- freeway yellow marks the selection, drawn on top so neighbours never cover it -->
				<rect
					x={b.x0 + 2}
					y={b.y0 + 2}
					width={Math.max(0, b.x1 - b.x0 - 4)}
					height={Math.max(0, b.y1 - b.y0 - 4)}
					fill="none"
					class="stroke-secondary"
					stroke-width="4"
					pointer-events="none"
				/>
				<rect
					x={b.x0 + 0.5}
					y={b.y0 + 0.5}
					width={Math.max(0, b.x1 - b.x0 - 1)}
					height={Math.max(0, b.y1 - b.y0 - 1)}
					fill="none"
					stroke={casing}
					stroke-width="1"
					pointer-events="none"
				/>
			{/if}
		</svg>
	{:else}
		<div class="aspect-[10/7] w-full bg-base-200"></div>
	{/if}

	{#if shown}
		<p
			class="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b border-base-content/25 py-2 text-sm"
		>
			<span class="font-semibold">{shown.n.name}</span>
			<span class="tabular-nums">{money(val(shown.n))}</span>
			{#if shownRef?.own}
				<a
					href={hrefOf(shown.n)}
					class="map-label ml-auto inline-flex min-h-11 items-center gap-1.5 text-primary no-underline hover:underline"
				>
					Turn to page {shownRef.own}
					<svg
						aria-hidden="true"
						viewBox="0 0 16 16"
						class="size-3.5"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"><path d="M3 8h10M9 4l4 4-4 4" /></svg
					>
				</a>
			{/if}
		</p>
	{/if}
</div>
