<script lang="ts">
	/** Table alternative to the route map: every flow as source → destination → amount. */
	import type { Flows } from '#lib/data/schema.ts';
	import { money, moneyFull } from '#lib/format.ts';

	interface Props {
		flows: Flows;
		caption: string;
	}
	let { flows, caption }: Props = $props();

	const byId = $derived(new Map(flows.nodes.map((n) => [n.id, n])));
	const rows = $derived(
		flows.links
			.filter((l) => l.value > 0)
			.map((l) => ({ l, s: byId.get(l.source), t: byId.get(l.target) }))
			.filter((r) => r.s && r.t)
			.sort((a, b) => a.s!.column - b.s!.column || b.l.value - a.l.value)
	);
</script>

<details class="group mt-8 border-t border-base-content text-sm">
	<summary
		class="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden"
	>
		<svg
			viewBox="0 0 12 12"
			class="size-3 shrink-0 transition-transform group-open:rotate-90"
			aria-hidden="true"
			><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" /></svg
		>
		Show every flow as a table ({rows.length} rows)
	</summary>
	<div class="overflow-x-auto pb-2">
		<table class="w-full border-collapse tabular-nums">
			<caption class="pb-2 text-left text-xs text-base-content/75">{caption}</caption>
			<thead>
				<tr class="map-label border-y border-base-content text-xs">
					<th scope="col" class="px-2 py-1.5 text-left font-semibold">From</th>
					<th scope="col" class="px-2 py-1.5 text-left font-semibold">To</th>
					<th scope="col" class="px-2 py-1.5 text-right font-semibold">Amount</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as r (r.l.source + '>' + r.l.target)}
					<tr class="border-b border-base-300">
						<td class="px-2 py-1.5">{r.s!.name}</td>
						<td class="px-2 py-1.5">{r.t!.name}</td>
						<td class="px-2 py-1.5 text-right whitespace-nowrap" title={moneyFull(r.l.value)}
							>{money(r.l.value)}</td
						>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</details>
