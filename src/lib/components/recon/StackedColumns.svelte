<script lang="ts" module>
	export interface StackSeries {
		id: string;
		label: string;
		color: string;
		/** Hatched fill (secondary encoding, e.g. "not counted in the official total"). */
		hatch?: boolean;
	}
	export interface StackColumn {
		key: string;
		label: string;
		/** Thousands, by series id. Negative values are not supported (ignored). */
		values: Record<string, number | null | undefined>;
		/** Optional caption printed above the column (defaults to the column total). */
		caption?: string;
	}
</script>

<script lang="ts">
	/**
	 * Stacked columns with a legend, hover/focus tooltips and a motion entrance, in the
	 * atlas style: cased tint blocks, hairline grid, map-label axes, yellow focus.
	 */
	import { scaleBand, scaleLinear } from 'd3';
	import { animate, inView } from 'motion';
	import { money, moneyFull } from '#lib/format.ts';
	import { settings } from '#lib/settings.svelte.ts';
	import { CASING, INK } from '#lib/viz/palette.ts';
	import Tooltip from '#lib/components/Tooltip.svelte';

	interface Props {
		series: StackSeries[];
		columns: StackColumn[];
		label: string;
		height?: number;
		/** Max column width in px. */
		maxBand?: number;
	}
	let { series, columns, label, height = 300, maxBand = 120 }: Props = $props();

	let width = $state(480);
	let svg: SVGSVGElement | undefined = $state();
	let hover: { c: number; x: number; y: number } | null = $state(null);
	const ink = $derived(INK[settings.mode]);
	const casing = $derived(CASING[settings.mode]);
	const m = { t: 26, r: 8, b: 36, l: 52 };
	const uid = $props.id();
	const pid = `hatch-${uid}`;

	const stacks = $derived(
		columns.map((c) => {
			let acc = 0;
			const segs = series
				.map((s) => {
					const v = Math.max(0, c.values[s.id] ?? 0);
					const seg = { s, v, y0: acc, y1: acc + v };
					acc += v;
					return seg;
				})
				.filter((g) => g.v > 0);
			return { c, segs, total: acc };
		})
	);
	const max = $derived(Math.max(1, ...stacks.map((s) => s.total)));
	const x = $derived(
		scaleBand<string>()
			.domain(columns.map((c) => c.key))
			.range([m.l, width - m.r])
			.paddingInner(0.35)
			.paddingOuter(0.2)
	);
	const bw = $derived(Math.min(maxBand, x.bandwidth()));
	const off = $derived((x.bandwidth() - bw) / 2);
	const y = $derived(
		scaleLinear()
			.domain([0, max * 1.08])
			.nice()
			.range([height - m.b, m.t])
	);
	const shown = $derived(
		series.filter((s) => stacks.some((st) => st.segs.some((g) => g.s.id === s.id)))
	);

	$effect(() => {
		void columns;
		if (!svg || settings.reducedMotion) return;
		const cols = [...svg.querySelectorAll<SVGGElement>('[data-col]')];
		cols.forEach((e) => (e.style.opacity = '0'));
		return inView(svg, () => {
			cols.forEach((e, i) =>
				animate(
					e,
					{ scaleY: [0, 1], opacity: [0, 1] },
					{ duration: 0.7, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }
				)
			);
		});
	});

	function show(i: number, ev: MouseEvent | FocusEvent) {
		const st = stacks[i];
		if (ev instanceof MouseEvent && svg) {
			const r = svg.getBoundingClientRect();
			hover = { c: i, x: ev.clientX - r.left, y: ev.clientY - r.top };
		} else hover = { c: i, x: (x(st.c.key) ?? 0) + off + bw / 2, y: y(st.total) };
	}
</script>

