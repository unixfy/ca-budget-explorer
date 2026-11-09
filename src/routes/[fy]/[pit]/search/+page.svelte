<script lang="ts">
	import { untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import type { PageProps } from './$types';
	import type { SearchEntry } from '#lib/data/schema.ts';
	import { getSearch, getTree } from '#lib/data/load.ts';
	import { atlasIndex, type AtlasIndex } from '#lib/atlas.ts';
	import {
		prepare,
		searchCounted,
		entryHref,
		entryRef,
		entryTree,
		indexLetter,
		type Prepared
	} from '#lib/search.ts';
	import { KIND_LABEL, money } from '#lib/format.ts';
	import { routes } from '#lib/paths.ts';
	import PageTab from '#lib/components/atlas/PageTab.svelte';
	import IndexLine from '#lib/components/atlas/IndexLine.svelte';

	const LIMIT = 500;
	const SUGGESTIONS = ['schools', 'university', 'Medi-Cal', 'corrections', 'income tax', 'parks'];
	type Sort = 'match' | 'az';

	let { data }: PageProps = $props();
	const ds = $derived(data.ds);
	let q = $state(page.url.searchParams.get('q') ?? '');
	let sort = $state<Sort>(page.url.searchParams.get('sort') === 'az' ? 'az' : 'match');
	let items = $state.raw<Prepared[] | null>(null);
	let failed = $state(false);
	let kind = $state<SearchEntry['kind'] | 'all'>('all');
	let attempt = $state(0);

	$effect(() => {
		void attempt;
		const dir = ds.dir;
		let live = true;
		failed = false;
		items = null;
		getSearch(dir)
			.then((s) => live && (items = prepare(s)))
			.catch(() => live && (failed = true));
		return () => (live = false);
	});

	// a new query starts from "All"
	let lastQ = untrack(() => q);
	$effect(() => {
		if (q !== lastQ) {
			lastQ = q;
			kind = 'all';
		}
	});

	/** The address for the current query and order. */
	const target = $derived.by(() => {
		const base = routes.search(ds.fy, ds.pit, q.trim());
		return sort === 'az' ? `${base}${base.includes('?') ? '&' : '?'}sort=az` : base;
	});
	// keep ?q= (and ?sort=) in the address bar as you type (debounced), so refresh and share keep it
	$effect(() => {
		const t = target;
		const h = setTimeout(() => {
			if (page.url.pathname + page.url.search !== t) replaceState(t, page.state);
		}, 300);
		return () => clearTimeout(h);
	});
	// an outside navigation to this page with a different ?q= (e.g. from the header) wins
	let urlQ = page.url.searchParams.get('q') ?? '';
	$effect(() => {
		const next = page.url.searchParams.get('q') ?? '';
		if (next !== urlQ) {
			urlQ = next;
			if (next.trim() !== q.trim()) q = next;
		}
	});

	const all = $derived(items ? searchCounted(items, q, LIMIT) : null);
	const kinds = $derived(all ? [...all.byKind.entries()] : []);
	/** The chosen kind, or "all" when it no longer appears in the results. */
	const activeKind = $derived(kind !== 'all' && all?.byKind.has(kind) ? kind : 'all');
	const shown = $derived.by(() => {
		if (!all || !items) return null;
		if (activeKind === 'all') return all;
		return searchCounted(
			items.filter((i) => i.e.kind === activeKind),
			q,
			LIMIT
		);
	});
	/** Results as the reader sees them: best match first, or an A–Z index with letter heads. */
	const groups = $derived.by(() => {
		if (!shown) return [];
		if (sort === 'match') return [{ letter: '', rows: shown.results }];
		const sorted = [...shown.results].sort((a, b) =>
			a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true })
		);
		const out: { letter: string; rows: SearchEntry[] }[] = [];
		for (const r of sorted) {
			const l = indexLetter(r.name);
			if (out.at(-1)?.letter !== l) out.push({ letter: l, rows: [] });
			out.at(-1)!.rows.push(r);
		}
		return out;
	});

	// Page-and-grid references: load the atlas trees the results need, after the search
	// index, and fill references in as they arrive. Results never wait on them.
	const indexes = new SvelteMap<string, AtlasIndex>();
	let indexDir = '';
	$effect(() => {
		const dir = ds.dir;
		if (dir !== indexDir) {
			indexDir = dir;
			indexes.clear();
		}
		if (!shown) return;
		const need = new Set(shown.results.map(entryTree));
		for (const t of need) {
			if (untrack(() => indexes.has(t))) continue;
			getTree(dir, t)
				.then((root) => {
					if (dir === indexDir) indexes.set(t, atlasIndex(root, t));
				})
				.catch(() => {}); // references are a reading aid; the result still links to its page
		}
	});
	const refOf = (e: SearchEntry) => {
		const idx = indexes.get(entryTree(e));
		return idx ? entryRef(idx, e) : undefined;
	};

	const countText = $derived.by(() => {
		if (!shown || !q.trim()) return '';
		const what = activeKind === 'all' ? '' : ` ${KIND_LABEL[activeKind].toLowerCase()}`;
		if (!shown.total) return 'No matches.';
		if (shown.total > shown.results.length)
			return `Showing the first ${shown.results.length.toLocaleString()} of ${shown.total.toLocaleString()}${what} matches. Add a word to narrow it down.`;
		return `${shown.total.toLocaleString()}${what} match${shown.total === 1 ? '' : 'es'}.`;
	});

	function submit(e: SubmitEvent) {
		e.preventDefault();
		replaceState(target, page.state);
	}

	const tab = 'map-label border px-2 py-1 text-xs leading-none tabular-nums transition-colors';
	const tabOn = 'border-base-content bg-secondary text-secondary-content';
	const tabOff = 'border-base-300 hover:border-base-content';
