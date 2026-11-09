<script lang="ts">
	/** Side panel: details of one catalog node (or one data product) of the sources tree. */
	import type {
		CatalogNode,
		CatalogPainPoint,
		Product,
		SourcesCatalog
	} from '#lib/data/sources-catalog.ts';
	import { settings } from '#lib/settings.svelte.ts';
	import {
		type Agg,
		bytesLabel,
		dominantFormat,
		findPath,
		formatColor,
		FORMAT_LABEL,
		LEVEL_LABEL,
		PRODUCT_LABEL
	} from '#lib/viz/sourceTree.ts';

	interface Props {
		catalog: SourcesCatalog;
		agg: Map<string, Agg>;
		selected: string | null;
		productHref: (p: Product) => string | null;
		onselect: (id: string) => void;
		onpain: (id: string) => void;
	}
	let { catalog, agg, selected, productHref, onselect, onpain }: Props = $props();

	const productId = $derived(
		selected?.startsWith('product:') ? (selected.slice(8) as Product) : null
	);
	const path = $derived(selected && !productId ? (findPath(catalog.root, selected) ?? null) : null);
	const node = $derived(path?.[path.length - 1] ?? null);
	const a = $derived(node ? agg.get(node.id) : undefined);
	const pains = $derived(
		node
			? catalog.painPoints.filter((p) =>
					(node.children?.length ? [...(a?.pain ?? [])] : (node.pain ?? [])).includes(p.id)
				)
			: ([] as CatalogPainPoint[])
	);

	/** For a product: the document types / documents that feed it, with citation counts. */
	const feeders = $derived.by(() => {
		if (!productId) return [];
		const out: { node: CatalogNode; trail: string; cites: number }[] = [];
		const go = (n: CatalogNode, trail: string[]) => {
			if (n.level === 'docType' || (!n.children?.length && n.level !== 'root')) {
				const g = agg.get(n.id);
				if (g?.used && g.feeds.has(productId)) {
					out.push({ node: n, trail: trail.slice(1).join(' › '), cites: g.backs[productId] ?? 0 });
				}
				return;
			}
			for (const c of n.children ?? []) go(c, [...trail, n.name]);
		};
		go(catalog.root, []);
		return out.sort((x, y) => y.cites - x.cites);
	});
	const prod = $derived(productId ? catalog.products.find((p) => p.id === productId) : null);
	const backsEntries = (b: Partial<Record<Product, number>> | undefined) =>
		Object.entries(b ?? {}).sort((x, y) => y[1] - x[1]) as [Product, number][];
	const tag =
		'map-label inline-flex items-center border px-1.5 py-0.5 text-[0.6875rem] leading-none';
</script>

