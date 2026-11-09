<script lang="ts">
	/** Stacked bar of a node's amounts by fund type, as cased tint blocks with a legend. */
	import type { FundType, Triple } from '#lib/data/schema.ts';
	import { FUND_TYPE_LABEL, money, pct, type YearKey } from '#lib/format.ts';
	import { CATEGORICAL, CASING } from '#lib/viz/palette.ts';
	import { settings } from '#lib/settings.svelte.ts';

	interface Props {
		byFundType?: Partial<Record<FundType, Triple>>;
		year?: YearKey;
	}
	let { byFundType, year }: Props = $props();
	// fixed slot per fund type so color always follows the fund type
	const ORDER: FundType[] = [
		'general',
		'federal',
		'special',
		'bond',
		'reimbursement',
		'nongovernmental',
		'other'
	];
	const y = $derived(year ?? settings.year);
	const parts = $derived(
		ORDER.map((t, i) => ({ t, i, v: Math.max(0, byFundType?.[t]?.[y] ?? 0) })).filter(
			(p) => p.v > 0
		)
	);
	const total = $derived(parts.reduce((a, p) => a + p.v, 0));
	const color = (i: number) => CATEGORICAL[settings.mode][i];
	const casing = $derived(CASING[settings.mode]);
</script>

{#if total > 0}
	<div>
		<div
			class="flex h-4 w-full border"
			style:border-color={casing}
			role="img"
			aria-label="Funding by fund type: {parts
				.map((p) => `${FUND_TYPE_LABEL[p.t]} ${pct(p.v / total, 0)}`)
				.join(', ')}"
		>
			{#each parts as p, k (p.t)}
				<div
					class="h-full"
					style:width="{(p.v / total) * 100}%"
					style:background={color(p.i)}
					style:border-left={k ? `1px solid ${casing}` : undefined}
					title="{FUND_TYPE_LABEL[p.t]}: {money(p.v)}"
				></div>
			{/each}
		</div>
		<ul class="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
			{#each parts as p (p.t)}
				<li class="flex items-baseline gap-2">
					<span
						aria-hidden="true"
						class="inline-block size-3 shrink-0 translate-y-0.5 border"
						style:background={color(p.i)}
						style:border-color={casing}
					></span>
					<span class="min-w-0">{FUND_TYPE_LABEL[p.t]}</span>
					<span class="ml-auto text-base-content/80 tabular-nums"
						>{money(p.v)} · {pct(p.v / total, 0)}</span
					>
				</li>
			{/each}
		</ul>
	</div>
{/if}
