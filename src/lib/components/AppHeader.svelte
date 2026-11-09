<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { Dataset } from '#lib/data/load.ts';
	import { PIT_LABELS, type Pit } from '#lib/data/schema.ts';
	import { settings } from '#lib/settings.svelte.ts';
	import { routes, href } from '#lib/paths.ts';
	import { FUND_FILTER_OPTIONS, type YearKey } from '#lib/format.ts';

	interface Props {
		ds: Dataset;
		onsearch: () => void;
	}
	let { ds, onsearch }: Props = $props();

	const base = $derived(`/${ds.fy}/${ds.pit}`);
	const nav = $derived([
		{ label: 'Overview', href: routes.home(ds.fy, ds.pit), match: (p: string) => p === base },
		{
			label: 'Spending',
			href: routes.tree(ds.fy, ds.pit, 'expenditures'),
			match: (p: string) =>
				p.startsWith(base + '/expenditures') || p.startsWith(base + '/department')
		},
		{
			label: 'By type',
			href: routes.tree(ds.fy, ds.pit, 'bytype'),
			match: (p: string) => p.startsWith(base + '/bytype')
		},
		{
			label: 'Revenue',
			href: routes.tree(ds.fy, ds.pit, 'revenues'),
			match: (p: string) => p.startsWith(base + '/revenues')
		},
		{
			label: 'Flows',
			href: routes.flows(ds.fy, ds.pit),
			match: (p: string) => p.startsWith(base + '/flows')
		},
		{
			label: 'Reconciliation',
			href: routes.reconciliation(ds.fy, ds.pit),
			match: (p: string) => p.startsWith(base + '/reconciliation')
		},
		{
			// one entry for both provenance pages (they share tabs)
			label: 'Sources',
			href: routes.dataSources(ds.fy, ds.pit),
			match: (p: string) => p.startsWith(base + '/data-sources') || p.startsWith(base + '/sources')
		}
	]);
	const path = $derived(page.url.pathname);

	const datasetKey = (fy: string, pit: string) => `${fy}|${pit}`;
	const listed = $derived(
		ds.manifest.datasets.some((d) => d.fiscalYear === ds.fy && d.pit === ds.pit)
			? ds.manifest.datasets
			: [
					...ds.manifest.datasets,
					{ fiscalYear: ds.fy, pit: ds.pit, publication: ds.meta.publication, path: ds.dir }
				]
	);
	function switchDataset(e: Event) {
		const [fy, pit] = (e.currentTarget as HTMLSelectElement).value.split('|');
		const rest = page.url.pathname.split('/').slice(3).join('/');
		goto(href(`/${fy}/${pit}${rest ? '/' + rest : ''}`) + page.url.search);
	}
	const years: YearKey[] = ['by', 'cy', 'py'];
	const funds = FUND_FILTER_OPTIONS;
	const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
	const themes = [
		{ v: 'system', label: 'Auto' },
		{ v: 'light', label: 'Light' },
		{ v: 'dark', label: 'Dark' }
	] as const;
	const fundOption = $derived(funds.find((f) => f.v === settings.fund) ?? funds[0]);

	// "View" settings panel: year, funds, publication and theme in one place, so the sticky
	// header stays at two short rows on phones
	let viewOpen = $state(false);
	let viewWrap: HTMLElement | undefined = $state();
	let viewButton: HTMLButtonElement | undefined = $state();
	function onWindowKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && viewOpen) {
			viewOpen = false;
			viewButton?.focus();
		}
	}
	function onWindowClick(e: MouseEvent) {
		if (viewOpen && viewWrap && !viewWrap.contains(e.target as Node)) viewOpen = false;
	}
</script>

<svelte:window onkeydown={onWindowKey} onclick={onWindowClick} />

