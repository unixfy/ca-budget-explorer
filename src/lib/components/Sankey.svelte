<script lang="ts">
	/**
	 * The route map: revenues -> fund types -> spending areas (flows.json), drawn like an
	 * atlas route diagram. Nodes are cased tint blocks, links are translucent ribbons with
	 * a thin casing edge, and the focused or selected block wears a freeway-yellow outline.
	 */
	import type { Flows, FlowNode } from '#lib/data/schema.ts';
	import { money, pct } from '#lib/format.ts';
	import { settings } from '#lib/settings.svelte.ts';
	import { CASING, OTHER } from '#lib/viz/palette.ts';
	import {
		sankeyLayout,
		linkBand,
		nodeValues,
		routeTints,
		spreadLabels,
		wrapLabel,
		type SankeyNode,
		type SankeyLink
	} from '#lib/viz/sankey.ts';
	import Tooltip from './Tooltip.svelte';

	interface Props {
		flows: Flows;
		height?: number;
		onselect?: (n: FlowNode) => void;
		/** Node currently being opened (shows a pending state on it). */
		busyId?: string | null;
		/** Agency city tints (from the Key Map) for the spending column, by node id. */
		agencyTints?: Map<string, string>;
	}
	let { flows, height = 640, onselect, busyId = null, agencyTints }: Props = $props();

	const uid = $props.id();
	let width = $state(900);
	let svgEl: SVGSVGElement | undefined = $state();
	let hoverId = $state<string | null>(null);
	let focusId = $state<string | null>(null);
	/** Touch selection: first tap selects and shows values, second tap opens. */
	let pickedId = $state<string | null>(null);
	let tabStop = $state<string | null>(null);
	let pointerType = 'mouse';
	let tip = $state<{
		x: number;
		y: number;
		html: { title: string; value: number; sub?: string };
	} | null>(null);

	const active = $derived(hoverId ?? focusId ?? pickedId);

	/** Label gutter on each side, sized to the chart. */
	const side = $derived(Math.round(Math.min(200, Math.max(110, width * 0.22))));
	const M = $derived({ l: side, r: side });
	const FONT = 13;
	const LINE = 15;
	/** Column headers band above the map. */
	const HEAD = 30;
	const sideChars = $derived(Math.max(12, Math.floor((side - 14) / 6.2)));

	const layout = $derived(
		sankeyLayout(flows.nodes, flows.links, {
			width: Math.max(160, width - M.l - M.r),
			height,
			nodeWidth: 14,
			padding: 8
		})
	);
	const total = $derived(
		Math.max(...layout.columns.map((c) => c.reduce((a, n) => a + n.value, 0)), 1)
	);
	const lastCol = $derived(layout.columns.length - 1);
	const colOf = (n: SankeyNode<FlowNode>) => layout.columns.findIndex((c) => c.includes(n));

	/** Tint follows the entity: water for revenue, road tints for funds, city tints for areas. */
	const tints = $derived(
		routeTints(flows.nodes, nodeValues(flows.links), settings.mode, agencyTints)
	);
	const tintOf = (id: string) => tints.get(id) ?? OTHER[settings.mode];
	/** A ribbon takes the tint of the fund it travels through. */
	const linkColor = (l: SankeyLink<FlowNode>) =>
		l.source.column === layout.columns[1]?.[0]?.column ? tintOf(l.source.id) : tintOf(l.target.id);
	const casing = $derived(CASING[settings.mode]);
	/** Ribbon edges: dark casing by day; at night the tint's own edge reads better. */
	const edgeOf = (l: SankeyLink<FlowNode>) => (settings.mode === 'light' ? casing : linkColor(l));

	/**
	 * Every node gets a label. Labels wrap to two lines (cut in the middle if still too long)
	 * and are spread apart so small nodes keep a label, joined to their node by a leader line.
	 */
	const labels = $derived.by(() => {
		const out = new Map<
			string,
			{ lines: string[]; value: string; inline: boolean; top: number; h: number; x: number }
		>();
		layout.columns.forEach((col, ci) => {
			const left = ci === 0;
			const chars = ci === 0 || ci === lastCol ? sideChars : 22;
			const items = col.map((n) => {
				const lines = wrapLabel(n.data.name, chars, 2);
				const value = money(n.value);
				const inline = lines[lines.length - 1].length + value.length + 1 <= chars + 6;
				const h = (lines.length + (inline ? 0 : 1)) * LINE;
				return { id: n.id, y: (n.y0 + n.y1) / 2, h, lines, value, inline, x: left ? n.x0 : n.x1 };
			});
			for (const it of spreadLabels(items, -2, height + 2, 2)) out.set(it.id, it);
		});
		return out;
	});

	const linked = $derived.by(() => {
		if (!active) return null;
		const n = layout.nodes.find((x) => x.id === active);
		if (!n) return null;
		// follow upstream and downstream one hop each side for clarity
		return new Set<SankeyLink<FlowNode>>([...n.in, ...n.out]);
	});

	const stop = $derived(
		tabStop && layout.nodes.some((n) => n.id === tabStop) ? tabStop : layout.columns[0]?.[0]?.id
	);

	function pointerTip(e: PointerEvent, title: string, value: number, sub?: string) {
		if (!svgEl) return;
		const r = svgEl.getBoundingClientRect();
		tip = { x: e.clientX - r.left, y: e.clientY - r.top, html: { title, value, sub } };
	}
	const hint = () =>
		pointerType === 'touch' ? 'Tap again to explore' : 'Click or press Enter to explore';
	const nodeSub = (n: SankeyNode<FlowNode>) => `${pct(n.value / total)} of the total · ${hint()}`;
	function nodeTip(n: SankeyNode<FlowNode>) {
		tip = {
			x: M.l + n.x1 + 4,
			y: HEAD + Math.max(0, n.y0),
			html: { title: n.data.name, value: n.value, sub: nodeSub(n) }
		};
	}
	function clearTip() {
		if (!focusId && !pickedId) tip = null;
	}

	function open(n: SankeyNode<FlowNode>) {
		pickedId = null;
		onselect?.(n.data);
	}
	function onClick(n: SankeyNode<FlowNode>) {
		if (pointerType === 'touch' && pickedId !== n.id) {
			pickedId = n.id;
			nodeTip(n);
			return;
		}
		open(n);
	}
	function focusNode(id: string) {
		tabStop = id;
		svgEl?.querySelector<SVGGElement>(`[data-node="${CSS.escape(id)}"]`)?.focus();
	}
	function onKey(e: KeyboardEvent, n: SankeyNode<FlowNode>) {
		const ci = colOf(n);
		const col = layout.columns[ci] ?? [];
		const i = col.indexOf(n);
		const cy = (n.y0 + n.y1) / 2;
		const nearest = (c: SankeyNode<FlowNode>[] | undefined) =>
			c?.reduce((best, x) =>
				Math.abs((x.y0 + x.y1) / 2 - cy) < Math.abs((best.y0 + best.y1) / 2 - cy) ? x : best
			);
		let target: SankeyNode<FlowNode> | undefined;
		switch (e.key) {
			case 'Enter':
			case ' ':
				e.preventDefault();
				open(n);
				return;
			case 'Escape':
				pickedId = null;
				tip = null;
				return;
			case 'ArrowDown':
				target = col[i + 1];
				break;
			case 'ArrowUp':
				target = col[i - 1];
				break;
			case 'ArrowRight':
				target = nearest(layout.columns[ci + 1]);
				break;
			case 'ArrowLeft':
				target = nearest(layout.columns[ci - 1]);
				break;
			case 'Home':
				target = col[0];
				break;
			case 'End':
				target = col[col.length - 1];
				break;
			default:
				return;
		}
		e.preventDefault();
		if (target) focusNode(target.id);
	}

	const COL_NAMES = ['Revenue sources', 'Funds', 'Spending areas'];
	const colName = (i: number) => (i === lastCol ? COL_NAMES[2] : COL_NAMES[i]);
