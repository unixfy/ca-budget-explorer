<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageProps } from './$types';
	import type { FlowNode } from '#lib/data/schema.ts';
	import { getTree, locate, pathSegments, type TreeName } from '#lib/data/load.ts';
	import { money } from '#lib/format.ts';
	import { routes } from '#lib/paths.ts';
	import Sankey from '#lib/components/Sankey.svelte';
	import SourceChip from '#lib/components/SourceChip.svelte';
	import SourceList from '#lib/components/SourceList.svelte';
	import FlowList from '#lib/components/flows/FlowList.svelte';
	import FlowTable from '#lib/components/flows/FlowTable.svelte';
	import PageTab from '#lib/components/atlas/PageTab.svelte';
	import Legend, { type LegendItem } from '#lib/components/atlas/Legend.svelte';
	import { atlasIndex, type AtlasRef } from '#lib/atlas.ts';
	import { settings } from '#lib/settings.svelte.ts';
	import { colorMap } from '#lib/viz/palette.ts';
	import { ROUTE_TINTS, nodeValues, routeTints } from '#lib/viz/sankey.ts';

	let { data }: PageProps = $props();
	const ds = $derived(data.ds);
	const flows = $derived(data.flows);
	const Y = $derived(ds.meta.years);
	const yearLabel = $derived(Y[flows.year]);

	let showAll = $state(false);
	let pending = $state<FlowNode | null>(null);
	const minShare = 0.004;

	const colOf = (id: string) => flows.nodes.find((n) => n.id === id)?.column;
	const firstCol = $derived(Math.min(...flows.nodes.map((n) => n.column)));
	const lastCol = $derived(Math.max(...flows.nodes.map((n) => n.column)));
	const inflow = $derived.by(() => {
		const m = new Map<string, number>();
		for (const l of flows.links) m.set(l.target, (m.get(l.target) ?? 0) + l.value);
		return m;
	});
	const outOf = (id: string) =>
		flows.links.filter((l) => l.source === id).reduce((a, l) => a + l.value, 0);

	/** Everything entering the chart on the left: revenue, federal money and reserve draws. */
	const total = $derived(
		flows.links.filter((l) => colOf(l.source) === firstCol).reduce((a, l) => a + l.value, 0)
	);
	const firstNodes = $derived(flows.nodes.filter((n) => n.column === firstCol));
	const federalIn = $derived(
		firstNodes.filter((n) => /federal/i.test(n.id)).reduce((a, n) => a + outOf(n.id), 0)
	);
	const reservesIn = $derived(
		firstNodes.filter((n) => /balance|reserve/i.test(n.id)).reduce((a, n) => a + outOf(n.id), 0)
	);
	/** Spending by agencies (the explorer's "state + federal funds" total). */
	const spending = $derived(
		flows.nodes
			.filter((n) => n.column === lastCol && n.kind === 'agency')
			.reduce((a, n) => a + (inflow.get(n.id) ?? 0), 0)
	);
	const stateFunds = $derived.by(() => {
		const t = ds.meta.totals.expendituresByFundType;
		const parts = (['general', 'special', 'bond'] as const).map((f) => t?.[f]?.[flows.year]);
		return parts.some((v) => v == null) ? null : parts.reduce((a, v) => a! + v!, 0);
	});

	const small = $derived.by(() => {
		const grand = flows.nodes
			.filter((n) => n.column === lastCol)
			.reduce((a, n) => a + (inflow.get(n.id) ?? 0), 0);
		return new Set(
			flows.nodes
				.filter((n) => n.column === lastCol && (inflow.get(n.id) ?? 0) < grand * minShare)
				.map((n) => n.id)
		);
	});
	/** Folding only applies when at least two small areas can be combined. */
	const canFold = $derived(small.size >= 2);

	/** Fold tiny nodes of the last column into one "smaller areas" node so labels stay legible. */
	const view = $derived.by(() => {
		if (showAll || !canFold) return flows;
		const other: FlowNode = {
			id: '__other',
			name: `${small.size} smaller areas`,
			column: lastCol,
			kind: 'other'
		};
		const agg = new Map<string, number>();
		const links = [];
		for (const l of flows.links) {
			if (small.has(l.target)) agg.set(l.source, (agg.get(l.source) ?? 0) + l.value);
			else links.push(l);
		}
		for (const [s, v] of agg) links.push({ source: s, target: other.id, value: v });
		return {
			...flows,
			nodes: [...flows.nodes.filter((n) => !small.has(n.id)), other],
			links
		};
	});

	async function select(n: FlowNode) {
		if (n.id === '__other') {
			showAll = true;
			return;
		}
		if (pending) return;
		pending = n;
		try {
			// flows ids usually match tree ids; fall back to matching the last id segment / code
			const order: TreeName[] =
				n.column === 0 || n.id.startsWith('rev') || n.kind === 'fundType'
					? ['revenues', 'expenditures']
					: ['expenditures', 'revenues'];
			for (const tree of order) {
				const root = await getTree(ds.dir, tree).catch(() => null);
				const trail = root && locate(root, n.id, n.kind);
				if (trail) return await goto(routes.tree(ds.fy, ds.pit, tree, pathSegments(trail)));
			}
			await goto(routes.tree(ds.fy, ds.pit, order[0]));
		} finally {
			pending = null;
		}
	}

	// ------------------------------------------------------------------ atlas tints and pages
	const expRoot = $derived(data.expenditures);
	/**
	 * Spending areas keep the tint their agency has on the Key Map. The flow data can merge
	 * agencies the spending tree splits (Education = K-12 + Higher Education); those take
	 * the tint of their largest member.
	 */
	const agencyTints = $derived.by(() => {
		const kids = expRoot?.children ?? [];
		if (!kids.length) return undefined;
		const cm = colorMap(
			kids.map((c) => ({ id: c.id, key: c.amounts.by ?? 0 })),
			settings.mode
		);
		const prefix = (id: string) => id.split('/').pop()?.slice(0, 2);
		const out = new Map<string, string>();
		for (const n of flows.nodes) {
			if (n.kind !== 'agency') continue;
			const hit = cm.get(n.id);
			const member = hit
				? undefined
				: kids
						.filter((c) => prefix(c.id) === prefix(n.id))
						.sort((a, b) => (b.amounts.by ?? 0) - (a.amounts.by ?? 0))[0];
			const tint = hit ?? (member && cm.get(member.id));
			if (tint) out.set(n.id, tint);
		}
		return out;
	});
	const pages = $derived(expRoot ? atlasIndex(expRoot, 'expenditures') : null);
	/** An agency's own atlas page ("p. 112"), for the index lists. */
	const refOf = (id: string): AtlasRef | undefined => {
		const own = pages?.ref(id)?.own;
		return own ? { page: own } : undefined;
	};

	const tints = $derived(
		routeTints(flows.nodes, nodeValues(flows.links), settings.mode, agencyTints)
	);
	const legend = $derived.by((): LegendItem[] => {
		const t = ROUTE_TINTS[settings.mode];
		const vals = nodeValues(flows.links);
		const mid = flows.nodes
			.filter((n) => n.column !== firstCol && n.column !== lastCol)
			.sort((a, b) => (vals.get(b.id) ?? 0) - (vals.get(a.id) ?? 0));
		const biggest = flows.nodes
			.filter((n) => n.column === lastCol && n.kind === 'agency')
			.sort((a, b) => (vals.get(b.id) ?? 0) - (vals.get(a.id) ?? 0))[0];
		return [
			{ label: 'Revenue sources', color: t.water, note: 'Taxes, fees, federal money' },
			...mid.map((n) => ({ label: n.name, color: tints.get(n.id) })),
			{
				label: 'Spending areas',
				color: (biggest && tints.get(biggest.id)) ?? t.neutral,
				note: 'Each agency keeps its Key Map tint'
			},
			{ label: 'Fund balances and reserves', color: t.park },
			{ label: 'Transfers between funds', color: t.neutral },
			{
				label: 'Route',
				kind: 'line',
				color: t.roads[0],
				note: 'Width is dollars; colour is the fund it runs through'
			},
			{
				label: 'Selected',
				kind: 'line',
				color: settings.mode === 'light' ? '#f2c230' : '#f2c94c'
			}
		];
	});

	/** Plain explanations for budget terms that appear in the chart's labels. */
	const GLOSSARY = [
		{
			test: /realignment/i,
			term: 'Realignment',
			def: 'a share of the sales tax that laws passed in 1991 and 2011 set aside for counties, to pay for health, social-service and public-safety programs the State handed over to them.'
		},
		{
			test: /SAL Excludable/i,
			term: 'SAL Excludable',
			def: 'revenue that does not count toward the State Appropriations Limit, the constitutional cap on how fast state spending can grow.'
		},
		{
			test: /fund balances|reserves/i,
			term: 'Fund balances and reserves',
			def: 'money left over from earlier years. Drawing on it lets a fund spend more than it takes in this year.'
		}
	];
	const terms = $derived(GLOSSARY.filter((g) => flows.nodes.some((n) => g.test.test(n.name))));