<div class="w-full">
	<ul class="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Legend">
		{#each shown as s (s.id)}
			<li class="flex items-center gap-1.5">
				<svg class="size-3" aria-hidden="true" viewBox="0 0 12 12">
					<rect x="0.5" y="0.5" width="11" height="11" fill={s.color} />
					{#if s.hatch}<rect x="0.5" y="0.5" width="11" height="11" fill="url(#{pid})" />{/if}
					<rect x="0.5" y="0.5" width="11" height="11" fill="none" stroke={casing} />
				</svg>
				<span class="text-base-content/85">{s.label}</span>
			</li>
		{/each}
	</ul>
	<div class="relative" bind:clientWidth={width}>
		<svg
			bind:this={svg}
			{width}
			{height}
			role="group"
			aria-label={label}
			class="block overflow-visible"
		>
			<defs>
				<pattern
					id={pid}
					width="6"
					height="6"
					patternUnits="userSpaceOnUse"
					patternTransform="rotate(45)"
				>
					<line x1="0" y1="0" x2="0" y2="6" stroke={ink.surface} stroke-width="2" opacity="0.75" />
				</pattern>
			</defs>
			{#each y.ticks(4) as t (t)}
				<g transform="translate(0,{y(t)})">
					<line
						x1={m.l}
						x2={width - m.r}
						stroke={ink.grid}
						stroke-width="1"
						shape-rendering="crispEdges"
					/>
					<text
						x={m.l - 6}
						dy="0.32em"
						text-anchor="end"
						font-size="12"
						class="font-map tabular-nums"
						fill={ink.secondary}
						>{money(t, { digits: t && t < 1e6 ? 1 : 0 })}</text
					>
				</g>
			{/each}
			{#each stacks as st, i (st.c.key)}
				{@const cx = (x(st.c.key) ?? 0) + off}
				<!-- focusable data mark: focus reveals the same tooltip as hover -->
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<g
					tabindex="0"
					role="img"
					aria-label="{st.c.label}: {st.segs.map((g) => `${g.s.label} ${money(g.v)}`).join(', ') ||
						'none'}; total {money(st.total)}"
					class="col outline-none"
					onmouseenter={(e) => show(i, e)}
					onmousemove={(e) => show(i, e)}
					onmouseleave={() => (hover = null)}
					onfocus={(e) => show(i, e)}
					onblur={() => (hover = null)}
				>
					<g data-col style="transform-box: fill-box; transform-origin: center bottom">
						{#each st.segs as g, j (g.s.id)}
							{@const hh = Math.max(1, y(g.y0) - y(g.y1))}
							<rect x={cx} y={y(g.y1)} width={bw} height={hh} fill={g.s.color} />
							{#if g.s.hatch}
								<rect x={cx} y={y(g.y1)} width={bw} height={hh} fill="url(#{pid})" />
							{/if}
							<rect
								x={cx}
								y={y(g.y1)}
								width={bw}
								height={hh}
								fill="none"
								stroke={casing}
								stroke-width="1"
							/>
						{/each}
					</g>
					<rect
						class="hit"
						x={cx - 4}
						y={y(st.total) - 4}
						width={bw + 8}
						height={Math.max(10, y(0) - y(st.total) + 8)}
						fill="transparent"
						stroke-width="3"
					/>
					<rect
						class="hit-case"
						x={cx - 6}
						y={y(st.total) - 6}
						width={bw + 12}
						height={Math.max(10, y(0) - y(st.total) + 8) + 4}
						fill="none"
						stroke-width="1"
					/>
					<text
						x={cx + bw / 2}
						y={y(st.total) - 7}
						text-anchor="middle"
						font-size="13"
						font-weight="600"
						class="font-map tabular-nums"
						fill={ink.primary}>{st.c.caption ?? money(st.total)}</text
					>
					<text
						x={cx + bw / 2}
						y={height - m.b + 16}
						text-anchor="middle"
						font-size="12"
						class="map-label"
						fill={ink.secondary}>{st.c.label}</text
					>
				</g>
			{/each}
			<line
				x1={m.l}
				x2={width - m.r}
				y1={y(0)}
				y2={y(0)}
				stroke={ink.primary}
				shape-rendering="crispEdges"
			/>
		</svg>
		{#if hover}
			{@const st = stacks[hover.c]}
			<Tooltip x={hover.x} y={hover.y} bound={width}>
				<div class="font-semibold">{st.c.label}</div>
				<ul class="mt-1 space-y-0.5 text-xs">
					{#each [...st.segs].reverse() as g (g.s.id)}
						<li class="flex items-center gap-1.5">
							<span
								class="inline-block size-2.5 border border-base-content"
								style:background={g.s.color}
							></span>
							<span class="flex-1">{g.s.label}</span>
							<span class="tabular-nums" title={moneyFull(g.v)}>{money(g.v)}</span>
						</li>
					{/each}
				</ul>
				<div class="mt-1 border-t border-base-300 pt-1 text-xs font-semibold tabular-nums">
					Total {money(st.total)}
				</div>
			</Tooltip>
		{/if}
	</div>
</div>

<style>
	/* visible keyboard focus on the column's hit area */
	.col:focus-visible .hit {
		stroke: var(--color-secondary);
	}
	.col:focus-visible .hit-case {
		stroke: var(--color-base-content);
	}
</style>
