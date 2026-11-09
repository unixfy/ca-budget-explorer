<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';
	import { settings } from '#lib/settings.svelte.ts';
	import { onNavigate } from '$app/navigation';

	let { children }: LayoutProps = $props();

	settings.init();
	$effect(() => {
		document.documentElement.dataset.theme = settings.mode;
		document.documentElement.style.colorScheme = settings.mode;
	});
	$effect(() => {
		// persist whenever any setting changes
		void [settings.year, settings.fund, settings.theme, settings.compare];
		settings.persist();
	});

	// "turn to page": going deeper turns forward, going up (or Back) turns back
	onNavigate((nav) => {
		if (!document.startViewTransition || settings.reducedMotion) return;
		const from = nav.from?.url.pathname ?? '';
		const to = nav.to?.url.pathname ?? '';
		if (from === to) return;
		const back = nav.type === 'popstate' ? nav.delta < 0 : from.startsWith(to);
		document.documentElement.dataset.turn = back ? 'back' : 'forward';
		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await nav.complete;
			});
		});
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>California Budget Explorer</title>
</svelte:head>

{@render children()}
