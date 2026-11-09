<script lang="ts">
	/**
	 * Generic drill-down explorer for any BudgetNode tree: breadcrumbs, headline numbers,
	 * synchronized 3D city / treemap / sunburst, and a sortable line-item table.
	 * Navigation is delegated to the parent via `navigate(trail)` (URL-driven or local).
	 */
	import { tick, type Snippet } from 'svelte';
	import { page } from '$app/state';
	import type { BudgetNode } from '#lib/data/schema.ts';
	import {
		KIND_LABEL,
		money,
		moneyFull,
		pct,
		valueOf,
		YEAR_LABEL,
		FUND_TYPE_LABEL,
		fundFilterLabel,
		tripleOf
	} from '#lib/format.ts';
	import { settings } from '#lib/settings.svelte.ts';
	import { colorMap } from '#lib/viz/palette.ts';
	import Breadcrumbs from './Breadcrumbs.svelte';
	import Treemap from './Treemap.svelte';
	import Sunburst from './Sunburst.svelte';
	import BudgetCity from './BudgetCity.svelte';
	import NodeTable from './NodeTable.svelte';
	import DeltaBadge from './DeltaBadge.svelte';
	import FundMix from './FundMix.svelte';
	import SourceList from './SourceList.svelte';
	import TripleBars from './TripleBars.svelte';
	import SourceChip from './SourceChip.svelte';
	import { KIND_HELP, safeStorage } from './tree/a11y.ts';
	import PageTab from './atlas/PageTab.svelte';
	import MarginGrid from './atlas/MarginGrid.svelte';
	import { atlasIndex, type AtlasRef } from '#lib/atlas.ts';
	import type { TreeName } from '#lib/data/load.ts';

	type View = 'city' | 'treemap' | 'sunburst';
	interface Props {
		trail: BudgetNode[];
		years: { py: string; cy: string; by: string };
		navigate: (trail: BudgetNode[]) => void;
		crumbHref?: (i: number) => string;
		prefixCrumbs?: { label: string; href: string }[];
		views?: View[];
		hrefFor?: (n: BudgetNode) => string | null;
		/** extra content in the side panel (e.g. link to department detail) */
		aside?: Snippet<[BudgetNode]>;
		fallbackSources?: BudgetNode['sources'];
		storageKey?: string;
		/** compact: embedded under another page's h1, so headings start at h2 */
		compact?: boolean;
		/** data product for the source chip's "How we built this" link */
		product?: string;
		/** dataset, for the source chip (defaults to the current route's params) */
		fy?: string;
		pit?: string;
		/** which budget tree this is, for atlas page numbers and grid squares */
		tree?: TreeName;
		/** name of the tree's Key Map page, e.g. "Spending" */
		treeLabel?: string;
	}
	let {
		trail,
		years,
		navigate,
		crumbHref,
		prefixCrumbs = [],
		views = ['city', 'treemap', 'sunburst'],
		hrefFor,
		aside,
		fallbackSources = [],
		storageKey = 'cabx:view',
		compact = false,
		product,
		fy = page.params.fy ?? '',
		pit = page.params.pit ?? '',
		tree,
		treeLabel = 'Key Map'
	}: Props = $props();
	const uid = $props.id();

	const node = $derived(trail[trail.length - 1]);
	const parent = $derived(trail.length > 1 ? trail[trail.length - 2] : null);

	let view = $state<View>('treemap');
	$effect.pre(() => {
		const saved = safeStorage.get(storageKey) as View | null;
		view =
			saved && views.includes(saved) ? saved : views.includes('treemap') ? 'treemap' : views[0];
	});
	function setView(v: View) {
		view = v;
		safeStorage.set(storageKey, v);
	}
	const shownViews = $derived(views);
	const tabId = (v: View) => `${uid}-tab-${v}`;
	const panelId = `${uid}-panel`;
	const tableId = `${uid}-table`;
	/** WAI-ARIA tabs: arrow keys move and activate, Home/End jump to the ends */
	function tabKey(e: KeyboardEvent) {
		const i = shownViews.indexOf(view);
		let j: number | null = null;
		if (e.key === 'ArrowRight') j = (i + 1) % shownViews.length;
		else if (e.key === 'ArrowLeft') j = (i - 1 + shownViews.length) % shownViews.length;
		else if (e.key === 'Home') j = 0;
		else if (e.key === 'End') j = shownViews.length - 1;
		if (j == null) return;
		e.preventDefault();
		setView(shownViews[j]);
		document.getElementById(tabId(shownViews[j]))?.focus();
	}

	// Keep keyboard users in place across a drill: after the node changes, focus the
	// chart again (if they were in it) or the heading, instead of dropping to <body>.
	let heading: HTMLElement | undefined = $state();
	let vizBox: HTMLElement | undefined = $state();
	let kbFrom: 'viz' | 'other' | null = null;
	let kbAt = 0;
	function noteKey(e: KeyboardEvent) {
		if (!['Enter', ' ', 'Escape', 'Backspace'].includes(e.key)) return;
		kbFrom = vizBox?.contains(e.target as Node) ? 'viz' : 'other';
		kbAt = performance.now();
	}
	$effect(() => {
		void node;
		if (!kbFrom || performance.now() - kbAt > 3000) return;
		const from = kbFrom;
		kbFrom = null;
		tick().then(() => {
			const a = document.activeElement;
			if (a && a !== document.body && a.isConnected) return;
			const target =
				from === 'viz' ? vizBox?.querySelector<HTMLElement>('[role="button"][tabindex="0"]') : null;
			(target ?? heading)?.focus();
		});
	});

	const colors = $derived(
		colorMap(
			(node.children ?? []).map((c) => ({ id: c.id, key: c.amounts.by ?? c.amounts.cy ?? 0 })),
			settings.mode
		)
	);
	const value = $derived(valueOf(node, settings.year, settings.fund));
	const parentValue = $derived(parent ? valueOf(parent, settings.year, settings.fund) : null);
	const hasKids = $derived(!!node.children?.length);
	const fundUnknown = $derived(settings.fund !== 'all' && !node.byFundType);

	const select = (chain: BudgetNode[]) => navigate([...trail, ...chain]);
	const up = $derived(parent ? () => navigate(trail.slice(0, -1)) : undefined);

	const sources = $derived(
		[...trail]
			.reverse()
			.map((n) => n.sources ?? [])
			.find((s) => s.length) ??
			fallbackSources ??
			[]
	);
	/** chart height follows the available width, so phones don't get a tall, thin chart */
	let vizW = $state(800);
	const vizH = $derived(
		Math.round(Math.min(compact ? 380 : 480, Math.max(260, vizW * (compact ? 0.75 : 0.7))))
	);
	/** children with negative amounts can't be drawn as areas; say so instead of hiding them */
	const negatives = $derived(
		(node.children ?? [])
			.map((c) => ({ n: c, v: valueOf(c, settings.year, settings.fund) ?? 0 }))
			.filter((r) => r.v < 0)
	);
	const negTotal = $derived(negatives.reduce((a, r) => a + r.v, 0));
	const kindHelp = $derived(KIND_HELP[node.kind]);
	const EXCLUDED_LABEL: Record<string, string> = {
		reimbursement: 'Reimbursements',
		nongovernmental: 'Nongovernmental cost funds',
		interimLoan: 'Loan-financed interim payments'
	};
	const excludedRows = $derived(
		Object.entries(node.excluded ?? {})
			.map(([t, v]) => ({ t, v: v?.[settings.year] ?? null }))
			.filter((r) => r.v)
	);
	const grossBasis = $derived(trail.some((n) => n.extra?.basis === 'gross'));
	// atlas: page numbers and grid squares (only for full trees, not department sub-trees)
	const index = $derived(tree && !compact ? atlasIndex(trail[0], tree) : null);
	const here = $derived(index && trail.length > 1 ? index.ref(node.id) : undefined);
	const pageNo = $derived(here ? (here.own ?? here.page) : undefined);
	const refOfChain = (chain: BudgetNode[]): AtlasRef | undefined =>
		index ? index.ref(chain[chain.length - 1].id) : undefined;
	const refOfNode = (n: BudgetNode): AtlasRef | undefined => (index ? index.ref(n.id) : undefined);
	const pageOf = (n: BudgetNode, i: number) => {
		if (!index || i === 0) return undefined;
		return index.ref(n.id)?.own;
	};
	const viewLabel: Record<View, string> = {
		city: 'Aerial view',
		treemap: 'Treemap',
		sunburst: 'Sunburst'
	};