</script>

<svelte:head><title>Street index · California Budget Explorer</title></svelte:head>

<PageTab page="Index" label="Street index" />
<h1 class="mt-3 font-sans text-4xl font-bold tracking-tight sm:text-5xl">Street index</h1>
<p class="mt-2 max-w-[65ch] text-base-content/80">
	Every agency, department, program, fund and revenue source, with its amount and the page and grid
	square where the atlas draws it.
</p>

<form onsubmit={submit} class="mt-5 flex max-w-2xl gap-2" role="search">
	<label class="input w-full">
		<span class="sr-only">Search the index</span>
		<svg
			aria-hidden="true"
			viewBox="0 0 16 16"
			class="size-4 shrink-0 opacity-70"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3.5 3.5" /></svg
		>
		<input
			type="search"
			bind:value={q}
			placeholder="Department, program, fund, revenue source, or code"
		/>
	</label>
	<button class="btn btn-primary">Search</button>
</form>

<p class="sr-only" aria-live="polite" aria-atomic="true">{countText}</p>

{#if failed}
	<div class="atlas-inset mt-6 max-w-2xl p-4" role="alert">
		<p class="font-semibold">The street index didn’t load.</p>
		<p class="mt-1 text-sm text-base-content/80">
			This is usually a network hiccup. Try again, or browse the
			<a class="text-primary underline" href={routes.tree(ds.fy, ds.pit, 'expenditures')}
				>spending</a
			>
			and
			<a class="text-primary underline" href={routes.tree(ds.fy, ds.pit, 'revenues')}>revenue</a> pages
			directly.
		</p>
		<button class="btn mt-3 btn-sm" onclick={() => attempt++}>Try again</button>
	</div>
{:else if !items || !shown || !all}
	<div class="mt-8" role="status" aria-label="Loading the street index">
		<span class="loading loading-dots"></span>
	</div>
{:else if q.trim()}
	{#if all.total}
		<div
			class="mt-5 flex flex-col gap-3 border-b border-base-content pb-3 sm:flex-row sm:items-end sm:justify-between"
		>
			<div class="flex flex-wrap gap-1.5" role="group" aria-label="Filter by kind">
				<button
					class="{tab} {activeKind === 'all' ? tabOn : tabOff}"
					aria-pressed={activeKind === 'all'}
					onclick={() => (kind = 'all')}>All {all.total.toLocaleString()}</button
				>
				{#each kinds as [k, n] (k)}
					<button
						class="{tab} {activeKind === k ? tabOn : tabOff}"
						aria-pressed={activeKind === k}
						onclick={() => (kind = k)}
					>
						{KIND_LABEL[k]}
						{n.toLocaleString()}
					</button>
				{/each}
			</div>
			<div class="flex shrink-0 items-center gap-1.5" role="group" aria-label="Order results">
				<span class="map-label text-xs text-base-content/80" aria-hidden="true">Order</span>
				<button
					class="{tab} {sort === 'match' ? tabOn : tabOff}"
					aria-pressed={sort === 'match'}
					onclick={() => (sort = 'match')}>Best match</button
				>
				<button
					class="{tab} {sort === 'az' ? tabOn : tabOff}"
					aria-pressed={sort === 'az'}
					onclick={() => (sort = 'az')}>A–Z</button
				>
			</div>
		</div>
		<p class="mt-3 max-w-[65ch] text-sm text-base-content/80">
			{countText} Each entry opens its page, which names the official source for the figure. Page numbers
			are this atlas’s own, not pages of a state document.
		</p>

		<div class="mt-2 max-w-4xl">
			{#each groups as g (g.letter)}
				{#if g.letter}
					<h2
						class="map-label mt-5 mb-1 border-b border-base-300 pb-0.5 text-lg"
						aria-label="Entries starting with {g.letter === '#' ? 'a number' : g.letter}"
					>
						{g.letter}
					</h2>
				{/if}
				<ul>
					{#each g.rows as r (r.id + r.tree)}
						{@const trail = r.path.join(' › ')}
						<IndexLine
							label={r.code ? `${r.name} · ${r.code}` : r.name}
							href={entryHref(ds.fy, ds.pit, r)}
							value={money(r.by)}
							ref={refOf(r)}
						>
							{#snippet detail()}
								<span class="map-label text-[0.6875rem]">{KIND_LABEL[r.kind]}</span>{#if trail}<span
										class="text-base-content/70"
										aria-hidden="true"
									>
										·
									</span><span title={trail}>{trail}</span>{/if}
							{/snippet}
						</IndexLine>
					{/each}
				</ul>
			{/each}
		</div>
	{:else}
		<div class="atlas-inset mt-6 max-w-2xl p-4">
			<p class="font-semibold">Nothing in the index matches “{q.trim()}”.</p>
			<p class="mt-1 text-sm text-base-content/80">
				Search looks for every word you type, so try fewer or shorter words, check the spelling, or
				use a department or program name instead of an abbreviation.
			</p>
			<div class="mt-3 flex flex-wrap items-center gap-1.5 text-sm">
				<span class="map-label text-xs text-base-content/80">Try</span>
				{#each SUGGESTIONS as s (s)}
					<button class="{tab} {tabOff}" onclick={() => (q = s)}>{s}</button>
				{/each}
				<button
					class="ml-1 text-primary underline-offset-2 hover:underline"
					onclick={() => (q = '')}>Clear search</button
				>
			</div>
		</div>
	{/if}
{:else}
	<p class="mt-6 max-w-[65ch] text-base-content/80">
		Type a department, program, fund or tax, such as
		{#each SUGGESTIONS.slice(0, 3) as s, i (s)}{i ? ', ' : ''}<button
				class="text-primary underline underline-offset-2"
				onclick={() => (q = s)}>{s}</button
			>{/each}. Tip: press <kbd class="kbd kbd-sm">/</kbd> anywhere to search.
	</p>
{/if}