</script>

<div class="relative w-full" bind:clientWidth={width}>
	<p id="{uid}-help" class="sr-only">
		Use the arrow keys to move between bars: up and down within a column, left and right between
		revenue sources, funds and spending areas. Press Enter to explore the selected bar. A table of
		every flow follows the chart.
	</p>
	<svg
		bind:this={svgEl}
		{width}
		height={height + HEAD + 8}
		role="group"
		aria-label="Flow of funds from revenue sources through funds to spending areas"
		aria-describedby="{uid}-help"
		class="block overflow-visible font-map"
		onpointerleave={() => {
			hoverId = null;
			clearTip();
		}}
	>
		<!-- column headers, set like the names along an atlas page's top margin -->
		<g aria-hidden="true">
			{#each layout.columns as col, i (i)}
				{@const n = col[0]}
				{#if n && colName(i)}
					<text
						x={M.l + (i === 0 ? n.x1 : i === lastCol ? n.x0 : (n.x0 + n.x1) / 2)}
						y="12"
						text-anchor={i === 0 ? 'end' : i === lastCol ? 'start' : 'middle'}
						font-size="12"
						class="map-label fill-base-content">{colName(i)}</text
					>
				{/if}
			{/each}
			<line x1="0" x2={width} y1="20.5" y2="20.5" class="stroke-base-content" stroke-width="1" />
		</g>
		<g transform="translate({M.l},{HEAD})">
			<g>
				{#each layout.links as l (l.source.id + '>' + l.target.id)}
					{@const on = linked ? linked.has(l) : null}
					<path
						d={linkBand(l)}
						fill={linkColor(l)}
						fill-opacity={on === null ? 0.55 : on ? 0.85 : 0.12}
						stroke={edgeOf(l)}
						stroke-opacity={on === null ? 0.35 : on ? 0.8 : 0.08}
						stroke-width="0.75"
						class="transition-[fill-opacity,stroke-opacity] duration-200"
						role="presentation"
						onpointermove={(e) =>
							pointerTip(e, `${l.source.data.name} to ${l.target.data.name}`, l.value)}
						onpointerleave={clearTip}
					/>
				{/each}
			</g>
			{#each layout.nodes as n (n.id)}
				{@const lab = labels.get(n.id)}
				{@const left = colOf(n) === 0}
				{@const cy = (n.y0 + n.y1) / 2}
				{@const tx = left ? n.x0 - 12 : n.x1 + 12}
				{@const hot = active === n.id}
				<g
					data-node={n.id}
					role="button"
					tabindex={stop === n.id ? 0 : -1}
					aria-label="{n.data.name}: {money(n.value)}, {pct(n.value / total)} of the total"
					aria-busy={busyId === n.id}
					class="node cursor-pointer outline-none"
					class:picked={pickedId === n.id}
					onpointerdown={(e) => (pointerType = e.pointerType)}
					onpointerenter={() => (hoverId = n.id)}
					onpointerleave={() => {
						hoverId = null;
						clearTip();
					}}
					onpointermove={(e) => pointerTip(e, n.data.name, n.value, nodeSub(n))}
					onfocus={() => {
						focusId = n.id;
						tabStop = n.id;
						nodeTip(n);
					}}
					onblur={() => {
						focusId = null;
						if (!hoverId) clearTip();
					}}
					onclick={() => onClick(n)}
					onkeydown={(e) => onKey(e, n)}
				>
					<!-- freeway-yellow selection outline, cased in ink so it holds on any tint -->
					<rect
						class="ring-case"
						x={n.x0 - 5}
						y={n.y0 - 5}
						width={n.x1 - n.x0 + 10}
						height={Math.max(1, n.y1 - n.y0) + 10}
						fill="none"
					/>
					<rect
						class="ring"
						x={n.x0 - 3.5}
						y={n.y0 - 3.5}
						width={n.x1 - n.x0 + 7}
						height={Math.max(1, n.y1 - n.y0) + 7}
						fill="none"
					/>
					<rect
						x={n.x0}
						y={n.y0}
						width={n.x1 - n.x0}
						height={Math.max(1, n.y1 - n.y0)}
						rx="1"
						fill={tintOf(n.id)}
						stroke={casing}
						stroke-width={hot ? 1.5 : 1.25}
						class:animate-pulse={busyId === n.id}
					/>
					{#if lab}
						{@const ly = lab.top + lab.h / 2}
						{#if Math.abs(ly - cy) > 3}
							<path
								d={left
									? `M${n.x0 - 1},${cy} h-4 L${n.x0 - 10},${ly}`
									: `M${n.x1 + 1},${cy} h4 L${n.x1 + 10},${ly}`}
								fill="none"
								class="stroke-base-content/50"
								stroke-width="1"
							/>
						{/if}
						<text
							text-anchor={left ? 'end' : 'start'}
							font-size={FONT}
							font-weight={hot ? 700 : 500}
							paint-order="stroke"
							stroke-width="3"
							stroke-linejoin="round"
							class="fill-base-content stroke-base-100"
						>
							{#if lab.lines.join(' ') !== n.data.name}<title>{n.data.name}</title>{/if}
							{#each lab.lines as line, li (li)}
								<tspan x={tx} y={lab.top + LINE * li + 12}
									>{line}{#if li === lab.lines.length - 1 && lab.inline}
										<tspan class="fill-base-content/75 tabular-nums" font-weight="500"
											>{lab.value}</tspan
										>{/if}</tspan
								>
							{/each}
							{#if !lab.inline}
								<tspan
									x={tx}
									y={lab.top + LINE * lab.lines.length + 12}
									font-weight="500"
									class="fill-base-content/75 tabular-nums">{lab.value}</tspan
								>
							{/if}
						</text>
					{/if}
				</g>
			{/each}
		</g>
	</svg>
	{#if tip}
		<Tooltip x={tip.x} y={tip.y} bound={width}>
			<div class="font-semibold">{tip.html.title}</div>
			<div class="tabular-nums">{money(tip.html.value)}</div>
			{#if tip.html.sub}<div class="text-xs text-base-content/75">{tip.html.sub}</div>{/if}
		</Tooltip>
	{/if}
</div>

<style>
	.node .ring,
	.node .ring-case {
		stroke: transparent;
	}
	.node:focus-visible .ring,
	.node.picked .ring {
		stroke: var(--color-secondary);
		stroke-width: 3;
	}
	.node:focus-visible .ring-case,
	.node.picked .ring-case {
		stroke: var(--color-base-content);
		stroke-width: 1;
	}
	.node.picked:not(:focus-visible) .ring {
		stroke-dasharray: 5 3;
	}
</style>
