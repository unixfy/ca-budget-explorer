<script lang="ts">
	import type { PageProps } from './$types';
	import { tick, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import type { CatalogNode, Product } from '#lib/data/sources-catalog.ts';
	import { PIT_LABELS } from '#lib/data/schema.ts';
	import { routes } from '#lib/paths.ts';
	import { settings } from '#lib/settings.svelte.ts';
	import {
		type Agg,
		aggregate,
		ancestorsOf,
		bytesLabel,
		findPath,
		formatColor,
		FORMAT_LABEL,
		FORMAT_SLOT,
		PRODUCT_LABEL
	} from '#lib/viz/sourceTree.ts';
	import { CASING, INK } from '#lib/viz/palette.ts';
	import SourceTree from '#lib/components/sources/SourceTree.svelte';
	import SourceDetails from '#lib/components/sources/SourceDetails.svelte';
	import SourcesTabs from '#lib/components/sources/SourcesTabs.svelte';
	import PageTab from '#lib/components/atlas/PageTab.svelte';
	import Legend, { type LegendItem } from '#lib/components/atlas/Legend.svelte';

	let { data }: PageProps = $props();
	const ds = $derived(data.ds);
	const cat = $derived(data.catalog);
	const agg = $derived(cat ? aggregate(cat.root) : new Map<string, Agg>());
	const st = $derived(cat?.stats);
	const ink = $derived(INK[settings.mode]);
	const scrollBehavior = (): ScrollBehavior => (settings.reducedMotion ? 'auto' : 'smooth');

	// ------------------------------------------------------------ tree state
	const expanded = new SvelteSet<string>();
	let selected = $state<string | null>(null);
	let usedOnly = $state(false);
	let showLinks = $state(true);
	let highlight: string | null = $state(null);
	let view: 'tree' | 'list' = $state('tree');
	let storyOpen = $state(false);

	function defaultExpansion() {
		expanded.clear();
		if (!cat) return;
		expanded.add('root');
		const eb = cat.root.children?.find((c) => c.used);
		if (eb) {
			// every publication of this budget, and the dataset's own one down to its API endpoints,
			// schedules and chapters (the two big PDF series start collapsed)
			expanded.add(eb.id);
			for (const pub of eb.children ?? []) if (pub.used) expanded.add(pub.id);
			const own = eb.children?.find((c) => c.id === `${eb.id}/${cat.pit}`);
			for (const dt of own?.children ?? [])
				if (/\/(api|sch|chap)$/.test(dt.id)) expanded.add(dt.id);
		}
	}
	// expand synchronously on first render (no flash of a collapsed tree), then on dataset change
	let initFor = untrack(() => (cat ? `${cat.fiscalYear}/${cat.pit}` : ''));
	untrack(defaultExpansion);
	$effect(() => {
		const key = cat ? `${cat.fiscalYear}/${cat.pit}` : '';
		if (key !== initFor) {
			initFor = key;
			defaultExpansion();
			selected = null;
			highlight = null;
		}
	});
	function expandAll() {
		if (!cat) return;
		const go = (n: CatalogNode) => {
			if (n.children?.length) {
				expanded.add(n.id);
				n.children.forEach(go);
			}
		};
		go(cat.root);
	}
	function collapseAll() {
		expanded.clear();
		expanded.add('root');
	}
	function reveal(id: string) {
		if (!cat) return;
		const p = findPath(cat.root, id);
		p?.slice(0, -1).forEach((n) => expanded.add(n.id));
	}
	function select(id: string) {
		selected = id || null;
		if (id && !id.startsWith('product:')) reveal(id);
	}
	function toggleBranch(id: string) {
		if (expanded.has(id)) expanded.delete(id);
		else expanded.add(id);
	}
	let treeBox: HTMLElement | undefined = $state();
	function showPain(id: string) {
		if (!cat) return;
		highlight = highlight === id ? null : id;
		if (highlight) {
			ancestorsOf(cat.root, (n) => !!n.pain?.includes(id)).forEach((a) => expanded.add(a));
			view = 'tree';
			treeBox?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
		}
	}

	const productHref = (p: Product): string | null => {
		switch (p) {
			case 'meta':
				return routes.home(ds.fy, ds.pit);
			case 'expenditures':
			case 'departments':
				return routes.tree(ds.fy, ds.pit, 'expenditures');
			case 'revenues':
				return routes.tree(ds.fy, ds.pit, 'revenues');
			case 'flows':
				return routes.flows(ds.fy, ds.pit);
			case 'reconciliation':
				return routes.reconciliation(ds.fy, ds.pit);
			default:
				return null;
		}
	};

	// ------------------------------------------------------------ ?product= (from "How we built this")
	const PRODUCT_ALIAS: Record<string, Product> = {
		meta: 'meta',
		overview: 'meta',
		home: 'meta',
		expenditures: 'expenditures',
		spending: 'expenditures',
		departments: 'departments',
		department: 'departments',
		funds: 'funds',
		revenues: 'revenues',
		revenue: 'revenues',
		flows: 'flows',
		reconciliation: 'reconciliation'
	};
	const focusProduct = $derived.by(() => {
		const q = page.url.searchParams.get('product');
		const id = q ? PRODUCT_ALIAS[q] : undefined;
		return id && cat?.products.some((p) => p.id === id) ? id : null;
	});
	const selProduct = $derived(
		selected?.startsWith('product:') ? (selected.slice(8) as Product) : null
	);
	$effect(() => {
		const id = focusProduct;
		if (!id || !cat) return;
		untrack(() => {
			view = 'tree';
			selected = `product:${id}`;
		});
		tick().then(() =>
			requestAnimationFrame(() => {
				const el = treeBox?.querySelector(`[data-product="${CSS.escape(id)}"]`);
				(el ?? treeBox)?.scrollIntoView({
					behavior: scrollBehavior(),
					block: 'center',
					inline: 'center'
				});
			})
		);
	});
	function clearProduct() {
		selected = null;
		const u = new URL(page.url.href);
		u.searchParams.delete('product');
		replaceState(u.pathname + u.search + u.hash, page.state);
	}

	// ------------------------------------------------------------ the publications behind this budget
	const publications = $derived.by(() => {
		const eb = cat?.root.children?.find((c) => c.used);
		const pubs = (eb?.children ?? []).filter((p) => p.used && p.url);
		const own = `${eb?.id}/${cat?.pit}`;
		return pubs.sort((a, b) => (a.id === own ? -1 : b.id === own ? 1 : 0));
	});

	// ------------------------------------------------------------ headline figures
	const tiles = $derived(
		st
			? [
					{
						v: st.documentsUsed,
						label: 'official documents and data files',
						sub: 'read to build this explorer'
					},
					{
						v: st.citations,
						label: 'source links',
						sub: 'attached to the figures you see here'
					},
					{
						v: st.pdfPagesParsed,
						label: 'pages of official PDFs',
						sub: 'read for detail the online data leaves out'
					},
					...(st.crossChecks
						? [
								{
									v: st.crossChecks.total,
									label: 'cross-checks between sources',
									sub: `${st.crossChecks.ok.toLocaleString()} agree within rounding`
								}
							]
						: [])
				]
			: []
	);
	/** The rest of the numbers: how much it took to build, for the curious. */
	const effort = $derived(
		st
			? [
					{
						v: st.publishers,
						label: 'publishers of California budget information',
						sub: `this explorer uses ${st.publishersUsed}; the others are listed for completeness`
					},
					{
						v: st.publications,
						label: 'publications and series',
						sub: 'Governor’s Budget, May Revision, Enacted Budget, reports, manuals and more'
					},
					{
						v: st.documents,
						label: 'documents and data feeds in total',
						sub: `${st.documentsUsed.toLocaleString()} of them read by this explorer`
					},
					{
						v: st.filesDownloaded,
						label: 'files downloaded',
						sub: `${bytesLabel(st.bytesDownloaded)} for one budget publication`
					},
					{
						v: st.apiEndpoints,
						label: 'kinds of data feed',
						sub: 'ebudget.ca.gov serves its figures as machine-readable data, one request per department; the feeds are not documented'
					},
					{
						v: st.formats.length,
						label: 'file formats',
						sub: st.formats.map((f) => FORMAT_LABEL[f]).join(', ')
					},
					{
						v: st.unitConventions.length,
						label: 'ways of writing amounts',
						sub: st.unitConventions.join(' · ')
					},
					{
						v: st.codeSystems.length,
						label: 'numbering systems to match up',
						sub: 'departments, programs, funds, revenue sources and appropriations each have their own codes, and the same thing must be matched across files'
					},
					{
						v: st.handTranscribed,
						label: 'figures typed in by hand',
						sub: 'published only as pictures of charts'
					}
				]
			: []
	);

	// ------------------------------------------------------------ fan-in matrix
	const matrix = $derived.by(() => {
		if (!cat) return { rows: [], max: 1 };
		const rows: { node: CatalogNode; pub: string; cells: Partial<Record<Product, number>> }[] = [];
		const go = (n: CatalogNode, pub: string) => {
			if (n.level === 'docType') {
				const a = agg.get(n.id);
				if (a?.used && a.feeds.size) {
					const cells: Partial<Record<Product, number>> = {};
					for (const p of a.feeds) cells[p] = a.backs[p] ?? 0;
					rows.push({ node: n, pub, cells });
				}
				return;
			}
			for (const c of n.children ?? [])
				go(c, n.level === 'publication' ? n.name.replace(/\s*\(.*\)$/, '') : pub);
		};
		go(cat.root, '');
		let max = 1;
		for (const r of rows) for (const v of Object.values(r.cells)) max = Math.max(max, v ?? 0);
		return { rows, max };
	});
	const dot = (v: number, max: number) => 4 + Math.sqrt(v / max) * 14;
	const sourcesPerProduct = (p: Product) => matrix.rows.filter((r) => p in r.cells).length;
	function showInTree(id: string) {
		select(id);
		view = 'tree';
		treeBox?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
	}

	// ------------------------------------------------------------ what makes it hard
	const painCount = (id: string) => {
		let n = 0;
		const go = (x: CatalogNode) => {
			if (x.pain?.includes(id)) n++;
			x.children?.forEach(go);
		};
		if (cat) go(cat.root);
		return n;
	};
	const legendFormats = $derived(
		(st?.formats ?? []).slice().sort((a, b) => FORMAT_SLOT[a] - FORMAT_SLOT[b])
	);
	const legend = $derived<LegendItem[]>([
		...legendFormats.map((f) => ({
			label: FORMAT_LABEL[f],
			color: formatColor(f, settings.mode),
			kind: 'casing' as const
		})),
		{ label: 'Source used here', color: CASING[settings.mode], kind: 'line' },
		{ label: 'Not used here', color: ink.muted, kind: 'dash' },
		{
			label: 'Expected, but not published',
			color: 'transparent',
			kind: 'tint',
			note: 'Dashed roundel with a cross'
		},
		{ label: 'Selected or highlighted', color: 'var(--color-secondary)', kind: 'casing' }
	]);
</script>

<svelte:head
	><title>Where the numbers come from · Sources · California Budget Explorer</title></svelte:head
>

<PageTab page="iv" label="Where the numbers come from" />
<header class="max-w-3xl">
	<h1 class="mt-3 text-4xl font-bold tracking-tight text-balance sm:text-5xl">
		Where the numbers come from
	</h1>
	<p class="mt-3 text-lg leading-relaxed text-base-content/85">
		Every figure in this explorer comes from the State of California’s own budget publications,
		published by the Department of Finance on ebudget.ca.gov. This is an independent site, not an
		official one, and nothing is adjusted to make the numbers match.
	</p>
</header>

<SourcesTabs fy={ds.fy} pit={ds.pit} current="map" class="mt-8" />

{#if !cat || !st}
	<div class="atlas-inset mt-8 max-w-2xl p-6">
		<p class="text-lg font-semibold">The source map for this budget isn’t ready yet</p>
		<p class="mt-2 text-base-content/80">
			The {PIT_LABELS[ds.pit]}
			{ds.fy} still lists its official sources and known gaps; the full map of documents will appear here
			once it has been prepared.
		</p>
		<a class="btn mt-4 btn-primary btn-sm" href={routes.sources(ds.fy, ds.pit)}
			>See notes &amp; known gaps</a
		>
	</div>
{:else}
	<!-- ───────────── answer first ───────────── -->
	<div class="mt-8 grid max-w-5xl gap-8 md:grid-cols-2">
		<section aria-labelledby="pubs-h">
			<h2 id="pubs-h" class="text-2xl font-bold">The official publications</h2>
			<ul class="mt-3 divide-y divide-base-300 border-y border-base-300">
				{#each publications as p (p.id)}
					<li class="py-2.5">
						<a
							class="inline-flex items-baseline gap-1.5 font-semibold text-primary underline-offset-2 hover:underline"
							href={p.url}
							target="_blank"
							rel="noopener noreferrer"
						>
							{p.name}
							<svg
								aria-hidden="true"
								viewBox="0 0 16 16"
								class="size-3 shrink-0 self-center"
								fill="none"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"><path d="M9 3h4v4M13 3 7 9M11 9.5V13H3V5h3.5" /></svg
							>
							<span class="sr-only">(opens ebudget.ca.gov in a new tab)</span>
						</a>
						{#if p.id === `${cat.root.children?.find((c) => c.used)?.id}/${cat.pit}`}
							<span
								class="map-label ml-1 border border-base-content px-1.5 py-0.5 text-[0.6875rem] leading-none"
								>Main source</span
							>
						{/if}
						{#if p.description}<p class="mt-0.5 text-sm text-base-content/80">
								{p.description}
							</p>{/if}
					</li>
				{/each}
			</ul>

			<!-- headline figures: a compact inset table, not tiles -->
			<table class="atlas-inset mt-6 w-full text-sm" aria-labelledby="board-h">
				<caption id="board-h" class="map-label mb-1.5 text-left text-xs">In numbers</caption>
				<tbody>
					{#each tiles as t (t.label)}
						<tr class="border-b border-base-300 last:border-b-0">
							<th scope="row" class="px-3 py-2 text-left align-top font-normal">
								<span class="font-semibold first-letter:uppercase">{t.label}</span>
								<span class="block text-xs text-base-content/75">{t.sub}</span>
							</th>
							<td class="px-3 py-2 text-right align-top text-lg font-bold tabular-nums"
								>{t.v.toLocaleString()}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>

		<section aria-labelledby="trace-h" class="atlas-inset self-start p-4 sm:p-5">
			<h2 id="trace-h" class="text-xl font-bold">How to trace a number</h2>
			<ol class="mt-3 space-y-3 leading-relaxed">
				{#each [1, 2, 3, 4] as step (step)}
					<li class="flex gap-3">
						<span
							class="map-label flex size-6 shrink-0 items-center justify-center rounded-full bg-base-content text-xs text-base-100 tabular-nums"
							aria-hidden="true">{step}</span
						>
						<span class="min-w-0">
							{#if step === 1}
								Find the <strong>Source</strong> line under a figure. It opens the official document the
								number was taken from, at the page it cites.
							{:else if step === 2}
								Check the <strong>Sources</strong> box at the end of each page. It names every document
								behind that view, with page numbers where the source is a PDF.
							{:else if step === 3}
								Follow the map below. It shows every source and the pages of this atlas each one
								feeds; select a page tab on the right of the map to see what it was built from.
							{:else}
								Turn to <a
									class="text-primary underline underline-offset-2"
									href={routes.reconciliation(ds.fy, ds.pit)}>Does it add up?</a
								> to compare this explorer’s totals with the Department of Finance’s published totals.
							{/if}
						</span>
					</li>
				{/each}
			</ol>
		</section>
	</div>

	<!-- ───────────── tree ───────────── -->
	<section aria-labelledby="tree-h" class="mt-14 scroll-mt-20" bind:this={treeBox}>
		<div class="flex flex-wrap items-end justify-between gap-3">
			<div>
				<h2 id="tree-h" class="text-2xl font-bold">Every source, and what it feeds</h2>
				<p class="mt-1 max-w-3xl text-sm leading-relaxed text-base-content/80">
					Read left to right: who publishes it, which publication, what kind of document, and the
					documents themselves. Bigger roundels stand for more documents; the tint shows the file
					type. Roads on the right connect each source to the pages of this site it feeds. Most
					pages draw on several.
				</p>
			</div>
			<div
				class="flex flex-wrap items-center gap-x-2 gap-y-1"
				role="group"
				aria-label="Map controls"
			>
				<div class="flex" role="group" aria-label="View">
					{#each [['tree', 'Map'], ['list', 'List']] as [v, label] (v)}
						<button
							class="map-label min-h-9 border px-3 text-xs {view === v
								? 'border-base-content bg-base-content text-base-100'
								: 'border-base-300 hover:border-base-content'}"
							aria-pressed={view === v}
							onclick={() => (view = v as 'tree' | 'list')}>{label}</button
						>
					{/each}
				</div>
				<button class="btn btn-ghost btn-sm" onclick={expandAll}>Open all</button>
				<button class="btn btn-ghost btn-sm" onclick={collapseAll}>Close all</button>
				<button class="btn btn-ghost btn-sm" onclick={defaultExpansion}>Reset</button>
				<label class="label cursor-pointer gap-2 text-sm text-base-content">
					<input type="checkbox" class="toggle toggle-sm" bind:checked={usedOnly} /> Only sources used
					here
				</label>
				<label class="label cursor-pointer gap-2 text-sm text-base-content">
					<input type="checkbox" class="toggle toggle-sm" bind:checked={showLinks} /> Show roads to pages
				</label>
			</div>
		</div>

		{#if focusProduct && selProduct === focusProduct}
			<div
				class="atlas-inset mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
				role="status"
			>
				<span
					class="inline-block size-3 shrink-0 border border-base-content bg-secondary"
					aria-hidden="true"
				></span>
				<span
					>Showing the sources behind <strong>{PRODUCT_LABEL[focusProduct]}</strong>, highlighted in
					the map and the table below.</span
				>
				<button class="btn btn-ghost btn-xs" onclick={clearProduct}>Show all sources</button>
			</div>
		{/if}

		<div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
			<div class="atlas-inset min-w-0">
				{#if view === 'tree'}
					<div class="overflow-x-auto p-2">
						<SourceTree
							catalog={cat}
							{agg}
							{expanded}
							{usedOnly}
							{showLinks}
							{highlight}
							bind:selected
							onselect={select}
						/>
					</div>
					<p class="border-t border-base-300 px-3 py-2 text-xs text-base-content/80">
						Select a roundel to open it and see details. Keyboard: Tab into the map, then the up and
						down arrows move, right and left open or close, and Enter selects.
					</p>
				{:else}
					{#snippet item(n: CatalogNode)}
						{@const a = agg.get(n.id)}
						<span class="flex flex-wrap items-baseline gap-x-2">
							<button
								class="text-left underline-offset-2 hover:underline {n.used
									? 'font-medium text-primary'
									: 'text-base-content/80 italic'} {selected === n.id ? 'bg-secondary/60' : ''}"
								aria-current={selected === n.id ? 'true' : undefined}
								onclick={() => select(n.id)}>{n.name}</button
							>
							<span class="text-xs text-base-content/75">
								{n.missing ? 'not published' : n.used ? '' : 'not used here'}
								{(n.formats ?? []).map((f) => FORMAT_LABEL[f]).join('/')}
								{a?.files ? `· ${a.files.toLocaleString()} files` : ''}
								{a?.pages ? `· ${a.pages.toLocaleString()} pages` : ''}
								{n.count && !n.children?.length ? `· ${n.count} documents` : ''}
							</span>
						</span>
					{/snippet}
					{#snippet branch(n: CatalogNode)}
						<ul class="ml-3 border-l border-base-300 pl-2">
							{#each (n.children ?? []).filter((c) => !usedOnly || c.used) as c (c.id)}
								{@const open = expanded.has(c.id)}
								<li class="py-0.5">
									<div class="flex items-start gap-1">
										{#if c.children?.length}
											<button
												class="btn btn-square size-6 min-h-0 shrink-0 btn-ghost btn-xs"
												aria-expanded={open}
												aria-label="{open ? 'Close' : 'Open'} {c.name}"
												onclick={() => toggleBranch(c.id)}
											>
												<svg
													aria-hidden="true"
													viewBox="0 0 16 16"
													class="size-3 transition-transform {open ? 'rotate-90' : ''}"
													fill="none"
													stroke="currentColor"
													stroke-width="1.75"
													stroke-linecap="round"
													stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg
												>
											</button>
										{:else}
											<span class="size-6 shrink-0" aria-hidden="true"></span>
										{/if}
										<div class="min-w-0 pt-0.5">{@render item(c)}</div>
									</div>
									{#if c.children?.length && open}{@render branch(c)}{/if}
								</li>
							{/each}
						</ul>
					{/snippet}
					<div class="max-h-[70vh] overflow-auto p-3 text-sm">
						{@render item(cat.root)}
						{@render branch(cat.root)}
					</div>
				{/if}
			</div>
			<div class="flex flex-col gap-4">
				<Legend items={legend}>
					<p>“+12” after a name means 12 more items inside: select it to open.</p>
					{#if highlight}
						<button
							class="mt-2 inline-flex items-center gap-1.5 border border-base-content bg-secondary px-2 py-1 text-left text-secondary-content"
							onclick={() => (highlight = null)}
						>
							Highlighting: {cat.painPoints.find((p) => p.id === highlight)?.title}
							<svg
								aria-hidden="true"
								viewBox="0 0 16 16"
								class="size-3 shrink-0"
								fill="none"
								stroke="currentColor"
								stroke-width="1.75"
								stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg
							><span class="sr-only">(clear)</span>
						</button>
					{/if}
				</Legend>
				<div class="lg:sticky lg:top-20">
					<SourceDetails
						catalog={cat}
						{agg}
						{selected}
						{productHref}
						onselect={select}
						onpain={(id) => {
							storyOpen = true;
							showPain(id);
						}}
					/>
				</div>
			</div>
		</div>
	</section>

	<!-- ───────────── fan-in matrix ───────────── -->
	<section aria-labelledby="fan-h" class="mt-14">
		<h2 id="fan-h" class="text-2xl font-bold">Every page is a blend</h2>
		<p class="mt-1 max-w-3xl text-sm leading-relaxed text-base-content/80">
			Which kinds of source feed which part of this explorer. A bigger dot means more figures on
			that page cite the source; a ring means the source is used for the page as a whole rather than
			cited figure by figure.
		</p>
		<div class="mt-4 overflow-x-auto border-b border-base-content">
			<table class="w-full text-sm">
				<thead>
					<tr class="map-label bg-base-content text-xs text-base-100">
						<th scope="col" class="px-3 py-2 text-left font-semibold">Source</th>
						{#each cat.products as p (p.id)}
							<th
								scope="col"
								class="px-2 py-2 text-center font-semibold {selProduct === p.id
									? 'bg-secondary text-secondary-content'
									: ''}"
								aria-current={selProduct === p.id ? 'true' : undefined}
							>
								{#if productHref(p.id)}<a
										class="underline-offset-2 hover:underline"
										href={productHref(p.id)}>{PRODUCT_LABEL[p.id]}</a
									>{:else}{PRODUCT_LABEL[p.id]}{/if}
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each matrix.rows as r (r.node.id)}
						<tr class="border-b border-base-300">
							<th scope="row" class="px-3 py-1.5 text-left font-normal">
								<button
									class="text-left text-primary underline-offset-2 hover:underline"
									onclick={() => showInTree(r.node.id)}>{r.node.name}</button
								>
								<span class="block text-xs text-base-content/75">{r.pub}</span>
							</th>
							{#each cat.products as p (p.id)}
								{@const v = r.cells[p.id]}
								<td class="px-2 text-center {selProduct === p.id ? 'bg-secondary/35' : ''}">
									{#if v != null}
										{@const s = v ? dot(v, matrix.max) : 8}
										<span
											class="inline-block rounded-full align-middle"
											style="width:{s}px;height:{s}px;{v
												? 'background:var(--color-base-content)'
												: 'border:2px solid var(--color-base-content)'}"
											title="{r.node.name} → {PRODUCT_LABEL[p.id]}: {v
												? `${v.toLocaleString()} figures cite it`
												: 'used for the page as a whole'}"
										></span>
										<span class="sr-only"
											>{v ? `${v.toLocaleString()} figures cite it` : 'used'}</span
										>
									{/if}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
				<tfoot>
					<tr class="border-t border-base-content">
						<th scope="row" class="map-label px-3 py-2 text-left text-xs">Different sources</th>
						{#each cat.products as p (p.id)}
							<td
								class="px-2 py-2 text-center font-semibold tabular-nums {selProduct === p.id
									? 'bg-secondary/35'
									: ''}">{sourcesPerProduct(p.id)}</td
							>
						{/each}
					</tr>
				</tfoot>
			</table>
		</div>
	</section>

	<!-- ───────────── how this was built (on demand) ───────────── -->
	<details class="group mt-14 max-w-5xl border-y border-base-content" bind:open={storyOpen}>
		<summary
			class="flex min-h-11 cursor-pointer list-none items-center gap-2 py-3 text-lg font-semibold"
		>
			<svg
				aria-hidden="true"
				viewBox="0 0 16 16"
				class="size-4 shrink-0 transition-transform group-open:rotate-90"
				fill="none"
				stroke="currentColor"
				stroke-width="1.75"
				stroke-linecap="round"
				stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg
			>
			How this was built, and why budget data is hard to work with
		</summary>
		<div class="max-w-3xl border-t border-base-300 pt-4 pb-8">
			<p class="leading-relaxed text-base-content/85">
				There is no single downloadable “California budget dataset”. To build this view of the
				<strong>{PIT_LABELS[ds.pit]} {ds.fy}</strong> we combined
				<strong>{st.filesDownloaded.toLocaleString()} files</strong>
				({bytesLabel(st.bytesDownloaded)}): machine-readable data from ebudget.ca.gov,
				{st.pdfPagesParsed.toLocaleString()} pages of PDFs and a chart published only as a picture. Amounts
				are written in {st.unitConventions.length} different ways and have to be matched up across {st
					.codeSystems.length} numbering systems.
			</p>

			<h3 class="mt-8 text-xl font-bold">What it took</h3>
			<dl class="mt-2">
				{#each effort as t (t.label)}
					<div class="border-b border-base-300 py-2">
						<div class="flex items-baseline gap-2">
							<dt class="font-semibold first-letter:uppercase">{t.label}</dt>
							<span class="dot-leader" aria-hidden="true"></span>
							<dd class="font-bold tabular-nums">{t.v.toLocaleString()}</dd>
						</div>
						<dd class="mt-0.5 text-sm leading-snug text-base-content/80">{t.sub}</dd>
					</div>
				{/each}
			</dl>

			<h3 class="mt-10 text-xl font-bold">
				What makes budget data hard to work with ({cat.painPoints.length})
			</h3>
			<p class="mt-1 text-sm text-base-content/80">
				Each one came up while building this explorer. Examples are measured from this budget.
			</p>
			<dl class="mt-3">
				{#each cat.painPoints as p (p.id)}
					{@const n = painCount(p.id)}
					<div
						id="pain-{p.id}"
						class="border-b border-base-300 py-4 {highlight === p.id ? 'bg-secondary/25 px-3' : ''}"
					>
						<dt class="font-bold">{p.title}</dt>
						<dd class="mt-1 text-sm leading-relaxed text-base-content/85">{p.body}</dd>
						{#if p.example}
							<dd class="mt-2 text-sm break-words">
								<span class="map-label text-xs">In this budget</span>
								<span class="text-base-content/85">{p.example}</span>
							</dd>
						{/if}
						{#if n}
							<dd>
								<button
									class="btn mt-2 btn-ghost btn-xs"
									aria-pressed={highlight === p.id}
									onclick={() => showPain(p.id)}
									>{highlight === p.id
										? 'Clear highlight'
										: `Show the ${n} source${n === 1 ? '' : 's'} affected on the map`}</button
								>
							</dd>
						{/if}
					</div>
				{/each}
			</dl>

			<h3 class="mt-8 text-base font-semibold">About this map</h3>
			<ul class="mt-1 list-disc space-y-1 pl-5 text-sm text-base-content/80">
				{#each cat.notes as n, i (i)}<li>{n}</li>{/each}
				<li>
					Map prepared {new Date(cat.generatedAt).toLocaleDateString(undefined, {
						dateStyle: 'long'
					})}.
				</li>
			</ul>
		</div>
	</details>
{/if}
