<script lang="ts">
	/** ⌘K / Ctrl-K / "/" global search across every node in search.json. */
	import { goto } from '$app/navigation';
	import type { SearchEntry } from '#lib/data/schema.ts';
	import { getSearch } from '#lib/data/load.ts';
	import { KIND_LABEL, money } from '#lib/format.ts';
	import { prepare, search, entryHref, type Prepared } from '#lib/search.ts';
	import { routes } from '#lib/paths.ts';

	interface Props {
		fy: string;
		pit: string;
		dir: string;
		open?: boolean;
	}
	let { fy, pit, dir, open = $bindable(false) }: Props = $props();

	let dialog: HTMLDialogElement | undefined = $state();
	let input: HTMLInputElement | undefined = $state();
	let q = $state('');
	let active = $state(0);
	let items = $state<Prepared[] | null>(null);
	let error = $state<string | null>(null);
	let loadedDir = '';

	const results = $derived(items ? search(items, q, 30) : []);

	function load(d: string) {
		loadedDir = d;
		items = null;
		error = null;
		getSearch(d)
			.then((s) => {
				if (loadedDir === d) items = prepare(s);
			})
			.catch((e) => {
				if (loadedDir === d) error = e instanceof Error ? e.message : String(e);
			});
	}
	$effect(() => {
		if (open && loadedDir !== dir) load(dir);
	});
	function retry() {
		load(dir);
		input?.focus();
	}
	const examples = ['Medi-Cal', 'schools', 'income tax'];
	function tryExample(x: string) {
		q = x;
		input?.focus();
	}
	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			queueMicrotask(() => input?.select());
		} else if (!open && dialog.open) dialog.close();
	});
	$effect(() => {
		void q;
		active = 0;
	});

	function onGlobalKey(e: KeyboardEvent) {
		const t = e.target as HTMLElement;
		const typing = t?.closest('input, textarea, select, [contenteditable="true"]');
		if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
			e.preventDefault();
			open = true;
		}
	}
	function go(e: SearchEntry | undefined) {
		if (!e) return;
		open = false;
		goto(entryHref(fy, pit, e));
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			active = Math.min(results.length - 1, active + 1);
			document.getElementById(`cmdk-${active}`)?.scrollIntoView({ block: 'nearest' });
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			active = Math.max(0, active - 1);
			document.getElementById(`cmdk-${active}`)?.scrollIntoView({ block: 'nearest' });
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (results[active]) go(results[active]);
			else if (q.trim()) {
				open = false;
				goto(routes.search(fy, pit, q));
			}
		}
	}
</script>

<svelte:window onkeydown={onGlobalKey} />

<dialog
	bind:this={dialog}
	class="modal modal-top sm:modal-middle"
	onclose={() => (open = false)}
	aria-label="Search the budget"
>
	<div class="modal-box max-w-2xl p-0">
		<label
			class="input w-full rounded-b-none border-0 border-b border-base-300 input-lg focus-within:outline-none"
		>
			<svg
				class="size-5 opacity-60"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg
			>
			<input
				bind:this={input}
				bind:value={q}
				onkeydown={onKey}
				type="search"
				placeholder="Search departments, programs, funds, revenues…"
				aria-controls="cmdk-list"
				aria-activedescendant={results.length ? `cmdk-${active}` : undefined}
				role="combobox"
				aria-expanded={results.length > 0}
				autocomplete="off"
			/>
			<kbd class="kbd kbd-sm">esc</kbd>
		</label>
		<ul id="cmdk-list" role="listbox" class="max-h-[60vh] overflow-y-auto p-2">
			{#if error}
				<li class="space-y-2 p-4 text-sm">
					<p>Search isn’t available right now. Check your connection and try again.</p>
					<div class="flex flex-wrap gap-2">
						<button class="btn btn-sm" onclick={retry}>Try again</button>
						<a
							class="btn btn-ghost btn-sm"
							href={routes.tree(fy, pit, 'expenditures')}
							onclick={() => (open = false)}>Browse spending instead</a
						>
					</div>
					<details class="text-xs text-base-content/75">
						<summary class="cursor-pointer">Technical details</summary>
						<p class="mt-1">{error}</p>
					</details>
				</li>
			{:else if !items && open}
				<li class="p-4 text-center"><span class="loading loading-dots"></span></li>
			{:else if q && !results.length}
				<li class="p-4 text-sm text-base-content/75">
					No matches for “{q}”. Try a shorter or more general word, like a department or a tax.
				</li>
			{:else if !q}
				<li class="p-4 text-sm text-base-content/75">
					<p>
						Search {items?.length.toLocaleString() ?? ''} departments, programs and revenue sources.
					</p>
					<p class="mt-2 flex flex-wrap items-center gap-2">
						Try
						{#each examples as x (x)}
							<button class="btn btn-sm" onclick={() => tryExample(x)}>{x}</button>
						{/each}
					</p>
				</li>
			{/if}
			{#each results as r, i (r.id + r.tree)}
				<li id="cmdk-{i}" role="option" aria-selected={i === active}>
					<button
						class="flex w-full items-center gap-3 rounded-field px-3 py-2 text-left {i === active
							? 'bg-base-200'
							: ''}"
						onclick={() => go(r)}
						onpointermove={() => (active = i)}
					>
						<span class="badge shrink-0 badge-ghost badge-sm">{KIND_LABEL[r.kind]}</span>
						<span class="min-w-0 flex-1">
							<span class="block truncate font-medium" title={r.name}
								>{r.name}{r.code ? ` · ${r.code}` : ''}</span
							>
							<span class="block truncate text-xs text-base-content/75"
								>{r.path.join(' › ') || (r.tree === 'revenues' ? 'Revenues' : 'Expenditures')}</span
							>
						</span>
						<span class="text-sm text-base-content/80 tabular-nums">{money(r.by)}</span>
					</button>
				</li>
			{/each}
		</ul>
	</div>
	<form method="dialog" class="modal-backdrop"><button>close</button></form>
</dialog>
