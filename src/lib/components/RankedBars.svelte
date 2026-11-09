<script lang="ts">
	/**
	 * Ranked horizontal bars with direct labels (top-N + "Other"), set like an atlas
	 * index: name and figure on one line, a cased tint bar under it, and the item's
	 * page reference when it has one.
	 */
	import { inView, animate } from 'motion';
	import type { AtlasRef } from '#lib/atlas.ts';
	import { money, pct } from '#lib/format.ts';
	import { settings } from '#lib/settings.svelte.ts';
	import { CASING } from '#lib/viz/palette.ts';
	import PageRef from './atlas/PageRef.svelte';

	interface Item {
		id: string;
		name: string;
		value: number;
		href?: string;
		color?: string;
		ref?: AtlasRef;
	}
	interface Props {
		items: Item[];
		top?: number;
		label: string;
	}
	let { items, top = 8, label }: Props = $props();
	let el: HTMLElement | undefined = $state();

	const rows = $derived.by((): Item[] => {
		const s = [...items].filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
		if (s.length <= top + 1) return s;
		const rest = s.slice(top).reduce((a, i) => a + i.value, 0);
		return [...s.slice(0, top), { id: '__other', name: `${s.length - top} others`, value: rest }];
	});
	const total = $derived(rows.reduce((a, r) => a + r.value, 0));
	const max = $derived(Math.max(1, ...rows.map((r) => r.value)));
	const casing = $derived(CASING[settings.mode]);

	$effect(() => {
		void rows;
		if (!el || settings.reducedMotion) return;
		const bars = el.querySelectorAll<HTMLElement>('[data-bar]');
		return inView(el, () => {
			animate(
				bars,
				{ scaleX: [0, 1] },
				{ duration: 0.7, delay: (i: number) => i * 0.04, ease: [0.22, 1, 0.36, 1] }
			);
		});
	});
</script>

<ul bind:this={el} class="divide-y divide-base-content/15" aria-label={label}>
	{#each rows as r (r.id)}
		<li>
			<svelte:element
				this={r.href ? 'a' : 'div'}
				href={r.href}
				class="group block py-2 no-underline {r.href ? 'hover:bg-base-200' : ''}"
			>
				<div class="flex items-baseline gap-2 text-sm">
					<span
						class="min-w-0 truncate {r.href ? 'group-hover:underline' : 'text-base-content/75'}"
						title={r.name}>{r.name}</span
					>
					<span class="ml-auto shrink-0 tabular-nums">
						<span class="font-semibold">{money(r.value)}</span>
						<span class="text-xs text-base-content/75">{pct(r.value / total, 0)}</span>
					</span>
					{#if r.ref}<PageRef ref={r.ref} class="w-14 shrink-0 text-right" />{/if}
				</div>
				<div class="mt-1 h-2.5 w-full">
					<div
						data-bar
						class="h-full origin-left"
						style:width="{(r.value / max) * 100}%"
						style:background={r.color ??
							'color-mix(in oklab, var(--color-base-content) 22%, transparent)'}
						style:box-shadow={r.color ? `inset 0 0 0 1px ${casing}` : undefined}
					></div>
				</div>
			</svelte:element>
		</li>
	{/each}
</ul>
