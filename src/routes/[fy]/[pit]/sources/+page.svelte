<script lang="ts">
	import type { PageProps } from './$types';
	import { PIT_LABELS } from '#lib/data/schema.ts';
	import SourceList from '#lib/components/SourceList.svelte';
	import SourcesTabs from '#lib/components/sources/SourcesTabs.svelte';
	import PageTab from '#lib/components/atlas/PageTab.svelte';
	import { money } from '#lib/format.ts';
	import { routes } from '#lib/paths.ts';

	let { data }: PageProps = $props();
	const ds = $derived(data.ds);
	const meta = $derived(data.ds.meta);

	/** Plain names for the dataset's counts (keys are data-file field names). */
	const COUNT_LABEL: Record<string, [string, string]> = {
		agencies: ['agency', 'agencies'],
		departments: ['department', 'departments'],
		programs: ['program', 'programs'],
		funds: ['fund', 'funds'],
		lineItems: ['line item', 'line items']
	};
	const countLabel = (k: string, v: number) => {
		const l = COUNT_LABEL[k];
		if (l) return l[v === 1 ? 0 : 1];
		return k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
	};
</script>

<svelte:head><title>Notes & known gaps · Sources · California Budget Explorer</title></svelte:head>

<PageTab page="iv" label="Notes & known gaps" />
<h1 class="mt-3 text-4xl font-bold tracking-tight text-balance sm:text-5xl">
	Notes &amp; known gaps
</h1>

<article class="max-w-3xl">
	<p class="mt-3 text-lg leading-relaxed text-base-content/85">
		This explorer shows the <strong>{PIT_LABELS[meta.pit]}</strong> for fiscal year
		<strong>{meta.years.by}</strong>, published {meta.publicationDate}. It is an independent site,
		not an official State of California publication, and every figure comes from the state’s own
		budget documents.
	</p>

	<SourcesTabs fy={ds.fy} pit={ds.pit} current="notes" class="mt-8" />

	<section aria-labelledby="read-h" class="mt-8">
		<h2 id="read-h" class="text-2xl font-bold">Reading the numbers</h2>
		<ul class="mt-2 list-disc space-y-1.5 pl-5 leading-relaxed">
			<li>
				Every publication reports three years: <strong>{meta.years.py}</strong> (what was actually
				spent), <strong>{meta.years.cy}</strong> (the current year’s estimate) and
				<strong>{meta.years.by}</strong> (the budget year).
			</li>
			<li>
				Official figures are published in thousands of dollars. This site rounds them for display
				(for example {money(meta.totals.expenditures.by)}); hover any amount in a table to see the
				full figure.
			</li>
		</ul>
	</section>

	<section aria-labelledby="cov-h" class="mt-8">
		<h2 id="cov-h" class="text-2xl font-bold">What’s included</h2>
		<dl class="mt-3 max-w-sm">
			{#each Object.entries(meta.counts) as [k, v] (k)}
				<div class="flex items-baseline gap-2 border-b border-base-300 py-1.5">
					<dt class="first-letter:uppercase">{countLabel(k, v)}</dt>
					<span class="dot-leader" aria-hidden="true"></span>
					<dd class="font-semibold tabular-nums">{v.toLocaleString()}</dd>
				</div>
			{/each}
		</dl>
	</section>

	{#if meta.notes.length}
		<section aria-labelledby="gaps-h" class="mt-8">
			<h2 id="gaps-h" class="text-2xl font-bold">Known gaps and choices we made</h2>
			<p class="mt-2 leading-relaxed">
				Spending totals leave out money that would otherwise be counted twice, such as payments
				between departments, and money the state holds for others, such as university and pension
				trust funds. Revenue covers state taxes and fees; federal money and bond proceeds appear in
				the money flows instead. Where two official sources disagree, we say so rather than adjust
				the numbers: see
				<a
					class="text-primary underline underline-offset-2"
					href={routes.reconciliation(ds.fy, ds.pit)}>Does it add up?</a
				>
			</p>
			<details class="group mt-4 border-y border-base-300">
				<summary class="flex min-h-11 cursor-pointer list-none items-center gap-2 py-2 font-medium">
					<svg
						aria-hidden="true"
						viewBox="0 0 16 16"
						class="size-3.5 shrink-0 transition-transform group-open:rotate-90"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"
						stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg
					>
					Technical notes ({meta.notes.length})
				</summary>
				<ul
					class="list-disc space-y-2 border-t border-base-300 py-3 pr-2 pl-9 text-sm leading-relaxed"
				>
					{#each meta.notes as n, i (i)}<li class="break-words">{n}</li>{/each}
				</ul>
			</details>
		</section>
	{/if}

	<div class="mt-8">
		<SourceList sources={meta.sources} title="Official sources for this budget" />
	</div>
	<p class="mt-4 text-sm text-base-content/75">
		Data prepared {new Date(meta.generatedAt).toLocaleDateString(undefined, {
			dateStyle: 'long'
		})}.
	</p>
</article>
