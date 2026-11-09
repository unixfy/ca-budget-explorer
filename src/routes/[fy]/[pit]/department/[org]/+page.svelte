<script lang="ts">
	import type { PageProps } from './$types';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { BudgetNode } from '#lib/data/schema.ts';
	import { findNodeById, pathSegments, segmentOf } from '#lib/data/load.ts';
	import { money, moneyFull, num, KIND_LABEL, fundFilterLabel } from '#lib/format.ts';
	import { settings } from '#lib/settings.svelte.ts';
	import { routes } from '#lib/paths.ts';
	import TreeExplorer from '#lib/components/TreeExplorer.svelte';
	import DeltaBadge from '#lib/components/DeltaBadge.svelte';
	import FundMix from '#lib/components/FundMix.svelte';
	import SourceList from '#lib/components/SourceList.svelte';
	import Breadcrumbs from '#lib/components/Breadcrumbs.svelte';
	import SourceChip from '#lib/components/SourceChip.svelte';
	import PageTab from '#lib/components/atlas/PageTab.svelte';
	import { atlasIndex } from '#lib/atlas.ts';

	let { data }: PageProps = $props();
	const ds = $derived(data.ds);
	const d = $derived(data.detail);
	const Y = $derived(ds.meta.years);

	type Tab = 'programs' | 'funding' | 'categories' | 'projects' | 'tables';
	const tabs = $derived(
		(
			[
				['programs', 'Programs', d.programs],
				['funding', 'Funding & items', d.funding],
				['categories', 'Categories', d.categories],
				['projects', 'Projects', d.projects]
			] as [Tab, string, BudgetNode | undefined][]
		).filter(([, , t]) => t && (t.children?.length ?? 0) > 0) as [Tab, string, BudgetNode][]
	);
	// Default view per department (honoring ?focus=<node id> from links elsewhere). Once the
	// visitor picks a tab or drills in, the state lives in the URL (?tab=…&path=a/b) so
	// Back, refresh and shared links all return to the same place.
	const initial = $derived.by(() => {
		const next: Partial<Record<Tab, BudgetNode[]>> = {};
		for (const [k, , t] of tabs) next[k] = [t];
		let nextTab: Tab = tabs[0]?.[0] ?? 'tables';
		if (data.focus) {
			for (const [k, , t] of tabs) {
				const found = findNodeById(t, data.focus);
				if (found) {
					next[k] = found;
					nextTab = k;
					break;
				}
			}
		}
		return { trails: next, tab: nextTab };
	});
	const tabKeys = $derived<Tab[]>([
		...tabs.map(([k]) => k),
		...(d.tables?.length ? (['tables'] as Tab[]) : [])
	]);
	const urlTab = $derived(page.url.searchParams.get('tab') as Tab | null);
	const tab = $derived<Tab>(urlTab && tabKeys.includes(urlTab) ? urlTab : initial.tab);
	const current = $derived(tabs.find(([k]) => k === tab));

	/** Follow URL path segments down from a tab's root, stopping at the last match. */
	function resolve(root: BudgetNode, segs: string[]): BudgetNode[] {
		const trail = [root];
		for (const seg of segs) {
			const cur = trail[trail.length - 1];
			const kids = [...(cur.children ?? []), ...(cur.excludedChildren ?? [])];
			const next = kids.find((c) => segmentOf(c) === seg) ?? kids.find((c) => c.code === seg);
			if (!next) break;
			trail.push(next);
		}
		return trail;
	}
	const trail = $derived.by(() => {
		if (!current) return null;
		if (urlTab !== tab) return initial.trails[tab] ?? [current[2]];
		const path = page.url.searchParams.get('path') ?? '';
		return resolve(current[2], path.split('/').filter(Boolean));
	});

	function hrefOf(k: Tab, t?: BudgetNode[]) {
		const segs = t ? pathSegments(t) : [];
		return (
			`${page.url.pathname}?tab=${encodeURIComponent(k)}` +
			(segs.length ? `&path=${segs.map(encodeURIComponent).join('/')}` : '')
		);
	}
	/** switching tabs replaces the history entry; drilling in adds one, so Back goes up */
	const setTab = (k: Tab) => goto(hrefOf(k, initial.trails[k]), { replace: true, reset: false });
	const drill = (t: BudgetNode[]) => goto(hrefOf(tab, t), { reset: false });

	function tabKey(e: KeyboardEvent) {
		const i = tabKeys.indexOf(tab);
		let j: number | null = null;
		if (e.key === 'ArrowRight') j = (i + 1) % tabKeys.length;
		else if (e.key === 'ArrowLeft') j = (i - 1 + tabKeys.length) % tabKeys.length;
		else if (e.key === 'Home') j = 0;
		else if (e.key === 'End') j = tabKeys.length - 1;
		if (j == null) return;
		e.preventDefault();
		const k = tabKeys[j];
		setTab(k);
		document.getElementById(`dept-tab-${k}`)?.focus();
	}
	const val = $derived(d.totals.amounts[settings.year]);
	const fundTotals = $derived(d.funding.byFundType ?? d.programs.byFundType);
	// atlas page numbers from the spending tree (when the department was found in it)
	const atlas = $derived(
		data.expTrail.length ? atlasIndex(data.expTrail[0], 'expenditures') : null
	);
	const pageNo = $derived(
		atlas ? atlas.ref(data.expTrail[data.expTrail.length - 1].id)?.own : undefined
	);
	const prefix = $derived([
		{ label: 'Spending · Key Map', href: routes.tree(ds.fy, ds.pit, 'expenditures') },
		...data.expTrail.slice(1, -1).map((n, i) => ({
			page: atlas?.ref(n.id)?.own,
			label: n.name,
			href: routes.tree(ds.fy, ds.pit, 'expenditures', pathSegments(data.expTrail.slice(0, i + 2)))
		}))
	]);
	const explorerHref = $derived(
		data.expTrail.length
			? routes.tree(ds.fy, ds.pit, 'expenditures', pathSegments(data.expTrail))
			: null
	);
