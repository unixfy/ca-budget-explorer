<script lang="ts">
	/**
	 * Year-over-year change. Direction is shown by a small drawn triangle + sign in neutral
	 * ink: an increase or a cut is not good or bad in itself, so it gets no green/red valence.
	 * Hidden when the year shown has no earlier year to compare against.
	 */
	import { delta, money, pct } from '#lib/format.ts';
	import { settings } from '#lib/settings.svelte.ts';
	interface Props {
		from: number | null | undefined;
		to: number | null | undefined;
		mode?: 'pct' | 'abs' | 'both';
	}
	let { from, to, mode = 'pct' }: Props = $props();
	const d = $derived(settings.hasCompare ? delta(from, to) : null);
	const dir = $derived(!d || d.abs === 0 ? 0 : d.abs > 0 ? 1 : -1);
	const said = $derived(!d ? '' : dir > 0 ? 'up ' : dir < 0 ? 'down ' : 'no change ');
</script>

{#if d}
	<span
		class="inline-flex items-baseline gap-1 text-xs whitespace-nowrap text-base-content/80 tabular-nums"
		title="{money(d.abs, { sign: true })} ({pct(d.rel, 1, true)})"
	>
		<svg aria-hidden="true" viewBox="0 0 10 10" class="size-2 shrink-0 self-center fill-current">
			{#if dir > 0}<path d="M5 1.5 9 8.5H1z" />{:else if dir < 0}<path
					d="M5 8.5 1 1.5h8z"
				/>{:else}<rect x="1.5" y="4" width="7" height="2" />{/if}
		</svg>
		<span class="sr-only">{said}</span>
		{#if mode !== 'abs'}{d.rel == null ? 'new' : pct(d.rel, 1, true)}{/if}
		{#if mode === 'both'}<span>({money(d.abs, { sign: true })})</span>{/if}
		{#if mode === 'abs'}{money(d.abs, { sign: true })}{/if}
	</span>
{:else if settings.hasCompare}
	<span class="text-xs text-base-content/70"
		><span aria-hidden="true">—</span><span class="sr-only">no comparison</span></span
	>
{/if}