<aside class="atlas-inset p-4 text-sm" aria-live="polite" aria-label="Source details">
	{#if prod && productId}
		<h3 class="text-lg leading-snug font-bold">{PRODUCT_LABEL[productId]}</h3>
		<p class="text-xs text-base-content/75">
			A part of this explorer{prod.nodes ? `, with ${prod.nodes.toLocaleString()} items` : ''}
		</p>
		<p class="mt-3">
			Built from <strong>{feeders.length}</strong> kind{feeders.length === 1 ? '' : 's'} of official source:
		</p>
		<ul class="mt-2 space-y-1.5">
			{#each feeders as f (f.node.id)}
				<li>
					<button
						class="text-left text-primary hover:underline"
						onclick={() => onselect(f.node.id)}
						title="Show on the map">{f.node.name}</button
					>
					<span class="block text-xs text-base-content/75"
						>{f.trail}{f.cites ? ` · cited by ${f.cites.toLocaleString()} figures` : ''}</span
					>
				</li>
			{/each}
		</ul>
		{@const href = productHref(productId)}
		{#if href}<a class="btn mt-4 btn-primary btn-sm" {href}>Open {PRODUCT_LABEL[productId]}</a>{/if}
	{:else if node && path}
		<nav aria-label="Where this sits" class="text-xs text-base-content/75">
			{#each path.slice(1, -1) as p (p.id)}
				<button class="text-primary hover:underline" onclick={() => onselect(p.id)}>{p.name}</button
				>
				<span aria-hidden="true"> / </span>
			{/each}
		</nav>
		<h3 class="mt-2 text-lg leading-snug font-bold">{node.name}</h3>
		<p class="map-label text-xs text-base-content/75">{LEVEL_LABEL[node.level]}</p>
		<div class="mt-2 flex flex-wrap gap-1.5">
			{#if node.missing}
				<span class="{tag} border-warning bg-warning text-warning-content"
					>Expected, but not published</span
				>
			{:else if node.used}
				<span class="{tag} border-base-content">Used by this explorer</span>
			{:else}
				<span class="{tag} border-dashed border-base-content/60">Not used by this explorer</span>
			{/if}
			{#if node.kind === 'analysis'}
				<span class="{tag} border-warning bg-warning text-warning-content"
					>Analysis, not official budget data</span
				>
			{:else if node.kind === 'reference'}
				<span class="{tag} border-base-300">Reference / code list</span>
			{/if}
			{#each node.formats ?? [] as f (f)}
				<span class="{tag} gap-1 border-base-300">
					<span
						class="inline-block size-2.5 rounded-full border border-base-content"
						style="background:{formatColor(f, settings.mode)}"
					></span>{FORMAT_LABEL[f]}
				</span>
			{/each}
		</div>
		{#if node.description}<p class="mt-3">{node.description}</p>{/if}

		<dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
			{#if node.units}<dt class="text-base-content/75">Units</dt>
				<dd>{node.units}</dd>{/if}
			{#if node.years}<dt class="text-base-content/75">Years</dt>
				<dd>{node.years}</dd>{/if}
			{#if node.granularity}<dt class="text-base-content/75">Level of detail</dt>
				<dd>{node.granularity}</dd>{/if}
			{#if a && (node.children?.length || node.count)}
				<dt class="text-base-content/75">Documents</dt>
				<dd>
					{a.docs.toLocaleString()}{a.docsUsed ? ` (${a.docsUsed.toLocaleString()} used)` : ''}
				</dd>
			{/if}
			{#if a?.files}<dt class="text-base-content/75">Downloaded</dt>
				<dd>
					{a.files.toLocaleString()} file{a.files === 1 ? '' : 's'} · {bytesLabel(a.bytes)}
				</dd>{/if}
			{#if a?.pages}<dt class="text-base-content/75">PDF pages</dt>
				<dd>{a.pages.toLocaleString()}</dd>{/if}
			{#if a && !node.children?.length && dominantFormat(node, a) === 'PNG'}
				<dt class="text-base-content/75">Extraction</dt>
				<dd>Typed in by hand from images</dd>
			{/if}
		</dl>

		{#if a && backsEntries(a.backs).length}
			<h4 class="map-label mt-4 text-xs">Figures citing it, by page</h4>
			<ul class="mt-1 space-y-0.5">
				{#each backsEntries(a.backs) as [p, n] (p)}
					{@const href = productHref(p)}
					<li class="flex items-baseline gap-2">
						{#if href}<a class="text-primary hover:underline" {href}>{PRODUCT_LABEL[p]}</a
							>{:else}<span>{PRODUCT_LABEL[p]}</span>{/if}
						<span class="dot-leader" aria-hidden="true"></span>
						<span class="tabular-nums">{n.toLocaleString()}</span>
					</li>
				{/each}
			</ul>
		{:else if a?.feeds.size}
			<p class="mt-3 text-xs text-base-content/80">
				Feeds: {[...a.feeds].map((p) => PRODUCT_LABEL[p]).join(', ')}
			</p>
		{/if}

		{#if pains.length}
			<h4 class="map-label mt-4 text-xs">Quirks to know about</h4>
			<ul class="mt-1 space-y-1">
				{#each pains as p (p.id)}
					<li>
						<button class="text-left text-primary hover:underline" onclick={() => onpain(p.id)}
							>{p.title}</button
						>
					</li>
				{/each}
			</ul>
		{/if}

		{#if node.examples?.length}
			<h4 class="map-label mt-4 text-xs">Examples</h4>
			<ul class="mt-1 space-y-0.5">
				{#each node.examples as ex (ex.url)}
					<li>
						<a
							class="text-primary hover:underline"
							href={ex.url}
							target="_blank"
							rel="noopener noreferrer"
							>{ex.label}<svg
								aria-hidden="true"
								viewBox="0 0 16 16"
								class="ml-1 inline size-3 align-[-1px]"
								fill="none"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"><path d="M9 3h4v4M13 3 7 9M11 9.5V13H3V5h3.5" /></svg
							><span class="sr-only">(opens in a new tab)</span></a
						>
					</li>
				{/each}
			</ul>
		{/if}

		{#if node.children?.length}
			<h4 class="map-label mt-4 text-xs">Contains ({node.children.length})</h4>
			<ul class="mt-1 max-h-48 space-y-0.5 overflow-y-auto">
				{#each node.children as c (c.id)}
					<li>
						<button
							class="text-left text-primary hover:underline {c.used
								? ''
								: 'text-base-content/75 italic'}"
							onclick={() => onselect(c.id)}>{c.name}</button
						>
					</li>
				{/each}
			</ul>
		{/if}

		{#if node.url}
			<a
				class="btn mt-4 btn-outline btn-sm"
				href={node.url}
				target="_blank"
				rel="noopener noreferrer"
				>Open official source<svg
					aria-hidden="true"
					viewBox="0 0 16 16"
					class="ml-1 inline size-3 align-[-1px]"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"><path d="M9 3h4v4M13 3 7 9M11 9.5V13H3V5h3.5" /></svg
				><span class="sr-only">(opens in a new tab)</span></a
			>
			{#if node.verified === false}
				<p class="mt-1 text-xs text-base-content/75">
					Link not verified automatically: the site blocks scripted requests.
				</p>
			{/if}
		{/if}
	{:else}
		<p class="text-base-content/75">
			Select any roundel on the map, or one of this site’s page tabs on its right, to see what the
			source is, what format and units it uses, and which figures here rely on it.
		</p>
	{/if}
</aside>