</script>

<svelte:head><title>{d.name} · {Y.by} · California Budget Explorer</title></svelte:head>

<div class="space-y-6">
	<Breadcrumbs
		trail={[{ id: 'dept', kind: 'department', name: d.name, amounts: d.totals.amounts }]}
		{prefix}
	/>

	<header class="grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
		<div>
			{#if pageNo}<PageTab page={pageNo} label="Department" class="mb-4" />{/if}
			<h1
				class="text-3xl leading-tight font-bold tracking-tight text-balance md:text-5xl"
				title="Department code {d.orgCode}"
			>
				{d.name}
			</h1>
			{#if d.agencyName}<p class="mt-1 text-sm text-base-content/80">Part of {d.agencyName}</p>{/if}
			{#if d.description}
				<p class="mt-4 max-w-prose leading-relaxed">{d.description}</p>
			{/if}
			<p class="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm">
				{#if d.website}<a
						class="inline-flex min-h-11 items-center gap-1 text-primary"
						href={d.website}
						target="_blank"
						rel="noopener noreferrer"
						>Department website<svg
							aria-hidden="true"
							viewBox="0 0 16 16"
							class="size-3"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"><path d="M9 3h4v4M13 3 7 9M11 9.5V13H3V5h3.5" /></svg
						><span class="sr-only">(opens in a new tab)</span></a
					>{/if}
				{#if explorerHref}<a
						class="inline-flex min-h-11 items-center text-primary"
						href={explorerHref}>Open on the spending map</a
					>{/if}
			</p>
		</div>
		<section class="atlas-inset self-start p-4" aria-label="Department total">
			<h2 class="map-label text-xs">Total · {Y[settings.year]} · all funds</h2>
			<p class="mt-1 text-4xl font-semibold tracking-tight tabular-nums" title={moneyFull(val)}>
				{money(val)}
			</p>
			<div class="mt-1">
				<SourceChip sources={d.sources} fy={ds.fy} pit={ds.pit} product="departments" />
			</div>
			{#if settings.hasCompare}
				<p class="mt-1 text-sm">
					<DeltaBadge from={d.totals.amounts[settings.compare]} to={val} mode="both" />
					<span class="text-xs text-base-content/75">vs {Y[settings.compare]}</span>
				</p>
			{/if}
			<table class="mt-3 w-full text-sm tabular-nums">
				<caption class="sr-only">Total by year</caption>
				<tbody>
					{#each ['py', 'cy', 'by'] as const as y (y)}
						<tr class="border-t border-base-300 {y === settings.year ? 'bg-secondary/30' : ''}">
							<th scope="row" class="py-1 pl-1 text-left font-normal">{Y[y]}</th>
							<td class="py-1 pr-1 text-right font-semibold">{money(d.totals.amounts[y])}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			{#if d.totals.positions}
				<p class="mt-3 flex items-baseline gap-2 text-sm">
					<span>Positions</span><span class="dot-leader" aria-hidden="true"></span>
					<strong class="tabular-nums">{num(d.totals.positions[settings.year], 1)}</strong>
				</p>
			{/if}
			{#if fundTotals}<div class="mt-4"><FundMix byFundType={fundTotals} /></div>{/if}
			{#if settings.fund !== 'all'}
				<p class="mt-3 text-xs text-base-content/75">
					Total shows all funds; the maps below are filtered to {fundFilterLabel(settings.fund)}.
				</p>
			{/if}
		</section>
	</header>

	<div
		role="tablist"
		aria-label="Department views"
		class="flex flex-wrap border-b border-base-content"
	>
		{#each tabs as [k, label, t] (k)}
			<button
				role="tab"
				id="dept-tab-{k}"
				class="map-label min-h-11 px-3 text-sm {tab === k
					? 'bg-base-content text-base-100'
					: 'hover:bg-base-200'}"
				aria-selected={tab === k}
				aria-controls="dept-panel"
				tabindex={tab === k ? 0 : -1}
				onclick={() => setTab(k)}
				onkeydown={tabKey}
			>
				{label}
				<span class="ml-1 font-sans text-xs font-normal tabular-nums opacity-80"
					>{t.children?.length}</span
				>
			</button>
		{/each}
		{#if d.tables?.length}
			<button
				role="tab"
				id="dept-tab-tables"
				class="map-label min-h-11 px-3 text-sm {tab === 'tables'
					? 'bg-base-content text-base-100'
					: 'hover:bg-base-200'}"
				aria-selected={tab === 'tables'}
				aria-controls="dept-panel"
				tabindex={tab === 'tables' ? 0 : -1}
				onclick={() => setTab('tables')}
				onkeydown={tabKey}
			>
				Tables <span class="ml-1 font-sans text-xs font-normal tabular-nums opacity-80"
					>{d.tables.length}</span
				>
			</button>
		{/if}
	</div>

	<div role="tabpanel" id="dept-panel" aria-labelledby="dept-tab-{tab}">
		{#if tab === 'tables'}
			<div class="space-y-6">
				{#each d.tables ?? [] as t, i (i)}
					<div>
						<h2 class="mb-2 text-xl font-semibold">{t.title}</h2>
						<div class="overflow-x-auto border-y border-base-content">
							<table class="[&_thead_th]:font-map [&_thead_th]:uppercase [&_thead_th]:tracking-wider table table-sm [&_thead]:bg-base-200">
								<thead
									><tr
										>{#each t.columns as c, j (j)}<th class={j ? 'text-right' : ''}>{c}</th
											>{/each}</tr
									></thead
								>
								<tbody>
									{#each t.rows as r, ri (ri)}
										<tr>
											{#each r as cell, j (j)}
												<td class={j ? 'text-right tabular-nums' : ''}>{cell ?? '—'}</td>
											{/each}
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
						{#if t.source}<div class="mt-2"><SourceList sources={[t.source]} compact /></div>{/if}
					</div>
				{/each}
			</div>
		{:else if current && trail}
			{#key tab}
				<TreeExplorer
					{trail}
					years={Y}
					navigate={drill}
					views={['treemap', 'sunburst', 'city']}
					storageKey="cabx:view:dept"
					fallbackSources={d.sources}
					fy={ds.fy}
					pit={ds.pit}
					product="departments"
					compact
				/>
			{/key}
		{:else}
			<p class="text-base-content/80">No breakdown published.</p>
		{/if}
	</div>

	<SourceList sources={d.sources} title="Department sources" />
	<p class="text-xs text-base-content/75">
		Line-item kinds shown: {[
			...new Set(tabs.flatMap(([, , t]) => (t.children ?? []).map((c) => KIND_LABEL[c.kind])))
		].join(', ')}.
	</p>
</div>
