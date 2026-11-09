<script lang="ts">
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import { animate } from 'motion';
	import type { PageProps } from './$types';
	import type { BudgetNode, Fund, SourceRef } from '#lib/data/schema.ts';
	import { walk, segmentOf, idToSegments, getTree, getFunds } from '#lib/data/load.ts';
	import { money, moneyWords, valueOf, num, fundFilterPhrase } from '#lib/format.ts';
	import { settings } from '#lib/settings.svelte.ts';
	import { colorMap, CATEGORICAL, CASING } from '#lib/viz/palette.ts';
	import { routes } from '#lib/paths.ts';
	import { atlasIndex, type AtlasRef } from '#lib/atlas.ts';
	import BudgetCity from '#lib/components/BudgetCity.svelte';
	import KeyMap from '#lib/components/overview/KeyMap.svelte';
	import PageTab from '#lib/components/atlas/PageTab.svelte';
	import MarginGrid from '#lib/components/atlas/MarginGrid.svelte';
	import Legend from '#lib/components/atlas/Legend.svelte';
	import IndexLine from '#lib/components/atlas/IndexLine.svelte';
	import RankedBars from '#lib/components/RankedBars.svelte';
	import DeltaBadge from '#lib/components/DeltaBadge.svelte';
	import FundMix from '#lib/components/FundMix.svelte';
	import SourceList from '#lib/components/SourceList.svelte';
	import SourceChip from '#lib/components/SourceChip.svelte';

	let { data }: PageProps = $props();
	const ds = $derived(data.ds);
	const meta = $derived(ds.meta);
	const Y = $derived(meta.years);
	const T = $derived(meta.totals);

	// ------------------------------------------------------------------ progressive data
	// The headline comes from meta.json (layout data). Trees arrive as promises from +page.ts;
	// bytype.json and funds.json are fetched after first paint (on idle, or on demand).
	let exp = $state<BudgetNode | null>(null);
	let expFailed = $state(false);
	let rev = $state<BudgetNode | null | undefined>(undefined); // undefined = loading
	let byType = $state<BudgetNode | null | undefined>(undefined);
	let funds = $state<Record<string, Fund> | null | undefined>(undefined);

	$effect(() => {
		const pExp = data.exp;
		const pRev = data.rev;
		let live = true;
		untrack(() => {
			exp = null;
			expFailed = false;
			rev = undefined;
		});
		pExp.then(
			(v) => live && (exp = v),
			() => live && (expFailed = true)
		);
		pRev.then((v) => live && (rev = v));
		return () => (live = false);
	});

	let byTypeDir = '';
	function loadByType() {
		const dir = ds.dir;
		if (byTypeDir === dir) return;
		byTypeDir = dir;
		getTree(dir, 'bytype')
			.then((v) => byTypeDir === dir && (byType = v))
			.catch(() => byTypeDir === dir && (byType = null));
	}
	$effect(() => {
		const dir = ds.dir;
		untrack(() => {
			byType = undefined;
			funds = undefined;
			byTypeDir = '';
		});
		let live = true;
		const run = () => {
			if (!live) return;
			loadByType();
			getFunds(dir)
				.then((v) => live && (funds = v))
				.catch(() => live && (funds = null));
		};
		const idle = 'requestIdleCallback' in window;
		const h = idle ? requestIdleCallback(run, { timeout: 3000 }) : window.setTimeout(run, 1500);
		return () => {
			live = false;
			if (idle) cancelIdleCallback(h);
			else window.clearTimeout(h);
		};
	});

	// ------------------------------------------------------------------ headline (meta only)
	const expTotals = $derived({ amounts: T.expenditures, byFundType: T.expendituresByFundType });
	const spend = $derived(valueOf(expTotals, settings.year, settings.fund));
	const spendPrev = $derived(valueOf(expTotals, settings.compare, settings.fund));
	const fbt = (t: keyof typeof T.expendituresByFundType, y: typeof settings.year) =>
		T.expendituresByFundType[t]?.[y] ?? null;
	const sum = (...xs: (number | null)[]) =>
		xs.every((x) => x == null) ? null : xs.reduce<number>((a, x) => a + (x ?? 0), 0);

	/** Breakdown that adds up to "state + federal": General, special & bond, federal. */
	const parts = $derived([
		{
			k: 'General Fund',
			hint: 'The main state account, paid for mostly by taxes',
			v: fbt('general', settings.year),
			prev: fbt('general', settings.compare)
		},
		{
			k: 'Special and bond funds',
			hint: 'State money set aside by law for a purpose, and borrowed bond money',
			v: sum(fbt('special', settings.year), fbt('bond', settings.year)),
			prev: sum(fbt('special', settings.compare), fbt('bond', settings.compare))
		},
		{
			k: 'Federal funds',
			hint: 'Money from the federal government, spent through state programs',
			v: fbt('federal', settings.year),
			prev: fbt('federal', settings.compare)
		}
	]);
	const stateRevenue = $derived(T.revenues[settings.year] ?? null);
	const stateRevenuePrev = $derived(T.revenues[settings.compare] ?? null);

	// Source behind the headline: DOF's General Budget Summary (Schedule 1) for state funds,
	// then the expenditure sources.
	const headlineSources = $derived.by((): SourceRef[] => {
		const sch1 = meta.sources.find((s) => /Summary Schedule 1\b/.test(s.label));
		const sch9 = meta.sources.find((s) => /Summary Schedule 9\b/.test(s.label));
		const first = settings.fund === 'all' || settings.fund === 'federal' ? sch9 : sch1;
		return [first, ...(exp?.sources ?? []), ...meta.sources].filter((s): s is SourceRef => !!s);
	});
	const revenueSources = $derived(meta.sources.filter((s) => /Summary Schedule 8\b/.test(s.label)));

	// count-up headline (animates from the previous value when toggles change)
	let shown = $state(0);
	$effect(() => {
		const to = spend ?? 0;
		if (settings.reducedMotion) {
			shown = to;
			return;
		}
		const c = animate(
			untrack(() => shown),
			to,
			{
				duration: 1.2,
				ease: [0.22, 1, 0.36, 1],
				onUpdate: (v) => (shown = v)
			}
		);
		return () => c.stop();
	});

	// ------------------------------------------------------------------ lists (trees)
	const colors = $derived(
		colorMap(
			(exp?.children ?? []).map((c) => ({ id: c.id, key: c.amounts.by ?? 0 })),
			settings.mode
		)
	);
	/** The atlas index of the spending tree: page numbers and grid squares. */
	const index = $derived(exp ? atlasIndex(exp, 'expenditures') : null);
	const agencyHref = (a: BudgetNode) => routes.tree(ds.fy, ds.pit, 'expenditures', [segmentOf(a)]);
	const agencies = $derived(
		(exp?.children ?? []).map((a) => {
			const own = index?.ref(a.id)?.own;
			return {
				id: a.id,
				name: a.name,
				value: valueOf(a, settings.year, settings.fund) ?? 0,
				href: agencyHref(a),
				color: colors.get(a.id),
				ref: own != null ? { page: own } : undefined
			};
		})
	);
	// "Where the money goes": by agency, or by type of spending (DOF character of expenditure)
	let goesBy = $state<'agency' | 'type'>('agency');
	const types = $derived(
		(byType?.children ?? []).map((t) => ({
			id: t.id,
			name: t.name,
			value: valueOf(t, settings.year, settings.fund) ?? 0,
			href: routes.tree(ds.fy, ds.pit, 'bytype', [segmentOf(t)])
		}))
	);
	const revSources = $derived.by(() => {
		if (!rev) return [];
		const out: { id: string; name: string; value: number; href: string }[] = [];
		for (const [n] of walk(rev)) {
			if (n.children?.length || n === rev) continue;
			out.push({
				id: n.id,
				name: n.name,
				value: valueOf(n, settings.year, settings.fund) ?? 0,
				href: routes.tree(ds.fy, ds.pit, 'revenues', idToSegments(n.id))
			});
		}
		return out;
	});
	const revHasAny = $derived(revSources.some((r) => r.value > 0));
	const departments = $derived.by(() => {
		const out: {
			id: string;
			name: string;
			value: number;
			href: string;
			ref: AtlasRef | undefined;
		}[] = [];
		if (!exp) return out;
		for (const [n] of walk(exp)) {
			if (n.kind !== 'department') continue;
			out.push({
				id: n.id,
				name: n.name,
				value: valueOf(n, settings.year, settings.fund) ?? 0,
				href: n.detailRef
					? routes.department(ds.fy, ds.pit, n.detailRef)
					: routes.tree(ds.fy, ds.pit, 'expenditures', idToSegments(n.id)),
				ref: index?.ref(n.id)
			});
		}
		return out;
	});
	const topDepartments = $derived(
		departments
			.filter((d) => d.value > 0)
			.sort((a, b) => b.value - a.value)
			.slice(0, 12)
	);
	const gfFund = $derived(funds?.['0001']);

	// legend swatches follow the theme
	const legendItems = $derived([
		{
			label: 'Agency',
			note: 'Each tint is one agency; white streets inside are its departments',
			color: CATEGORICAL[settings.mode][1],
			kind: 'casing' as const
		},
		{
			label: 'Casing line',
			note: 'The border between neighbouring agencies',
			color: CASING[settings.mode],
			kind: 'line' as const
		},
		{
			label: 'Selected',
			note: 'The agency under your pointer or keyboard focus',
			color: settings.mode === 'dark' ? '#f2c94c' : '#f2c230',
			kind: 'line' as const
		}
	]);

	// "Aerial view": the 3D city, opt-in; three.js loads only once it is opened
	let aerial = $state(false);

	function selectAgency(chain: BudgetNode[]) {
		// the aerial view drills by chain; the Key Map uses plain links
		goto(routes.tree(ds.fy, ds.pit, 'expenditures', chain.map(segmentOf)));
	}
	function showByType() {
		goesBy = 'type';
		loadByType();
	}