</script>

<svelte:head><title>Follow the money · {yearLabel} · California Budget Explorer</title></svelte:head
>

<PageTab page="ii" label="Route map" />

<div class="mt-4 grid gap-x-12 gap-y-6 lg:grid-cols-[minmax(0,68ch)_17rem] lg:items-start">
	<header>
		<h1 class="text-4xl leading-[1.05] font-bold tracking-tight text-balance md:text-5xl">
			Follow the money
		</h1>
		<p class="mt-3 text-lg leading-snug text-balance">
			Where <strong class="tabular-nums">{money(total)}</strong> in revenue, federal money and
			reserves comes from, which funds it goes through, and what it pays for in {yearLabel}.
		</p>
		<div class="mt-1">
			<SourceChip sources={flows.sources} fy={ds.fy} pit={ds.pit} product="flows" />
		</div>
		<p class="mt-4 leading-relaxed">
			That {money(total)} counts
			{#if federalIn}{money(federalIn)} of federal funds{/if}{#if federalIn && reservesIn}
				and{/if}
			{#if reservesIn}{money(reservesIn)} drawn from reserves{/if}
			alongside state taxes and fees. Agencies spend
			<strong class="tabular-nums">{money(spending)}</strong> of it (state and federal funds){#if stateFunds != null},
				of which {money(stateFunds)} is state funds, the Department of Finance’s headline figure{/if};
			the other {money(total - spending)} moves between funds or into reserves.
			<a class="link text-primary" href="{routes.reconciliation(ds.fy, ds.pit)}#totals"
				>How these totals fit together</a
			>
		</p>
		<p class="mt-2 text-sm leading-relaxed text-base-content/80">
			Shows {yearLabel} amounts from every type of fund. The year and fund settings at the top of the
			page don’t change this chart.
		</p>
	</header>
	<Legend title="Legend" items={legend} />
</div>

<div class="mt-8 mb-2 flex min-h-6 flex-wrap items-center justify-between gap-x-6 gap-y-2">
	<p class="sr-only text-sm text-base-content/80 sm:not-sr-only">
		Hover over, tap or tab to any bar to trace its flows and see its amount. Click it, tap it again
		or press Enter to explore it.
	</p>
	{#if canFold}
		<label class="label hidden cursor-pointer gap-2 text-sm text-base-content sm:flex">
			<input type="checkbox" class="toggle toggle-sm" bind:checked={showAll} />
			Show every spending area separately
		</label>
	{/if}
</div>
<p role="status" class="min-h-5 text-sm">
	{#if pending}
		<span class="loading loading-xs loading-spinner align-middle" aria-hidden="true"></span>
		Opening {pending.name}…
	{/if}
</p>

<div class="hidden pt-2 pb-4 sm:block" class:cursor-progress={pending} aria-busy={!!pending}>
	<Sankey
		flows={view}
		height={Math.max(520, Math.min(900, view.nodes.length * 26))}
		onselect={select}
		busyId={pending?.id}
		{agencyTints}
	/>
</div>
<div class="sm:hidden" aria-busy={!!pending}>
	<FlowList {flows} onselect={select} busyId={pending?.id} {agencyTints} {refOf} />
</div>

<div class="mt-8 max-w-[68ch]">
	<p class="text-sm leading-relaxed text-base-content/80">
		Fund totals may not balance exactly because of transfers, reserves and reimbursements.
	</p>
	{#if terms.length}
		<section class="atlas-inset mt-4 p-4" aria-labelledby="flow-terms">
			<h2 id="flow-terms" class="map-label text-xs">Terms on this map</h2>
			<dl class="mt-2 space-y-2 text-sm leading-relaxed">
				{#each terms as t (t.term)}
					<div>
						<dt class="inline font-semibold">{t.term}:</dt>
						<dd class="inline">{t.def}</dd>
					</div>
				{/each}
			</dl>
		</section>
	{/if}
</div>

<FlowTable
	{flows}
	caption="Every flow in {yearLabel}, from revenue source to fund and from fund to spending area"
/>

<div class="mt-8"><SourceList sources={flows.sources} /></div>
