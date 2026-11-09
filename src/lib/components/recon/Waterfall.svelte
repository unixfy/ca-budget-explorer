<script lang="ts" module>
	export interface WaterfallStep {
		id: string;
		label: string;
		/** Thousands. For `kind: 'total'` the bar height; otherwise the signed change. */
		value: number;
		kind: 'total' | 'delta';
		color: string;
		/** Optional stacked split for totals (bottom first). */
		parts?: { label: string; value: number; color: string; hatch?: boolean }[];
		hatch?: boolean;
		note?: string;
	}
</script>

<script lang="ts">
	/**
	 * Waterfall / bridge chart (vertical bars, d3 scales, motion entrance), set in the
	 * atlas style: cased tint blocks, hairline grid, map-label axes, yellow focus.
	 */
	import { scaleBand, scaleLinear } from 'd3';
	import { animate, inView } from 'motion';
	import { money, moneyFull } from '#lib/format.ts';
	import { settings } from '#lib/settings.svelte.ts';
	import { CASING, INK } from '#lib/viz/palette.ts';
	import Tooltip from '#lib/components/Tooltip.svelte';

	interface Props {
		steps: WaterfallStep[];
		label: string;
		height?: number;
	}
	let { steps, label, height = 380 }: Props = $props();

	let width = $state(720);
	let svg: SVGSVGElement | undefined = $state();
	let hover: { i: number; x: number; y: number } | null = $state(null);
	const ink = $derived(INK[settings.mode]);
	const casing = $derived(CASING[settings.mode]);
	const narrow = $derived(width < 560);
	const m = $derived({ t: 28, r: 8, b: narrow ? 140 : 62, l: narrow ? 48 : 56 });

	/** Running level → [y0, y1] for each step. */
	const bars = $derived.by(() => {
		let level = 0;
		return steps.map((s) => {
			if (s.kind === 'total') {
				level = s.value;
				return { s, y0: 0, y1: s.value, end: s.value };
			}
			const y0 = level;
			level += s.value;
			return { s, y0: Math.min(y0, level), y1: Math.max(y0, level), end: level };
		});
	});
	const max = $derived(Math.max(1, ...bars.map((b) => b.y1)));
	const x = $derived(
		scaleBand<string>()
			.domain(steps.map((s) => s.id))
			.range([m.l, width - m.r])
			.paddingInner(0.28)
			.paddingOuter(0.1)
	);
	const y = $derived(
		scaleLinear()
			.domain([0, max])
			.nice()
			.range([height - m.b, m.t])
	);
	const ticks = $derived(y.ticks(narrow ? 4 : 6));
	const bw = $derived(x.bandwidth());
	const h = (a: number, b: number) => Math.max(2, Math.abs(y(a) - y(b)));

	// Entrance: bars grow in sequence from the previous level; replays when steps change.
	$effect(() => {
		void steps;
		if (!svg || settings.reducedMotion) return;
		const els = [...svg.querySelectorAll<SVGGElement>('[data-bar]')];
		const vals = [...svg.querySelectorAll<SVGTextElement>('[data-val]')];
		const conns = svg.querySelectorAll<SVGLineElement>('[data-conn]');
		[...els, ...vals, ...conns].forEach((e) => (e.style.opacity = '0'));
		return inView(svg, () => {
			els.forEach((e, i) => {
				animate(
					e,
					{ scaleY: [0, 1], opacity: [0.3, 1] },
					{ duration: 0.55, delay: i * 0.18, ease: [0.22, 1, 0.36, 1] }
				);
				if (vals[i])
					animate(vals[i], { opacity: [0, 1] }, { duration: 0.3, delay: i * 0.18 + 0.35 });
			});
			conns.forEach((c, i) =>
				animate(c, { opacity: [0, 1] }, { duration: 0.3, delay: (i + 1) * 0.18 + 0.3 })
			);
		});
	});

	const wrapLabel = (s: string, max = 14) => {
		const words = s.split(' ');
		const lines: string[] = [];
		let cur = '';
		for (const w of words) {
			if ((cur + ' ' + w).trim().length > max && cur) {
				lines.push(cur);
				cur = w;
			} else cur = (cur + ' ' + w).trim();
		}
		if (cur) lines.push(cur);
		return lines.slice(0, 3);
	};
	function show(i: number, ev?: MouseEvent | FocusEvent) {
		const b = bars[i];
		const cx = (x(b.s.id) ?? 0) + bw / 2;
		if (ev instanceof MouseEvent && svg) {
			const r = svg.getBoundingClientRect();
			hover = { i, x: ev.clientX - r.left, y: ev.clientY - r.top };
		} else hover = { i, x: cx, y: y(b.y1) };
	}
	function onKey(e: KeyboardEvent, i: number) {
		const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -1;
		if (next < 0 || next >= steps.length) return;
		e.preventDefault();
		svg?.querySelectorAll<SVGGElement>('[data-step]')[next]?.focus();
	}
</script>