</script>

<svelte:head
	><title>{meta.fiscalYear} {meta.publication} budget · California Budget Explorer</title
	></svelte:head
>

{#snippet arrow()}
	<svg
		aria-hidden="true"
		viewBox="0 0 16 16"
		class="inline size-3.5 shrink-0"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"><path d="M3 8h10M9 4l4 4-4 4" /></svg
	>
{/snippet}

{#snippet loadingDots()}
	<p class="py-6 text-center">
		<span class="loading loading-dots" aria-label="Loading"></span>
	</p>
{/snippet}

<header>
	<PageTab label="Whole budget" />
	<h1
		class="mt-4 text-4xl leading-[1.02] font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl"
	>
		California spends <span class="whitespace-nowrap tabular-nums"
			><span aria-hidden="true">{moneyWords(shown)}</span><span class="sr-only"
				>{moneyWords(spend)}</span
			></span
		>
	</h1>
	<p class="mt-3 max-w-prose text-lg text-base-content/85">
		{fundFilterPhrase(settings.fund)} in {Y[settings.year]}, under the {meta.publication.toLowerCase()}
		budget.
		{#if settings.fund === 'state'}
			State funds are the General Fund plus special and bond funds.
		{:else if settings.fund === 'all'}
			That is state funds plus federal funds.
		{/if}
	</p>
	{#if settings.hasCompare}
		<p class="mt-1 flex flex-wrap items-center gap-x-1 text-sm text-base-content/80">
			<DeltaBadge from={spendPrev} to={spend} mode="both" /> compared with {Y[settings.compare]}
		</p>
	{/if}
	<p class="mt-2">
		<SourceChip sources={headlineSources} fy={ds.fy} pit={ds.pit} product="expenditures" />
	</p>
	<p class="mt-3 max-w-prose text-sm text-base-content/75">
		An independent explorer built from official State of California budget publications. Not
		affiliated with or endorsed by the State.
	</p>
</header>

<div
	class="mt-6 grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,52rem)_minmax(16rem,21rem)] lg:justify-between"
>
	<section aria-labelledby="keymap-heading" class="min-w-0">
		<h2 id="keymap-heading" class="sr-only">Key Map: the agencies</h2>
		{#if exp && index}
			<MarginGrid>
				<KeyMap node={exp} {colors} {index} hrefOf={agencyHref} />
			</MarginGrid>
		{:else if expFailed}
			<div role="alert" class="atlas-inset p-4 sm:ml-5">
				<p class="font-semibold">The map didn’t load.</p>
				<p class="mt-1 text-sm text-base-content/80">
					The totals on this page are complete. Check your connection, then
					<button class="link" onclick={() => location.reload()}>try again</button>.
				</p>
			</div>
		{:else}
			<div
				class="flex aspect-[10/7] w-full items-center justify-center bg-base-200 sm:ml-5 sm:w-[calc(100%-1.25rem)]"
			>
				<span class="loading loading-md loading-dots" aria-label="Loading the Key Map"></span>
			</div>
		{/if}

		<div class="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm sm:pl-5">
			<button
				class="map-label inline-flex min-h-11 items-center gap-2 border-b-2 border-transparent text-sm hover:border-base-content aria-expanded:border-secondary"
				aria-expanded={aerial}
				aria-controls="aerial-view"
				disabled={!exp}
				onclick={() => (aerial = !aerial)}
			>
				<svg
					aria-hidden="true"
					viewBox="0 0 20 20"
					class="size-4"
					fill="none"
					stroke="currentColor"
					stroke-width="1.6"
					stroke-linejoin="round"
					><path d="M2 14l8 4 8-4-8-4-8 4z" /><path d="M6 12V6l4-2 4 2v6" /><path
						d="M10 4v8"
					/></svg
				>
				{aerial ? 'Close aerial view' : 'Aerial view (3D)'}
			</button>
			<a class="map-label inline-flex min-h-11 items-center text-sm" href="#where-money-goes"
				>Agencies as a list</a
			>
			<a
				class="map-label inline-flex min-h-11 items-center gap-1.5 text-sm text-primary"
				href={routes.tree(ds.fy, ds.pit, 'expenditures')}
				>Spending, page by page {@render arrow()}</a
			>
		</div>

		<div id="aerial-view">
			{#if aerial && exp}
				<div class="mt-3 border border-base-content sm:ml-5">
					<BudgetCity
						node={exp}
						{colors}
						height={420}
						autoRotate
						labels={6}
						onselect={selectAgency}
						listHref="#where-money-goes"
						listLabel="the list of agencies under “Where the money goes”"
					>
						{#snippet fallback()}
							<div class="flex h-full items-center justify-center p-6 text-center text-sm">
								The aerial view needs 3D graphics (WebGL), which this browser isn’t offering. The
								Key Map above shows the same agencies.
							</div>
						{/snippet}
					</BudgetCity>
				</div>
				<p class="mt-1 text-xs text-base-content/75 sm:pl-5">
					The same map from above: each block is an agency and each building a department, with
					footprint and height showing dollars.
				</p>
			{/if}
		</div>
	</section>

	<aside class="space-y-4" aria-label="Map key and key figures">
		<Legend items={legendItems}>
			<p class="flex items-center gap-2">
				<svg aria-hidden="true" viewBox="0 0 24 24" class="size-6 shrink-0">
					<circle cx="12" cy="12" r="11" class="fill-base-content" />
					<text
						x="12"
						y="16"
						text-anchor="middle"
						font-size="11"
						class="map-label fill-base-100"
						style="letter-spacing: 0">100</text
					>
				</svg>
				<span>Page number: the agency’s own page in this atlas</span>
			</p>
		</Legend>

		<section class="atlas-inset p-3 text-sm" aria-labelledby="howto-heading">
			<h2 id="howto-heading" class="map-label mb-2 text-xs">How to read this atlas</h2>
			<ol class="list-decimal space-y-1 pl-5 marker:font-semibold">
				<li>Blocks are sized by dollars, so the biggest agencies take the most room.</li>
				<li>The number in the black circle is the page: select a block to turn to it.</li>
				<li>Every figure names the official document and page it comes from.</li>
			</ol>
		</section>

		<section class="atlas-inset p-3 text-sm" aria-labelledby="totals-heading">
			<h2 id="totals-heading" class="map-label mb-1 text-xs">Key figures, {Y[settings.year]}</h2>
			<table class="w-full">
				<caption class="sr-only">Spending by fund group and state revenue</caption>
				<tbody class="divide-y divide-base-content/15">
					{#each parts as s (s.k)}
						<tr>
							<th scope="row" class="py-1.5 pr-2 text-left align-top font-normal">
								<span class="block font-semibold">{s.k}</span>
								<span class="block text-xs text-base-content/75">{s.hint}</span>
							</th>
							<td class="py-1.5 text-right align-top whitespace-nowrap tabular-nums">
								<span class="block font-semibold">{money(s.v)}</span>
								{#if settings.hasCompare}<DeltaBadge from={s.prev} to={s.v} />{/if}
							</td>
						</tr>
					{/each}
					<tr>
						<th scope="row" class="py-1.5 pr-2 text-left align-top font-normal">
							<span class="block font-semibold">State tax and fee revenue</span>
							<span class="block text-xs text-base-content/75"
								>General Fund and special fund revenue</span
							>
						</th>
						<td class="py-1.5 text-right align-top whitespace-nowrap tabular-nums">
							<span class="block font-semibold">{money(stateRevenue)}</span>
							{#if settings.hasCompare}<DeltaBadge from={stateRevenuePrev} to={stateRevenue} />{/if}
						</td>
					</tr>
				</tbody>
			</table>
			{#if revenueSources.length}
				<p class="mt-1">
					<SourceChip sources={revenueSources} fy={ds.fy} pit={ds.pit} product="revenues" />
				</p>
			{/if}
			<p class="mt-2 border-t border-base-content/15 pt-2 text-xs text-base-content/85">
				Revenue doesn’t have to match spending: federal funds, borrowed bond money and savings from
				earlier years also pay for it.
				<a
					class="inline-flex items-center gap-1 text-primary"
					href="{routes.reconciliation(ds.fy, ds.pit)}#totals"
					>See why the totals don’t match {@render arrow()}</a
				>
			</p>
		</section>
	</aside>
</div>

<section class="mt-12 border-t border-base-content pt-6">
	<div class="grid gap-x-10 gap-y-10 lg:grid-cols-2">
		<div id="where-money-goes" class="min-w-0 scroll-mt-32">
			<div class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
				<h2 class="text-2xl font-bold tracking-tight">Where the money goes</h2>
				<div class="flex" role="group" aria-label="Group spending by">
					{#each [['agency', 'By agency'], ['type', 'By type']] as const as [k, l] (k)}
						<button
							class="map-label min-h-11 border border-base-content px-3 text-xs sm:min-h-8 {goesBy ===
							k
								? 'bg-base-content text-base-100'
								: 'hover:bg-base-200'} {k === 'type' ? '-ml-px' : ''}"
							aria-pressed={goesBy === k}
							onclick={() => (k === 'type' ? showByType() : (goesBy = k))}>{l}</button
						>
					{/each}
				</div>
			</div>
			{#if goesBy === 'type'}
				{#if byType}
					<RankedBars items={types} top={9} label="Spending by type" />
					<p class="mt-3 max-w-prose text-sm leading-relaxed text-base-content/80">
						Every program, from every department, grouped by what it pays for: e.g. K-12 schools
						combines the Department of Education, school facility grants and the Proposition 98
						settle-up.
					</p>
					<p class="mt-2">
						<a
							class="inline-flex items-center gap-1 text-sm text-primary"
							href={routes.tree(ds.fy, ds.pit, 'bytype')}>Explore by type {@render arrow()}</a
						>
					</p>
				{:else if byType === null}
					<p class="text-sm text-base-content/80">
						Spending by type didn’t load. <a
							class="link"
							href={routes.tree(ds.fy, ds.pit, 'bytype')}>Open the By type page</a
						>.
					</p>
				{:else}
					{@render loadingDots()}
				{/if}
			{:else if exp}
				<RankedBars items={agencies} top={13} label="Spending by agency" />
				<p class="mt-2">
					<a
						class="inline-flex items-center gap-1 text-sm text-primary"
						href={routes.tree(ds.fy, ds.pit, 'expenditures')}
						>All agencies, page by page {@render arrow()}</a
					>
				</p>
			{:else if !expFailed}
				{@render loadingDots()}
			{/if}
		</div>

		<div class="min-w-0">
			<h2 class="mb-3 flex min-h-11 items-center text-2xl font-bold tracking-tight">
				Where it comes from
			</h2>
			{#if rev === undefined}
				{@render loadingDots()}
			{:else if !rev}
				<p class="text-base-content/80">Revenue data is not available for this publication.</p>
			{:else if !revHasAny}
				<p class="max-w-prose text-sm text-base-content/80">
					Revenue figures cover state money only (the General Fund and special funds). Federal funds
					are not state revenue, so there is nothing to list for this choice of funds.
				</p>
			{:else}
				<RankedBars items={revSources} top={9} label="Revenue by source" />
				<p class="mt-2">
					<a
						class="inline-flex items-center gap-1 text-sm text-primary"
						href={routes.tree(ds.fy, ds.pit, 'revenues')}>All revenue sources {@render arrow()}</a
					>
				</p>
			{/if}
		</div>
	</div>
</section>

<section class="mt-12 border-t border-base-content pt-6">
	<div class="grid gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
		<section class="min-w-0" aria-labelledby="departments-heading">
			<h2 id="departments-heading" class="text-2xl font-bold tracking-tight">
				Largest departments
			</h2>
			<p class="mt-1 text-sm text-base-content/80">
				The twelve biggest, with the page and square where each sits on its agency’s map.
			</p>
			{#if exp}
				<ol class="mt-3 divide-y divide-base-content/15">
					{#each topDepartments as d (d.id)}
						<IndexLine label={d.name} href={d.href} ref={d.ref} value={money(d.value)} />
					{/each}
				</ol>
			{:else if !expFailed}
				{@render loadingDots()}
			{/if}
		</section>

		<div class="min-w-0 space-y-10">
			<div>
				<h2 class="mb-3 text-2xl font-bold tracking-tight">Spending by fund type</h2>
				<FundMix byFundType={T.expendituresByFundType} />
				{#if T.excluded}
					<p class="mt-3 max-w-prose text-sm leading-relaxed text-base-content/80">
						Not counted as spending:
						{money(T.excluded.reimbursement?.[settings.year] ?? null)} in reimbursements (payments between
						departments) and
						{money(T.excluded.nongovernmental?.[settings.year] ?? null)} in nongovernmental cost funds
						(pension trusts, university own funds, local property tax){#if T.excluded.interimLoan?.[settings.year]},
							plus {money(T.excluded.interimLoan[settings.year])} in loan-financed Medi-Cal interim payments
							(charged to the regular budget items once enacted){/if}. The State’s “all funds” total
						includes them, so it is larger than the totals here.
					</p>
				{/if}
				{#if Object.keys(T.revenuesByFundType).length}
					<h3 class="map-label mt-6 mb-2 text-xs">Revenues by fund type</h3>
					<FundMix byFundType={T.revenuesByFundType} />
				{/if}
			</div>

			{#if gfFund?.condition}
				{@const c = gfFund.condition}
				<div>
					<h2 class="mb-1 text-2xl font-bold tracking-tight">General Fund balance</h2>
					<p class="mb-3 text-sm text-base-content/80">
						What the State’s main account starts and ends {Y[settings.year]} with.
					</p>
					<table class="w-full text-sm">
						<thead>
							<tr class="border-b border-base-content">
								<th scope="col" class="map-label pb-1 text-left text-xs">Line</th>
								<th scope="col" class="map-label pb-1 text-right text-xs">{Y[settings.year]}</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-base-content/15">
							{#each [['Beginning balance', c.beginningBalance], ['Revenues and transfers', c.revenues], ['Expenditures', c.expenditures], ['Ending balance', c.endingBalance]] as const as [k, t] (k)}
								{#if t}
									<tr>
										<th scope="row" class="py-1.5 text-left font-normal">{k}</th>
										<td class="py-1.5 text-right font-semibold tabular-nums"
											>{money(t[settings.year])}</td
										>
									</tr>
								{/if}
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	</div>
</section>

<section class="mt-12 border-t border-base-content pt-6" aria-labelledby="about-heading">
	<div class="grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
		<div>
			<h2 id="about-heading" class="text-2xl font-bold tracking-tight">About these numbers</h2>
			<p class="mt-2 max-w-prose text-base-content/85">
				Every figure comes from the State’s published budget documents and is shown rounded.
				Spending counts the General Fund, special funds, bond funds and federal funds; money that
				only moves between state accounts is reported separately so nothing is counted twice.
			</p>
			<p class="mt-2">
				<a
					class="inline-flex items-center gap-1 text-primary"
					href={routes.dataSources(ds.fy, ds.pit)}
					>Sources, notes and known gaps {@render arrow()}</a
				>
			</p>
			<p class="mt-3 max-w-prose text-sm text-base-content/80">
				This budget covers {num(meta.counts.agencies)} agencies, {num(meta.counts.departments)} departments,
				{num(meta.counts.programs)} programs and {num(meta.counts.lineItems)} line items.
			</p>
		</div>
		<SourceList sources={meta.sources} />
	</div>
</section>
