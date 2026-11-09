<script lang="ts">
	import type { LayoutProps } from './$types';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import CommandPalette from '#lib/components/CommandPalette.svelte';
	import { routes } from '#lib/paths.ts';

	let { data, children }: LayoutProps = $props();
	let searchOpen = $state(false);
	const ds = $derived(data.ds);
	// "2026-27 budget, enacted on June 29, 2026": publicationDate usually already names the
	// publication ("Enacted on June 29, 2026"), so don't repeat it
	const published = $derived.by(() => {
		const { fiscalYear, publication: pub, publicationDate: date } = ds.meta;
		if (!date) return `${fiscalYear} ${pub} budget`;
		return date.toLowerCase().startsWith(pub.toLowerCase())
			? `${fiscalYear} budget, ${date.charAt(0).toLowerCase()}${date.slice(1)}`
			: `${fiscalYear} ${pub} budget · ${date}`;
	});
	const fixture = $derived(ds.meta.notes.some((n) => /fixture/i.test(n)) || ds.fy === 'fixture');
</script>

<a
	href="#main"
	class="sr-only focus:btn focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:btn-sm"
	>Skip to content</a
>
<AppHeader {ds} onsearch={() => (searchOpen = true)} />

{#if fixture}
	<div class="bg-warning/15 px-4 py-1.5 text-center text-xs">
		<strong>Sample data.</strong> This dataset is a development fixture — amounts are illustrative, not
		official figures.
	</div>
{/if}

<main id="main" class="mx-auto max-w-screen-2xl px-4 pt-5 pb-6">
	{@render children()}
</main>

<footer class="mt-10 border-t border-base-content">
	<div
		class="mx-auto grid max-w-screen-2xl gap-x-10 gap-y-3 px-4 py-6 text-sm text-base-content/85 md:grid-cols-[minmax(0,1fr)_auto]"
	>
		<div class="max-w-prose space-y-2">
			<p class="map-label text-xs text-base-content">California Budget Explorer</p>
			<p>
				An independent explorer built from official State of California budget publications. Not
				affiliated with or endorsed by the State.
			</p>
			<p class="text-xs text-base-content/75">
				{published}. Amounts in the source are in thousands of dollars and are shown rounded. Page
				numbers and grid squares are this atlas’s own; official page numbers appear in each source
				citation.
			</p>
		</div>
		<div class="space-y-2 md:text-right">
			<p>
				<a class="text-primary" href={routes.dataSources(ds.fy, ds.pit)}
					>Where the numbers come from</a
				>
			</p>
			<p class="text-xs text-base-content/75">
				Data last updated {new Date(ds.meta.generatedAt).toLocaleDateString('en-US', {
					dateStyle: 'medium'
				})}
			</p>
		</div>
	</div>
</footer>

<CommandPalette fy={ds.fy} pit={ds.pit} dir={ds.dir} bind:open={searchOpen} />