<div class="relative w-full" bind:clientWidth={width}>
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
				id="wf-hatch"
				width="6"
				height="6"
				patternUnits="userSpaceOnUse"
				patternTransform="rotate(45)"
			>
				<rect width="6" height="6" fill="transparent" />
				<line x1="0" y1="0" x2="0" y2="6" stroke={ink.surface} stroke-width="2" opacity="0.7" />
			</pattern>
		</defs>
		{#each ticks as t (t)}
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
					fill={ink.secondary}>{money(t, { digits: 0 })}</text
				>
			</g>
		{/each}

		<!-- connectors between bar ends -->
		{#each bars.slice(0, -1) as b, i (b.s.id)}
			{@const nx = x(steps[i + 1].id) ?? 0}
			<line
				data-conn
				x1={(x(b.s.id) ?? 0) + bw}
				x2={nx}
				y1={y(b.end)}
				y2={y(b.end)}
				stroke={ink.muted}
				stroke-dasharray="3 3"
			/>
		{/each}

		{#each bars as b, i (b.s.id)}
			{@const bx = x(b.s.id) ?? 0}
			{@const up = b.s.kind === 'total' || b.s.value >= 0}
			<!-- focusable data mark: focus reveals the same tooltip as hover -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
			<g
				data-step
				tabindex="0"
				role="img"
				aria-label="{b.s.label}: {b.s.kind === 'total'
					? ''
					: b.s.value >= 0
						? 'plus '
						: 'minus '}{moneyFull(Math.abs(b.s.value))}"
				class="step cursor-default outline-none"
				onmouseenter={(e) => show(i, e)}
				onmousemove={(e) => show(i, e)}
				onmouseleave={() => (hover = null)}
				onfocus={(e) => show(i, e)}
				onblur={() => (hover = null)}
				onkeydown={(e) => onKey(e, i)}
			>
				<g
					data-bar
					style="transform-box: fill-box; transform-origin: {up ? 'center bottom' : 'center top'}"
				>
					{#if b.s.parts?.length}
						{@const tot = b.s.parts.reduce((a, p) => a + p.value, 0)}
						{#each b.s.parts as p, j (p.label)}
							{@const lo =
								b.s.parts.slice(0, j).reduce((a, q) => a + q.value, 0) * (b.s.value / (tot || 1))}
							{@const hi = lo + p.value * (b.s.value / (tot || 1))}
							<rect
								x={bx}
								y={y(hi)}
								width={bw}
								height={Math.max(1, y(lo) - y(hi))}
								fill={p.color}
								stroke={casing}
								stroke-width="1"
							/>
							{#if p.hatch}
								<rect
									x={bx}
									y={y(hi)}
									width={bw}
									height={Math.max(1, y(lo) - y(hi))}
									fill="url(#wf-hatch)"
								/>
							{/if}
						{/each}
					{:else}
						<rect
							x={bx}
							y={y(b.y1)}
							width={bw}
							height={h(b.y0, b.y1)}
							fill={b.s.color}
							stroke={casing}
							stroke-width="1"
						/>
						{#if b.s.hatch}
							<rect
								x={bx}
								y={y(b.y1)}
								width={bw}
								height={h(b.y0, b.y1)}
								fill="url(#wf-hatch)"
							/>
						{/if}
					{/if}
				</g>
				<!-- larger hit target + focus ring -->
				<rect
					class="hit"
					x={bx - 3}
					y={Math.min(y(b.y1), height - m.b) - 6}
					width={bw + 6}
					height={Math.max(12, h(b.y0, b.y1) + 12)}
					fill="transparent"
					stroke-width="3"
				/>
				<rect
					class="hit-case"
					x={bx - 5}
					y={Math.min(y(b.y1), height - m.b) - 8}
					width={bw + 10}
					height={Math.max(12, h(b.y0, b.y1) + 12) + 4}
					fill="none"
					stroke-width="1"
				/>
				<text
					data-val
					x={bx + bw / 2}
					y={y(b.y1) - 6}
					text-anchor="middle"
					font-size="13"
					font-weight="600"
					class="font-map tabular-nums"
					fill={ink.primary}>{b.s.kind === 'delta' && b.s.value > 0 ? '+' : ''}{money(b.s.value)}</text
				>
				{#if narrow}
					<!-- angled so 12px labels fit under narrow bars -->
					<text
						transform="translate({bx + bw / 2},{height - m.b + 14}) rotate(-55)"
						text-anchor="end"
						font-size="12"
						class="map-label"
						fill={ink.secondary}>{b.s.label}</text
					>
				{:else}
					{#each wrapLabel(b.s.label) as line, li (li)}
						<text
							x={bx + bw / 2}
							y={height - m.b + 16 + li * 14}
							text-anchor="middle"
							font-size="12"
							class="map-label"
							fill={ink.secondary}>{line}</text
						>
					{/each}
				{/if}
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
		{@const b = bars[hover.i]}
		<Tooltip x={hover.x} y={hover.y} bound={width}>
			<div class="font-semibold">{b.s.label}</div>
			<div class="tabular-nums">
				{b.s.kind === 'delta' && b.s.value > 0 ? '+' : ''}{moneyFull(b.s.value)}
			</div>
			{#if b.s.parts}
				<ul class="mt-1 text-xs">
					{#each b.s.parts as p (p.label)}
						<li class="flex items-center gap-1.5">
							<span
								class="inline-block size-2.5 border border-base-content"
								style:background={p.color}
							></span>
							{p.label}: <span class="tabular-nums">{money(p.value)}</span>
						</li>
					{/each}
				</ul>
			{/if}
			{#if b.s.kind === 'delta'}
				<div class="text-xs text-base-content/75">Running balance after: {money(b.end)}</div>
			{/if}
			{#if b.s.note}<div class="mt-1 text-xs text-base-content/75">{b.s.note}</div>{/if}
		</Tooltip>
	{/if}
</div>

<style>
	/* visible keyboard focus on the bar's hit area */
	.step:focus-visible .hit {
		stroke: var(--color-secondary);
	}
	.step:focus-visible .hit-case {
		stroke: var(--color-base-content);
	}
</style>
