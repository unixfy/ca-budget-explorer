<script lang="ts">
	/**
	 * Shared header for the "Sources" section: the two pages (where the numbers come from,
	 * notes & known gaps) as atlas page tabs (the open page is the black tab), plus a way across to the Reconciliation checks.
	 */
	import { routes } from '#lib/paths.ts';

	interface Props {
		fy: string;
		pit: string;
		current: 'map' | 'notes';
		class?: string;
	}
	let { fy, pit, current, class: klass = '' }: Props = $props();
	const tabs = $derived([
		{ id: 'map', label: 'Where the numbers come from', href: routes.dataSources(fy, pit) },
		{ id: 'notes', label: 'Notes & known gaps', href: routes.sources(fy, pit) }
	]);
</script>

<nav
	aria-label="Sources"
	class="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-base-content {klass}"
>
	<ul class="flex flex-wrap gap-x-1">
		{#each tabs as t (t.id)}
			{@const on = t.id === current}
			<li>
				<a
					href={t.href}
					aria-current={on ? 'page' : undefined}
					class="map-label inline-flex min-h-11 items-center border border-b-0 px-3 text-xs no-underline transition-colors sm:text-sm {on
						? 'border-base-content bg-base-content text-base-100'
						: 'border-base-300 text-base-content/80 hover:border-base-content hover:text-base-content'}"
					>{t.label}</a
				>
			</li>
		{/each}
	</ul>
	<a
		class="inline-flex min-h-11 items-center gap-1.5 text-sm text-primary underline-offset-2 hover:underline"
		href={routes.reconciliation(fy, pit)}
	>
		Does it add up? See how our totals compare with the official ones
		<svg
			aria-hidden="true"
			viewBox="0 0 16 16"
			class="size-3.5 shrink-0"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"><path d="M3 8h10M9 4l4 4-4 4" /></svg
		>
	</a>
</nav>