</script>

<section class="space-y-6" onkeydowncapture={noteKey}>
	<Breadcrumbs
		{trail}
		hrefFor={crumbHref}
		onpick={crumbHref ? undefined : (i) => navigate(trail.slice(0, i + 1))}
		prefix={prefixCrumbs}
		label={compact ? 'Path within this department' : 'Breadcrumb'}
		pageOf={index ? pageOf : undefined}
		rootLabel={index ? `${treeLabel} · Key Map` : undefined}
	/>

	<header class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
		<div class="min-w-0">
			{#if !compact}
				<PageTab page={pageNo} label={trail.length > 1 ? node.name : treeLabel} class="mb-4" />
			{/if}
			<svelte:element
				this={compact ? 'h2' : 'h1'}
				bind:this={heading}
				tabindex="-1"
				class="leading-tight font-bold tracking-tight text-balance outline-none {compact
					? 'text-2xl md:text-3xl'
					: 'text-3xl md:text-5xl'}"
				title={node.code ? `${KIND_LABEL[node.kind]} code ${node.code}` : undefined}
			>
				{node.name}
			</svelte:element>
			{#if parent && parent.kind !== 'root'}
				<p class="mt-1 text-sm text-base-content/75" title={kindHelp}>
					{KIND_LABEL[node.kind]} in {parent.name}
				</p>
			{/if}
			<div class="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
				<span
					class="text-4xl font-semibold tracking-tight tabular-nums md:text-5xl"
					title={moneyFull(value)}
				>
					{money(value)}
				</span>
				<span class="text-sm text-base-content/80">
					{years[settings.year]} · {fundFilterLabel(settings.fund)}
				</span>
				<DeltaBadge from={valueOf(node, settings.compare, settings.fund)} to={value} mode="both" />
				{#if parentValue}
					<span class="text-sm text-base-content/80"
						>{pct((value ?? 0) / parentValue)} of {parent?.name}</span
					>
				{/if}
			</div>
			{#if hasKids}<div class="mt-2"><SourceChip {sources} {fy} {pit} {product} /></div>{/if}
		</div>
		{#if hasKids && views.length > 1}
			<div role="tablist" aria-label="Chart type" class="flex border border-base-content">
				{#each views as v (v)}
					<button
						role="tab"
						id={tabId(v)}
						class="map-label min-h-11 px-3 text-sm {view === v
							? 'bg-base-content text-base-100'
							: 'hover:bg-base-200'}"
						aria-selected={view === v}
						aria-controls={panelId}
						tabindex={view === v ? 0 : -1}
						onclick={() => setView(v)}
						onkeydown={tabKey}
					>
						{viewLabel[v]}
					</button>
				{/each}
			</div>
		{/if}
	</header>

	{#if grossBasis}
		<p role="note" class="max-w-prose border-t border-base-300 pt-3 text-sm">
			Category and object totals are published only on a gross basis, so they include spending
			funded by reimbursements and nongovernmental cost funds and can exceed the department’s
			spending total.
		</p>
	{/if}

	{#if fundUnknown}
		<p role="status" class="max-w-prose bg-secondary/25 px-3 py-2 text-sm">
			No fund-type breakdown is published for this level, so {FUND_TYPE_LABEL[
				settings.fund as 'general'
			]} amounts are unavailable here. Switch to “State + federal funds” to see totals.
		</p>
	{/if}

	<div class="grid gap-x-10 gap-y-8 {compact ? '' : 'lg:grid-cols-[minmax(0,1fr)_19rem]'}">
		<div class="min-w-0 space-y-6">
			{#if hasKids}
				<div
					bind:this={vizBox}
					bind:clientWidth={vizW}
					id={panelId}
					role={views.length > 1 ? 'tabpanel' : undefined}
					aria-labelledby={views.length > 1 ? tabId(view) : undefined}
				>
					{#if view === 'city'}
						<div class="border border-base-content">
							<BudgetCity
								{node}
								{colors}
								height={vizH}
								onselect={select}
								listHref="#{tableId}"
								listLabel="the table below"
							>
								{#snippet fallback()}
									<Treemap {node} {colors} height={vizH} onselect={select} onup={up} />
								{/snippet}
							</BudgetCity>
						</div>
						<p class="pt-2 text-xs text-base-content/80">
							The same page seen from above. Click a building to open it, or press “Explore the
							city” to drag and zoom. Height and footprint show dollars.
						</p>
					{:else if view === 'sunburst'}
						<Sunburst
							{node}
							{colors}
							size={vizH}
							onselect={select}
							onup={up}
							upLabel={parent?.name}
						/>
						<p class="pt-2 text-xs text-base-content/80">
							Select a ring segment to see what’s inside; the centre goes back up. Keyboard: arrow
							keys move between segments, Enter opens, Esc goes up.
						</p>
					{:else}
						<MarginGrid>
							<Treemap
								{node}
								{colors}
								height={vizH}
								onselect={select}
								onup={up}
								refOf={index ? refOfChain : undefined}
							/>
						</MarginGrid>
						<p class="pt-2 text-xs text-base-content/80 sm:pl-5">
							Area shows dollars ({YEAR_LABEL[settings.year].toLowerCase()}). Select a block to see
							what’s inside; on a touchscreen, tap once for details and again to open. Keyboard:
							arrow keys move between blocks, Enter opens, Esc goes up.
						</p>
					{/if}
					{#if negatives.length}
						<p class="pt-1 text-xs text-base-content/80 sm:pl-5" role="note">
							{#if negatives.length === 1}
								{negatives[0].n.name} ({money(negTotal)}) is a negative amount, so it’s listed in
								the table but not drawn in the chart.
							{:else}
								{negatives.length} items with negative amounts (together {money(negTotal)}) are
								listed in the table but not drawn in the chart.
							{/if}
						</p>
					{/if}
					<p class="pt-1 text-xs sm:pl-5">
						<a class="text-primary" href="#{tableId}">Every item and amount is in the table below</a
						>
					</p>
				</div>
				<NodeTable
					{node}
					{colors}
					{years}
					onselect={select}
					{hrefFor}
					caption="Line items of {node.name}"
					id={tableId}
					refOf={index ? refOfNode : undefined}
				/>
			{:else}
				<div class="atlas-inset p-5">
					<p class="max-w-prose text-sm">
						This is the most detailed level the budget publishes for {node.name}; there is no
						further breakdown. The bars show its amount in each of the three budget years.
					</p>
					<div class="mt-2 mb-4"><SourceChip {sources} {fy} {pit} {product} /></div>
					<TripleBars amounts={tripleOf(node, settings.fund)} {years} />
				</div>
			{/if}
		</div>

		<aside class="space-y-6 text-sm" aria-label="On this page">
			{#if node.byFundType && Object.values(node.byFundType).some((t) => (t?.[settings.year] ?? 0) > 0)}
				<section class="atlas-inset p-3">
					<h2 class="map-label mb-2 text-xs">By fund type</h2>
					<FundMix byFundType={node.byFundType} />
				</section>
			{/if}
			{#if excludedRows.length || node.excludedChildren?.length}
				<section class="border-t border-base-content pt-3">
					<h2 class="map-label mb-1 text-xs">Not counted as spending</h2>
					<p class="mb-2 text-xs leading-relaxed text-base-content/80">
						Reimbursements are payments from other departments, already counted where the money
						comes from. Nongovernmental cost funds are money the state holds or passes through (e.g.
						pension trust funds, university own funds, local property tax). ebudget’s “all funds”
						total includes them; totals here don’t.
					</p>
					{#each excludedRows as r (r.t)}
						<div class="flex items-baseline gap-2 tabular-nums">
							<span>{EXCLUDED_LABEL[r.t] ?? r.t}</span>
							<span class="dot-leader" aria-hidden="true"></span>
							<span class="font-semibold" title={moneyFull(r.v)}>{money(r.v)}</span>
						</div>
					{/each}
					{#if node.excludedChildren?.length}
						<ul class="mt-2 space-y-1">
							{#each node.excludedChildren as c (c.id)}
								<li>
									<button
										type="button"
										class="flex w-full items-baseline gap-2 text-left text-primary hover:underline"
										onclick={() => navigate([...trail, c])}
									>
										<span class="truncate">{c.name}</span>
										<span class="dot-leader" aria-hidden="true"></span>
										<span class="text-base-content/80 tabular-nums"
											>{money(c.amounts[settings.year])}</span
										>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{/if}
			{#if aside}{@render aside(node)}{/if}
			{#if node.description}
				<section class="border-t border-base-content pt-3 leading-relaxed">
					<h2 class="map-label mb-1 text-xs">About</h2>
					<p>{node.description}</p>
				</section>
			{/if}
			{#if node.positions}
				<section class="border-t border-base-content pt-3">
					<h2 class="map-label mb-1 text-xs">Positions</h2>
					<p class="text-xl font-semibold tabular-nums">
						{node.positions[settings.year]?.toLocaleString('en-US', { maximumFractionDigits: 1 }) ??
							'—'}
					</p>
				</section>
			{/if}
			<SourceList {sources} />
		</aside>
	</div>
</section>
