<script lang="ts">
	/**
	 * Small-screen alternative to the route map: three ranked index lists
	 * (revenue sources → funds → spending areas), set like an atlas street index:
	 * name ······ amount, with the item's tint and its page where it has one.
	 */
	import type { Flows, FlowNode } from '#lib/data/schema.ts';
	import type { AtlasRef } from '#lib/atlas.ts';
	import { money, pct } from '#lib/format.ts';
	import { settings } from '#lib/settings.svelte.ts';
	import { CASING, OTHER } from '#lib/viz/palette.ts';
	import { nodeValues, routeTints } from '#lib/viz/sankey.ts';
	import PageRef from '#lib/components/atlas/PageRef.svelte';

	interface Props {
		flows: Flows;
		onselect?: (n: FlowNode) => void;
		busyId?: string | null;
		/** Agency city tints from the Key Map, by node id. */
		agencyTints?: Map<string, string>;
		/** Atlas page of a node, when it has one. */
		refOf?: (id: string) => AtlasRef | undefined;
	}
	let { flows, onselect, busyId = null, agencyTints, refOf }: Props = $props();

	const values = $derived(nodeValues(flows.links));
	const cols = $derived(
		[...new Set(flows.nodes.map((n) => n.column))]
			.sort((a, b) => a - b)
			.map((c) =>
				flows.nodes
					.filter((n) => n.column === c && (values.get(n.id) ?? 0) > 0)
					.sort((a, b) => (values.get(b.id) ?? 0) - (values.get(a.id) ?? 0))
			)
	);
	const tints = $derived(routeTints(flows.nodes, values, settings.mode, agencyTints));
	const byId = $derived(new Map(flows.nodes.map((n) => [n.id, n])));

	/** The largest partners of a node on one side, as plain text. */
	function partners(n: FlowNode, dir: 'to' | 'from', k = 3): string {
		const ls = flows.links
			.filter((l) => (dir === 'to' ? l.source === n.id : l.target === n.id) && l.value > 0)
			.sort((a, b) => b.value - a.value);
		const names = ls
			.slice(0, k)
			.map((l) => byId.get(dir === 'to' ? l.target : l.source)?.name)
			.filter(Boolean);
		const more = ls.length > k ? ` and ${ls.length - k} more` : '';
		return names.length ? `${dir === 'to' ? 'To' : 'From'} ${names.join(', ')}${more}` : '';
	}

	const TITLES = ['Where it comes from', 'Which funds it goes through', 'What it pays for'];
</script>

<div class="space-y-8">
	{#each cols as col, ci (ci)}
		{@const colTotal = col.reduce((a, n) => a + (values.get(n.id) ?? 0), 0)}
		{@const max = values.get(col[0]?.id ?? '') ?? 1}
		<section aria-labelledby="flowlist-{ci}">
			<h2
				id="flowlist-{ci}"
				class="flex items-baseline justify-between gap-2 border-b border-base-content pb-1 text-lg font-semibold"
			>
				<span>{TITLES[Math.min(ci, TITLES.length - 1)]}</span>
				<span class="text-base font-semibold tabular-nums">{money(colTotal)}</span>
			</h2>
			<ol class="divide-y divide-base-300">
				{#each col as n (n.id)}
					{@const v = values.get(n.id) ?? 0}
					{@const sub = partners(n, ci === cols.length - 1 ? 'from' : 'to')}
					{@const ref = refOf?.(n.id)}
					<li>
						<button
							type="button"
							class="flex min-h-11 w-full flex-col gap-1.5 py-2.5 text-left hover:bg-base-200"
							aria-busy={busyId === n.id}
							onclick={() => onselect?.(n)}
						>
							<span class="flex w-full items-baseline gap-2">
								<span class="min-w-0 font-medium">{n.name}</span>
								<span class="dot-leader" aria-hidden="true"></span>
								<span class="shrink-0 tabular-nums">
									{#if busyId === n.id}<span
											class="loading loading-xs loading-spinner align-middle"
											aria-hidden="true"
										></span>{/if}
									{money(v)}
								</span>
							</span>
							<span class="flex items-center gap-2" aria-hidden="true">
								<span class="block h-2 flex-1">
									<span
										class="block h-full"
										style:width="{Math.max(1, (v / max) * 100)}%"
										style:background={tints.get(n.id) ?? OTHER[settings.mode]}
										style:outline="1px solid {CASING[settings.mode]}"
										style:outline-offset="-1px"
									></span>
								</span>
							</span>
							<span
								class="flex flex-wrap items-baseline justify-between gap-x-3 text-xs leading-snug text-base-content/80"
							>
								<span>{sub}</span>
								<span class="flex items-baseline gap-2">
									<span class="tabular-nums">{pct(v / (colTotal || 1))}</span>
									<PageRef {ref} />
								</span>
							</span>
						</button>
					</li>
				{/each}
			</ol>
		</section>
	{/each}
</div>
