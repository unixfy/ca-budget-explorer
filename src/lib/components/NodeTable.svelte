<script lang="ts">
	/**
	 * The atlas index table for a page: a node's children with 3-year amounts,
	 * year-over-year change, share, and where each sits on the map (page and square).
	 * Sortable; every column header is a button.
	 */
	import type { BudgetNode } from '#lib/data/schema.ts';
	import {
		money,
		moneyFull,
		pct,
		valueOf,
		delta,
		KIND_LABEL,
		num,
		type YearKey
	} from '#lib/format.ts';
	import { settings } from '#lib/settings.svelte.ts';
	import DeltaBadge from './DeltaBadge.svelte';
	import PageRef from './atlas/PageRef.svelte';
	import type { AtlasRef } from '#lib/atlas.ts';
	import { KIND_HELP, JARGON_KINDS } from './tree/a11y.ts';

	interface Props {
		node: BudgetNode;
		colors?: Map<string, string>;
		years: { py: string; cy: string; by: string };
		onselect?: (chain: BudgetNode[]) => void;
		hrefFor?: (n: BudgetNode) => string | null;
		caption?: string;
		/** id on the table wrapper, so a "see the table" link can jump here */
		id?: string;
		/** atlas reference for a row (page and grid square), when the tree is indexed */
		refOf?: (n: BudgetNode) => AtlasRef | undefined;
	}
	let { node, colors, years, onselect, hrefFor, caption, id, refOf }: Props = $props();

	type SortKey = 'name' | YearKey | 'delta' | 'positions';
	let sort = $state<SortKey>('by');
	let asc = $state(false);

	const kids = $derived(node.children ?? []);
	const val = (n: BudgetNode, y: YearKey) => valueOf(n, y, settings.fund);
	const parentVal = $derived(val(node, settings.year));
	const hasPositions = $derived(kids.some((k) => k.positions?.by != null));
	const kind = $derived(kids[0]?.kind);
	const kindLabel = $derived(kind ? KIND_LABEL[kind] : 'Item');
	/** plain explanation shown above the table when the row label is budget jargon */
	const kindHelp = $derived(kind && JARGON_KINDS.has(kind) ? KIND_HELP[kind] : undefined);
	const refs = $derived(new Map(kids.map((k) => [k.id, refOf?.(k)])));
	const hasRefs = $derived([...refs.values()].some(Boolean));
	const colCount = $derived(6 + (hasPositions ? 1 : 0) + (hasRefs ? 1 : 0));

	const rows = $derived.by(() => {
		const r = [...kids];
		const key = (n: BudgetNode): number | string => {
			if (sort === 'name') return n.name.toLowerCase();
			if (sort === 'delta')
				return delta(val(n, settings.compare), val(n, settings.year))?.abs ?? -Infinity;
			if (sort === 'positions') return n.positions?.by ?? -Infinity;
			return val(n, sort) ?? -Infinity;
		};
		r.sort((a, b) => {
			const ka = key(a);
			const kb = key(b);
			const c = ka < kb ? -1 : ka > kb ? 1 : 0;
			return asc ? c : -c;
		});
		return r;
	});

	function setSort(k: SortKey) {
		if (sort === k) asc = !asc;
		else {
			sort = k;
			asc = k === 'name';
		}
	}
	const aria = (k: SortKey) => (sort === k ? (asc ? 'ascending' : 'descending') : 'none');
	const yearCols: YearKey[] = ['py', 'cy', 'by'];
</script>