<header class="sticky top-0 z-30 border-b border-base-content bg-base-100">
	<div class="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-x-5 gap-y-0 px-4">
		<a
			href={routes.home(ds.fy, ds.pit)}
			class="flex min-h-11 items-center gap-2 no-underline"
			aria-label="California Budget Explorer, Key Map"
		>
			<span
				aria-hidden="true"
				class="map-label bg-base-content px-1.5 py-0.5 text-xs leading-none text-base-100">CA</span
			>
			<span class="map-label hidden text-sm sm:inline">California Budget Explorer</span>
			<span class="map-label text-sm sm:hidden">CA Budget Explorer</span>
		</a>

		<nav
			aria-label="Main"
			class="order-last -mx-4 w-[calc(100%+2rem)] overflow-x-auto border-t border-base-300 px-4 xl:order-none xl:mx-0 xl:w-auto xl:border-t-0 xl:px-0"
		>
			<ul class="flex flex-nowrap">
				{#each nav as n (n.label)}
					{@const on = n.match(path)}
					<li>
						<a
							href={n.href}
							class="map-label flex min-h-11 items-center px-3 text-sm whitespace-nowrap no-underline {on
								? 'bg-base-content text-base-100'
								: 'hover:bg-base-200'}"
							aria-current={on ? 'page' : undefined}>{n.label}</a
						>
					</li>
				{/each}
			</ul>
		</nav>

		<div class="ml-auto flex items-center gap-1">
			<span class="map-label hidden pr-2 text-xs text-base-content/75 2xl:inline"
				>{ds.meta.fiscalYear} {ds.meta.publication}</span
			>
			<button
				class="map-label inline-flex min-h-11 items-center gap-2 px-2 text-sm hover:bg-base-200"
				onclick={onsearch}
				title="Street index ({mac ? '⌘' : 'Ctrl'} K)"
			>
				<svg
					class="size-4"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg
				>
				<span>Street index</span>
				<kbd class="kbd hidden font-sans kbd-xs lg:inline-flex">{mac ? '⌘' : 'Ctrl'} K</kbd>
			</button>

			<div class="relative" bind:this={viewWrap}>
				<button
					bind:this={viewButton}
					class="map-label inline-flex min-h-11 items-center gap-2 px-2 text-sm hover:bg-base-200 aria-expanded:bg-base-200"
					aria-expanded={viewOpen}
					aria-controls="view-panel"
					onclick={() => (viewOpen = !viewOpen)}
				>
					<svg
						class="size-4"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						aria-hidden="true"
						><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle
							cx="16"
							cy="6"
							r="2"
						/><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg
					>
					<span>View</span>
					<span class="hidden text-base-content/75 normal-case md:inline"
						>{ds.meta.years[settings.year]} · {fundOption.label}</span
					>
				</button>
				{#if viewOpen}
					<div
						id="view-panel"
						class="atlas-inset absolute top-full right-0 z-40 mt-2 w-[min(20rem,calc(100vw-2rem))] space-y-4 p-4 shadow-[0_8px_24px_-12px_rgb(0_0_0/0.35)]"
					>
						<div>
							<label class="map-label mb-1 block text-xs" for="ds-select">Budget</label>
							<select
								id="ds-select"
								class="select w-full max-lg:min-h-11"
								value={datasetKey(ds.fy, ds.pit)}
								onchange={switchDataset}
							>
								{#each listed as d (datasetKey(d.fiscalYear, d.pit))}
									<option value={datasetKey(d.fiscalYear, d.pit)}
										>{d.fiscalYear} · {PIT_LABELS[d.pit as Pit] ?? d.publication}</option
									>
								{/each}
							</select>
						</div>

						<div>
							<label class="map-label mb-1 block text-xs" for="year-select">Year shown</label>
							<select
								id="year-select"
								class="select w-full max-lg:min-h-11"
								bind:value={settings.year}
							>
								{#each years as y (y)}
									<option value={y}
										>{ds.meta.years[y]}{y === 'by'
											? ' (budget year)'
											: y === 'cy'
												? ' (current year)'
												: ' (past year, actual)'}</option
									>
								{/each}
							</select>
						</div>

						<div>
							<label class="map-label mb-1 block text-xs" for="fund-select">Money counted</label>
							<select
								id="fund-select"
								class="select w-full max-lg:min-h-11"
								bind:value={settings.fund}
								aria-describedby="fund-hint"
							>
								{#each funds as f (f.v)}
									<option value={f.v}>{f.label}</option>
								{/each}
							</select>
							<p id="fund-hint" class="mt-1 text-xs text-base-content/75">{fundOption.hint}</p>
						</div>

						<fieldset>
							<legend class="map-label mb-1 text-xs">Theme</legend>
							<div class="join w-full">
								{#each themes as t (t.v)}
									<button
										class="btn join-item flex-1 max-lg:min-h-11 lg:btn-sm {settings.theme === t.v
											? 'btn-neutral'
											: 'border-base-300 btn-ghost'}"
										aria-pressed={settings.theme === t.v}
										onclick={() => (settings.theme = t.v)}>{t.label}</button
									>
								{/each}
							</div>
						</fieldset>
					</div>
				{/if}
			</div>
		</div>
	</div>
</header>
