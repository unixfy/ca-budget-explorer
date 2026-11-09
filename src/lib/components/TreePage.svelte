<script lang="ts">
	/** URL-driven TreeExplorer used by both the expenditure and revenue routes. */
	import { goto } from '$app/navigation';
	import type { BudgetNode, DepartmentDetail, Triple } from '#lib/data/schema.ts';
	import { pathSegments, type Dataset, type TreeName } from '#lib/data/load.ts';
	import { routes } from '#lib/paths.ts';
	import { money, pct, valueOf } from '#lib/format.ts';
	import { settings } from '#lib/settings.svelte.ts';
	import TreeExplorer from './TreeExplorer.svelte';

	interface Props {
		ds: Dataset;
		tree: TreeName;
		trail: BudgetNode[];
		detail: DepartmentDetail | null;
	}
	let { ds, tree, trail, detail }: Props = $props();

	const TREE_LABEL: Record<TreeName, string> = {
		expenditures: 'Spending',
		revenues: 'Revenue',
		bytype: 'Spending by type'
	};

	const node = $derived(trail[trail.length - 1]);
	const navigate = (t: BudgetNode[]) =>
		goto(routes.tree(ds.fy, ds.pit, tree, pathSegments(t)), { reset: false });
	/**
	 * What the top of each tree shows, in plain words. (The data files carry technical
	 * notes for maintainers; those are not shown to visitors.)
	 */
	const ROOT_NOTE: Partial<Record<TreeName, string[]>> = {
		revenues: [
			'This shows the taxes, fees and other money collected into the state’s General Fund and special funds, as listed by the Department of Finance.',
			'Federal money and borrowing through bonds are not state revenue, so they aren’t included here. Flows shows all the money coming in.'
		],
		bytype: [
			'These groups are this site’s own way of sorting spending by what it pays for, not an official state classification. Each program is placed in one group by a stated rule, so the groups add up to the total.'
		]
	};
	const crumbHref = (i: number) =>
		routes.tree(ds.fy, ds.pit, tree, pathSegments(trail.slice(0, i + 1)));
	const focusOf = (n: BudgetNode) => n.extra?.focus as string | undefined;
	const hrefFor = (n: BudgetNode) =>
		n.detailRef ? routes.department(ds.fy, ds.pit, n.detailRef, focusOf(n)) : null;

	/** "How it's paid": state operations / local assistance / capital outlay (bytype tree). */
	const CHAR_LABEL: Record<string, string> = {
		la: 'Paid out to others (local assistance)',
		so: 'Spent by the state itself (state operations)',
		co: 'Building and land (capital outlay)',
		unknown: 'Statewide adjustments (not split)'
	};
	const charRows = (n: BudgetNode) => {
		const bc = n.extra?.byCharacter as Record<string, Triple> | undefined;
		if (!bc) return [];
		const total = valueOf(n, settings.year) ?? 0;
		return Object.entries(bc)
			.map(([k, t]) => ({ k, label: CHAR_LABEL[k] ?? k, v: t[settings.year] ?? 0 }))
			.filter((r) => Math.abs(r.v) >= 500)
			.sort((a, b) => b.v - a.v)
			.map((r) => ({ ...r, share: total ? r.v / total : null }));
	};
	const title = $derived(`${node.name} · ${TREE_LABEL[tree]} · ${ds.meta.years.by}`);
</script>

<svelte:head><title>{title} · California Budget Explorer</title></svelte:head>

<TreeExplorer
	{trail}
	years={ds.meta.years}
	{navigate}
	{crumbHref}
	{hrefFor}
	fallbackSources={ds.meta.sources}
	storageKey="cabx:view:{tree}"
	fy={ds.fy}
	pit={ds.pit}
	product={tree === 'bytype' ? 'expenditures' : tree}
	{tree}
	treeLabel={TREE_LABEL[tree]}
>
	{#snippet aside(n)}
		{@const dep = n.detailRef ? n : null}
		{@const notes = n.kind === 'root' ? ROOT_NOTE[tree] : undefined}
		{#if notes?.length}
			<section class="border-t border-base-content pt-3 leading-relaxed">
				{#each notes as note, i (i)}<p class={i ? 'mt-2' : ''}>{note}</p>{/each}
				{#if tree === 'revenues'}
					<a class="mt-2 inline-block text-primary" href={routes.flows(ds.fy, ds.pit)}
						>See all money in and out</a
					>
				{/if}
			</section>
		{/if}
		{@const chars = tree === 'bytype' ? charRows(n) : []}
		{#if chars.length > 1 || (chars.length && n.kind !== 'root')}
			<section class="atlas-inset p-3">
				<h2 class="map-label mb-2 text-xs">How it’s paid</h2>
				<dl class="space-y-1">
					{#each chars as c (c.k)}
						<div class="flex items-baseline gap-2">
							<dt>{c.label}</dt>
							<span class="dot-leader" aria-hidden="true"></span>
							<dd class="text-right font-semibold whitespace-nowrap tabular-nums">
								{money(c.v)}{#if c.share != null && chars.length > 1}
									<span class="font-normal text-base-content/75"> · {pct(c.share, 0)}</span>{/if}
							</dd>
						</div>
					{/each}
				</dl>
			</section>
		{/if}
		{#if tree === 'bytype' && n.extra?.rule}
			<section class="border-t border-base-content pt-3 text-xs leading-relaxed">
				<h2 class="map-label mb-1 text-xs">Why it’s here</h2>
				<p>
					Official program: <span class="font-semibold">{n.extra.programPath}</span>
					({n.extra.agency ?? trail[trail.length - 2]?.name}).
				</p>
				<p class="mt-1">Matched rule: {n.extra.rule}.</p>
			</section>
		{/if}
		{#if dep}
			<a
				class="map-label flex min-h-11 w-full items-center justify-between bg-primary px-3 text-sm text-primary-content no-underline hover:brightness-110"
				href={routes.department(ds.fy, ds.pit, dep.detailRef!, focusOf(dep))}
			>
				{focusOf(dep) ? 'See this program in the department →' : 'Full department detail →'}
			</a>
		{:else if detail && n.kind !== 'department'}
			<section class="border-t border-base-content pt-3">
				<h2 class="map-label mb-1 text-xs">Part of</h2>
				<a
					class="font-semibold text-primary"
					href={routes.department(ds.fy, ds.pit, detail.orgCode, n.id)}>{detail.name}</a
				>
				<span class="text-base-content/75">({money(detail.totals.amounts.by)})</span>
				<p class="mt-1 text-xs text-base-content/80">
					See funding by fund and appropriation item, categories, and projects.
				</p>
			</section>
		{/if}
	{/snippet}
</TreeExplorer>