{#snippet th(k: SortKey, label: string, cls = 'text-right', help?: string)}
	<th class={cls} aria-sort={aria(k)} title={help}>
		<button
			type="button"
			class="map-label inline-flex cursor-pointer items-center gap-1 hover:text-primary"
			onclick={() => setSort(k)}
		>
			{label}
			<svg
				aria-hidden="true"
				viewBox="0 0 10 10"
				class="size-2.5 shrink-0 {sort === k ? '' : 'invisible'}"
				fill="currentColor"
				><path d={asc ? 'M5 2 9 8H1z' : 'M5 8 1 2h8z'} /></svg
			>
		</button>
	</th>
{/snippet}

{#snippet swatch(c: string | undefined)}
	<span
		aria-hidden="true"
		class="inline-block size-3 shrink-0 border border-base-content"
		style:background={c ?? 'var(--color-base-300)'}
	></span>
{/snippet}

<div class="overflow-x-auto border-y border-base-content" {id}>
	<table
		class="table table-sm [&_tbody_tr]:border-base-300 [&_tfoot]:border-t [&_tfoot]:border-base-content [&_tfoot_th]:text-base-content"
	>
		{#if caption || kindHelp}
			<caption class={kindHelp ? 'px-3 py-2 text-left text-xs text-base-content/75' : 'sr-only'}>
				{#if caption}<span class="sr-only">{caption}. </span>{/if}
				{#if kindHelp}<span
						><strong class="font-semibold text-base-content/80">{kindLabel}:</strong>
						{kindHelp}</span
					>{/if}
			</caption>
		{/if}
		<thead>
			<tr class="border-base-content/40 bg-base-200 text-xs text-base-content">
				{@render th('name', kindLabel, 'text-left', kind ? KIND_HELP[kind] : undefined)}
				{#each yearCols as y (y)}
					{@render th(y, years[y])}
				{/each}
				{@render th(
					'delta',
					settings.hasCompare ? `Change vs ${years[settings.compare]}` : 'Change'
				)}
				<th class="text-right" title="Share of {node.name}">Share</th>
				{#if hasPositions}{@render th(
						'positions',
						'Positions',
						'text-right',
						'Number of full-time staff positions'
					)}{/if}
				{#if hasRefs}<th class="map-label text-right" title="Where it is on the map: page and grid square"
						>Page</th
					>{/if}
			</tr>
		</thead>
		<tbody>
			{#each rows as n (n.id)}
				{@const v = val(n, settings.year)}
				{@const share = parentVal ? (v ?? 0) / parentVal : null}
				{@const link = hrefFor?.(n)}
				{@const drill = !!(n.children?.length || n.detailRef)}
				<tr class="hover:bg-base-200/60">
					<td class="max-w-[22rem]">
						<div class="flex items-center gap-2">
							{@render swatch(colors?.get(n.id))}
							{#if drill && onselect}
								<button class="link text-left link-hover" onclick={() => onselect([n])}
									>{n.name}</button
								>
							{:else if link}
								<a class="link link-hover" href={link}>{n.name}</a>
							{:else}
								<span>{n.name}</span>
							{/if}
							{#if n.code}<span
									class="font-map text-xs text-base-content/70 tabular-nums"
									title="Budget code">{n.code}</span
								>{/if}
						</div>
					</td>
					{#each yearCols as y (y)}
						<td
							class="text-right tabular-nums {y === settings.year
								? 'font-semibold'
								: 'text-base-content/75'}"
							title={moneyFull(val(n, y))}
						>
							{money(val(n, y))}
						</td>
					{/each}
					<td class="text-right"><DeltaBadge from={val(n, settings.compare)} to={v} /></td>
					<td class="w-28 text-right tabular-nums">
						<div class="flex items-center justify-end gap-2">
							<div aria-hidden="true" class="hidden h-1.5 w-12 overflow-hidden bg-base-300 sm:block">
								<div
									class="h-full bg-base-content/70"
									style:width="{Math.max(0, Math.min(1, share ?? 0)) * 100}%"
								></div>
							</div>
							<span class="text-xs">{pct(share)}</span>
						</div>
					</td>
					{#if hasPositions}<td class="text-right tabular-nums">{num(n.positions?.by, 1)}</td>{/if}
					{#if hasRefs}<td class="text-right"><PageRef ref={refs.get(n.id)} /></td>{/if}
				</tr>
			{:else}
				<tr
					><td colspan={colCount} class="text-center text-base-content/75">No line items below this level.</td
					></tr
				>
			{/each}
		</tbody>
		{#if rows.length}
			<tfoot>
				<tr>
					<th class="text-left">Total</th>
					{#each yearCols as y (y)}
						<th class="text-right tabular-nums">{money(val(node, y))}</th>
					{/each}
					<th class="text-right"
						><DeltaBadge from={val(node, settings.compare)} to={parentVal} /></th
					>
					<th></th>
					{#if hasPositions}<th class="text-right tabular-nums">{num(node.positions?.by, 1)}</th
						>{/if}
					{#if hasRefs}<th></th>{/if}
				</tr>
			</tfoot>
		{/if}
	</table>
</div>
