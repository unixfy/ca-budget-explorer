<script lang="ts">
	import PageTab from '#lib/components/atlas/PageTab.svelte';
	import type { PageProps } from './$types';
	import {
		plainText,
		publicNotes,
		type Quote,
		type ReconCheck,
		type YearKey
	} from '#lib/data/reconciliation.ts';
	import { money, moneyFull } from '#lib/format.ts';
	import { settings } from '#lib/settings.svelte.ts';
	import { CATEGORICAL, OTHER } from '#lib/viz/palette.ts';
	import { routes } from '#lib/paths.ts';
	import SourceChip from '#lib/components/SourceChip.svelte';
	import SourceList from '#lib/components/SourceList.svelte';
	import Waterfall, { type WaterfallStep } from '#lib/components/recon/Waterfall.svelte';
	import StackedColumns, {
		type StackSeries,
		type StackColumn
	} from '#lib/components/recon/StackedColumns.svelte';

	let { data }: PageProps = $props();
	const ds = $derived(data.ds);
	const r = $derived(data.recon);
	const Y = $derived(ds.meta.years);

	const pal = $derived(CATEGORICAL[settings.mode]);
	const gray = $derived(OTHER[settings.mode]);
	/** Colour follows the entity across every chart on this page. */
	const C = $derived({
		revenue: pal[0],
		spending: pal[1],
		sfeu: pal[2],
		psssa: pal[3],
		safetyNet: pal[4],
		bsa: pal[6],
		surplusHolding: pal[7],
		committed: gray,
		other: gray
	});

	let year: YearKey = $state('by');
	const g = $derived(r?.generalFund.years[year]);
	const prevYear: Record<YearKey, YearKey | null> = { py: null, cy: 'py', by: 'cy' };

	const steps = $derived.by((): WaterfallStep[] => {
		if (!r || !g) return [];
		const prev = prevYear[year] ? r.generalFund.years[prevYear[year]!] : null;
		const out: WaterfallStep[] = [
			{
				id: 'begin',
				label: 'Beginning balance',
				value: g.beginningBalance,
				kind: 'total',
				color: C.committed,
				parts: prev
					? [
							{ label: 'Committed (encumbrances)', value: prev.encumbrances, color: C.committed },
							{ label: 'Discretionary reserve (SFEU)', value: prev.sfeu, color: C.sfeu }
						]
					: undefined,
				note: 'Prior-year resources available (Schedule 1).'
			}
		];
		const t = g.transfers;
		if (g.revenues != null && t.total != null) {
			out.push({
				id: 'rev',
				label: 'Revenues',
				value: g.revenues,
				kind: 'delta',
				color: C.revenue,
				note: 'Taxes, fees and other revenue before transfers (Schedule 8).'
			});
			const tr: [string, string, number | null, string][] = [
				['bsa', 'To/from Rainy Day Fund', t.bsa, C.bsa],
				['sha', 'To Surplus Holding Account', t.surplusHolding, C.surplusHolding],
				['snr', 'From Safety Net Reserve', t.safetyNet, C.safetyNet],
				['oth', 'Other transfers & loans', t.other, C.other]
			];
			for (const [id, label, v, color] of tr)
				if (v)
					out.push({
						id,
						label:
							id === 'bsa'
								? v < 0
									? 'Deposit to Rainy Day Fund'
									: 'Draw from Rainy Day Fund'
								: label,
						value: v,
						kind: 'delta',
						color,
						hatch: id === 'oth',
						note:
							id === 'oth'
								? `Loans ${money(t.loans)} and revenue transfers with special funds, net of the reserve transfers shown separately.`
								: 'Reserve accounts are separate funds, so deposits leave the General Fund as transfers.'
					});
		} else
			out.push({
				id: 'rev',
				label: 'Revenues & transfers',
				value: g.revenuesAndTransfers,
				kind: 'delta',
				color: C.revenue
			});
		out.push({
			id: 'exp',
			label: 'Spending',
			value: -g.expenditures,
			kind: 'delta',
			color: C.spending,
			note: 'General Fund expenditures (Schedules 1 and 9).'
		});
		out.push({
			id: 'end',
			label: 'Ending balance',
			value: g.endingBalance,
			kind: 'total',
			color: C.committed,
			parts: [
				{ label: 'Committed (encumbrances)', value: g.encumbrances, color: C.committed },
				{ label: 'Discretionary reserve (SFEU)', value: g.sfeu, color: C.sfeu }
			],
			note: 'Fund balance = encumbrance reserve + SFEU.'
		});
		return out;
	});
	const wfLegend = $derived([
		{ l: 'Revenue', c: C.revenue },
		{ l: 'Spending', c: C.spending },
		{ l: 'Rainy Day Fund', c: C.bsa },
		...(g?.transfers.surplusHolding ? [{ l: 'Surplus Holding Account', c: C.surplusHolding }] : []),
		...(g?.transfers.safetyNet ? [{ l: 'Safety Net Reserve', c: C.safetyNet }] : []),
		{ l: 'Other transfers (hatched) / committed balance', c: C.committed },
		{ l: 'Discretionary reserve (SFEU)', c: C.sfeu }
	]);

	// reserves
	const resSeries = $derived<StackSeries[]>(
		(r?.reserves.accounts ?? []).map((a) => ({
			id: a.id,
			label: a.short + (a.inCombined ? '' : ' (not in official total)'),
			color: C[a.id],
			hatch: !a.inCombined
		}))
	);
	const resColumns = $derived<StackColumn[]>(
		(['py', 'cy', 'by'] as YearKey[]).map((y) => ({
			key: y,
			label: Y[y],
			values: Object.fromEntries((r?.reserves.accounts ?? []).map((a) => [a.id, a.balance[y]])),
			caption: money(r?.reserves.withHolding[y])
		}))
	);

	// problem → solutions
	const fact = (id: string) => r?.problem.facts.find((f) => f.id === id);
	const quote = (id: string | undefined): Quote | undefined =>
		id ? r?.problem.quotes.find((q) => q.id === id) : undefined;
	const shortfall = $derived(fact('gb-shortfall'));
	const outDeficit = $derived(fact('gb-outyear-deficit'));
	const SOL_COLORS = $derived<Record<string, string>>({
		revenue: pal[0],
		spending: pal[1],
		offsets: pal[3],
		shortfall: gray
	});
	const solSeries = $derived<StackSeries[]>([
		{ id: 'shortfall', label: 'Shortfall projected in January', color: gray, hatch: true },
		...(r?.problem.solutions ?? []).map((s) => ({
			id: s.id,
			label: s.label,
			color: SOL_COLORS[s.id] ?? gray
		}))
	]);
	const solColumns = $derived<StackColumn[]>(
		r && shortfall
			? [
					{ key: 'problem', label: 'The problem (Jan.)', values: { shortfall: shortfall.amount } },
					{
						key: 'solutions',
						label: 'Solutions (May)',
						values: Object.fromEntries(r.problem.solutions.map((s) => [s.id, s.amount]))
					}
				]
			: []
	);
	const measureYears = $derived(
		[...new Set((r?.problem.revenueMeasures ?? []).flatMap((m) => Object.keys(m.byYear)))].sort()
	);
	const MEAS_COLORS = $derived<Record<string, string>>({
		mco: pal[0],
		credits: pal[6],
		software: pal[3]
	});
	const measSeries = $derived<StackSeries[]>(
		(r?.problem.revenueMeasures ?? []).map((m) => ({
			id: m.id,
			label: m.label,
			color: MEAS_COLORS[m.id] ?? gray
		}))
	);
	const measColumns = $derived<StackColumn[]>(
		measureYears.map((y) => ({
			key: y,
			label: y,
			values: Object.fromEntries((r?.problem.revenueMeasures ?? []).map((m) => [m.id, m.byYear[y]]))
		}))
	);
	const reserveFacts = $derived(
		[
			'e-bsa-deposit',
			'e-bsa-suspension',
			'e-sha',
			'e-sfeu',
			'e-sfeu-next',
			'e-combined',
			'e-set-aside'
		]
			.map(fact)
			.filter((f) => !!f)
	);
	const contextFacts = $derived(
		['gb-revenue-up', 'mr-bigthree', 'mr-spending-lower', 'e-prior-savings']
			.map(fact)
			.filter((f) => !!f)
	);

	// plan evolution
	const PLAN_ROWS = [
		['revenuesAndTransfers', 'Revenues & transfers'],
		['expenditures', 'Spending'],
		['endingBalance', 'Ending fund balance'],
		['sfeu', 'Discretionary reserve (SFEU)'],
		['bsa', 'Rainy Day Fund (BSA)'],
		['psssa', 'School reserve (PSSSA)']
	] as const;

	// all funds
	const allParts = $derived(
		r
			? [
					{ l: 'State funds (GF + special + bond)', v: r.allFunds.state, c: pal[0], counted: true },
					{ l: 'Federal funds', v: r.allFunds.federal, c: pal[2], counted: true },
					{ l: 'Reimbursements', v: r.allFunds.reimbursements, c: gray, counted: false },
					{
						l: 'Nongovernmental cost funds',
						v: r.allFunds.nongovernmental,
						c: gray,
						counted: false
					},
					{
						l: 'Loan-financed interim payments',
						v: r.allFunds.interimLoans || null,
						c: gray,
						counted: false
					}
				].filter((p) => p.v != null)
			: []
	);
	const allTotal = $derived(allParts.reduce((a, p) => a + (p.v ?? 0), 0));

	// older datasets have no `status`: derive it from `ok`
	const statusOf = (c: ReconCheck) => c.status ?? (c.ok ? 'ties' : 'differs');
	const failed = $derived(r?.checks.filter((c) => statusOf(c) === 'differs') ?? []);
	const explained = $derived(r?.checks.filter((c) => statusOf(c) === 'explained') ?? []);
	const tied = $derived(r?.checks.filter((c) => statusOf(c) === 'ties') ?? []);
	const STATUS_LABEL = {
		ties: 'Matches',
		explained: 'Differs, explained',
		differs: 'Differs, not explained'
	} as const;
	const NUM_WORDS = [
		'No',
		'One',
		'Two',
		'Three',
		'Four',
		'Five',
		'Six',
		'Seven',
		'Eight',
		'Nine',
		'Ten'
	];
	const countWord = (n: number) => NUM_WORDS[n] ?? String(n);
	const notes = $derived(publicNotes(r?.notes ?? []));

	// fiscal-year tabs (WAI-ARIA tabs pattern: arrow keys, Home/End)
	const YEARS: YearKey[] = ['py', 'cy', 'by'];
	function tabKey(e: KeyboardEvent, i: number) {
		const j =
			e.key === 'ArrowRight'
				? (i + 1) % YEARS.length
				: e.key === 'ArrowLeft'
					? (i + YEARS.length - 1) % YEARS.length
					: e.key === 'Home'
						? 0
						: e.key === 'End'
							? YEARS.length - 1
							: -1;
		if (j < 0) return;
		e.preventDefault();
		year = YEARS[j];
		document.getElementById(`yr-tab-${YEARS[j]}`)?.focus();
	}
	const toneLabel = {
		adds: 'Adds to spending',
		removes: 'Reduces a total',
		moves: 'Moves money',
		neutral: 'Context'
	} as const;
</script>

<svelte:head
	><title>Reconciliation · {ds.meta.fiscalYear} · California Budget Explorer</title></svelte:head
>

{#snippet cite(q: Quote | undefined)}
	{#if q}
		<figure class="mt-3 border-l border-base-300 pl-3">
			<blockquote class="text-sm leading-relaxed italic opacity-85">“{q.text}”</blockquote>
			<figcaption class="mt-1 text-xs opacity-70">
				—
				<a
					class="link link-hover"
					href={q.source.page ? `${q.source.url}#page=${q.source.page}` : q.source.url}
					target="_blank"
					rel="noopener noreferrer">{q.doc}{q.source.page ? `, p. ${q.source.page}` : ''}</a
				>
			</figcaption>
		</figure>
	{/if}
{/snippet}

{#if !r}
	<section class="mx-auto max-w-2xl py-16 text-center">
		<PageTab page="iii" label="Does it add up?" />
		<h1 class="mt-4 text-3xl font-bold tracking-tight md:text-5xl">Reconciliation</h1>
		<p class="mt-4 opacity-85">
			The reconciliation for the {ds.meta.fiscalYear}
			{ds.meta.publication} budget isn’t ready yet. It will check this explorer’s totals against the Department
			of Finance’s summary tables once they have been compared.
		</p>
		<div class="mt-6 flex justify-center gap-2">
			<a class="btn btn-primary" href={routes.flows(ds.fy, ds.pit)}>Follow the money instead</a>
			<a class="btn btn-ghost" href={routes.home(ds.fy, ds.pit)}>Back to the overview</a>
		</div>
	</section>
{:else}
	{@const by = r.generalFund.years.by}
	<header class="max-w-3xl">
		<PageTab page="iii" label="Does it add up?" />
		<h1 class="mt-4 text-3xl font-bold tracking-tight text-balance md:text-5xl">Reconciliation</h1>
		<p class="mt-3 text-lg leading-relaxed text-balance">
			Do this explorer’s numbers match the State’s own published figures? This page checks them for
			the {r.years.by}
			{r.publication} Budget, explains why different publications show different totals, and shows how
			the General Fund balances.
		</p>
	</header>

	<!-- ───────────── The audit, first ───────────── -->
	<section id="audit" class="atlas-inset mt-6 max-w-4xl p-4 sm:p-5" aria-labelledby="audit-h">
		<h2 id="audit-h" class="text-xl font-bold">Does it add up?</h2>
		<p class="mt-1 text-sm leading-relaxed opacity-85">
			We recompute {r.checks.length} totals from the Department of Finance’s printed tables and compare
			them with this explorer and with the budget summary. Nothing is adjusted to make them match.
		</p>
		<ul class="mt-4 flex flex-wrap gap-x-10 gap-y-3">
			<li class="flex items-baseline gap-2">
				<span class="text-3xl font-bold tabular-nums">{tied.length}</span>
				<span class="text-sm">match, to the rounding of the printed figure</span>
			</li>
			<li class="flex items-baseline gap-2">
				<span class="text-3xl font-bold tabular-nums">{explained.length}</span>
				<span class="text-sm">differ, with every dollar of the difference explained</span>
			</li>
			<li class="flex items-baseline gap-2" class:text-warning={failed.length > 0}>
				<span class="text-3xl font-bold tabular-nums">{failed.length}</span>
				<span class="text-sm">differ for reasons not yet found</span>
			</li>
		</ul>
		<p class="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm">
			<a class="link" href="#checks">See every check</a>
			<a class="link" href="#totals">Which spending total should I use?</a>
			<a class="link" href="#why-h">Why totals differ</a>
		</p>
	</section>

	<!-- ───────────── Which total? ───────────── -->
	{#if r.allFunds.state != null}
		<section id="totals" class="mt-8 max-w-4xl" aria-labelledby="totals-h">
			<h2 id="totals-h" class="text-xl font-bold">Which spending total?</h2>
			<p class="mt-1 text-sm leading-relaxed opacity-85">
				You’ll see different totals for {r.years.by} spending. Each is correct; they count different things.
			</p>
			<dl class="mt-4 space-y-3 text-sm leading-relaxed">
				<div class="grid gap-x-4 sm:grid-cols-[8rem_1fr]">
					<dt class="text-xl font-bold tabular-nums" title={moneyFull(r.allFunds.state)}>
						{money(r.allFunds.state)}
					</dt>
					<dd>
						<strong>State funds:</strong> the General Fund, special funds and bond funds. This is the
						Department of Finance’s headline figure.
					</dd>
				</div>
				{#if r.allFunds.federal != null}
					<div class="grid gap-x-4 sm:grid-cols-[8rem_1fr]">
						<dt
							class="text-xl font-bold tabular-nums"
							title={moneyFull(r.allFunds.state + r.allFunds.federal)}
						>
							{money(r.allFunds.state + r.allFunds.federal)}
						</dt>
						<dd>
							<strong>State + federal funds:</strong> adds {money(r.allFunds.federal)} of federal grants
							that the State spends on specific programs. This is the largest total this explorer shows.
						</dd>
					</div>
				{/if}
				{#if r.allFunds.ebudgetAllFunds}
					<div class="grid gap-x-4 sm:grid-cols-[8rem_1fr]">
						<dt
							class="text-xl font-bold tabular-nums"
							title={moneyFull(r.allFunds.ebudgetAllFunds)}
						>
							{money(r.allFunds.ebudgetAllFunds)}
						</dt>
						<dd>
							<strong>“All funds” on ebudget.ca.gov:</strong> also adds
							{#if r.allFunds.reimbursements != null}{money(r.allFunds.reimbursements)} of
								<em>reimbursements</em> (one department paying another, so the money was already counted
								where it started){/if}{#if r.allFunds.reimbursements != null && r.allFunds.nongovernmental != null}
								and{/if}
							{#if r.allFunds.nongovernmental != null}{money(r.allFunds.nongovernmental)} of
								<em>nongovernmental cost funds</em> (money the State holds or passes through for others,
								such as pension trusts, universities’ own funds and local property tax){/if}. Some
							of those dollars are counted twice, so this explorer leaves them out.
						</dd>
					</div>
				{/if}
			</dl>
			{#if allParts.length && r.allFunds.ebudgetAllFunds}
				<div
					class="mt-4 flex h-6 w-full gap-[2px] overflow-hidden rounded"
					role="img"
					aria-label="All funds composition: {allParts
						.map((p) => `${p.l} ${money(p.v)}${p.counted ? '' : ' (left out)'}`)
						.join(', ')}"
				>
					{#each allParts as p (p.l)}
						<div
							class="h-full first:rounded-l last:rounded-r"
							style:width="{((p.v ?? 0) / allTotal) * 100}%"
							style:background={p.c}
							style:background-image={p.counted
								? undefined
								: 'repeating-linear-gradient(45deg, transparent 0 4px, color-mix(in oklab, var(--color-base-100) 70%, transparent) 4px 7px)'}
							title="{p.l}: {money(p.v)}"
						></div>
					{/each}
				</div>
				<ul class="mt-2 grid gap-1 text-xs sm:grid-cols-2">
					{#each allParts as p (p.l)}
						<li class="flex items-center gap-1.5">
							<span
								class="inline-block size-2.5 shrink-0 rounded-sm"
								style:background={p.c}
								aria-hidden="true"
							></span>
							{p.l}: <strong class="tabular-nums">{money(p.v)}</strong>{p.counted
								? ''
								: ' (left out: counted twice)'}
						</li>
					{/each}
				</ul>
			{/if}
			<div class="mt-2">
				<SourceChip sources={r.allFunds.sources} fy={ds.fy} pit={ds.pit} product="reconciliation" />
			</div>
		</section>
	{/if}

	<!-- ───────────── Terms ───────────── -->
	<section class="mt-8 max-w-4xl" aria-labelledby="terms-h">
		<h2 id="terms-h" class="text-lg font-bold">Terms used on this page</h2>
		<dl class="mt-2 grid gap-x-8 gap-y-2 text-sm leading-relaxed md:grid-cols-2">
			<div>
				<dt class="inline font-semibold">Schedules 1, 8, 9 and 10:</dt>
				<dd class="inline opacity-85">
					summary tables the Department of Finance publishes with each budget: 1 is the overall
					summary, 8 lists revenue, 9 lists spending, and 10 shows each fund’s balance.
				</dd>
			</div>
			<div>
				<dt class="inline font-semibold">General Fund:</dt>
				<dd class="inline opacity-85">
					the State’s main account, paid for mostly by income, sales and corporation taxes.
				</dd>
			</div>
			<div>
				<dt class="inline font-semibold">Encumbrances:</dt>
				<dd class="inline opacity-85">
					money already promised to contracts and orders that haven’t been paid yet, so it can’t be
					spent on anything else.
				</dd>
			</div>
			<div>
				<dt class="inline font-semibold">SFEU (Special Fund for Economic Uncertainties):</dt>
				<dd class="inline opacity-85">
					the General Fund’s flexible reserve. A positive SFEU at year end is how the State defines
					a balanced budget.
				</dd>
			</div>
			<div>
				<dt class="inline font-semibold">BSA (Budget Stabilization Account):</dt>
				<dd class="inline opacity-85">
					the constitutional Rainy Day Fund, which can only be drawn in a budget emergency.
				</dd>
			</div>
			<div>
				<dt class="inline font-semibold">PSSSA (Public School System Stabilization Account):</dt>
				<dd class="inline opacity-85">
					a reserve for schools and community colleges, used when their guaranteed funding falls.
				</dd>
			</div>
		</dl>
	</section>

	<!-- ───────────── Why numbers differ ───────────── -->
	<section class="mt-8" aria-labelledby="why-h">
		<h2 id="why-h" class="text-xl font-bold">Why the numbers don’t match</h2>
		<p class="text-sm opacity-85">
			{countWord(r.differences.length)}
			{r.differences.length === 1 ? 'reason' : 'reasons'} totals differ between tables, pages and publications.
		</p>
		<div class="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
			{#each r.differences as d (d.id)}
				<article
					class="flex flex-col border-t border-base-content !p-0 p-4 px-0 !pt-4 pt-4 pb-0 text-sm"
				>
					<h3 class="leading-snug font-semibold">{d.title}</h3>
					<p class="mt-1 text-xs opacity-75">{toneLabel[d.tone]}</p>
					{#if d.amount != null}
						<div class="mt-2 text-xl font-bold tabular-nums" title={moneyFull(d.amount)}>
							{money(d.amount)}
						</div>
					{/if}
					<p class="mt-1 flex-1 leading-relaxed opacity-85">{d.body}</p>
					<div class="mt-2"><SourceList sources={d.sources} compact title="Source" /></div>
				</article>
			{/each}
		</div>
	</section>

	<!-- ───────────── Checks ───────────── -->
	<section
		id="checks"
		class="mt-8 border-t border-base-content !p-0 p-5 px-0 !pt-4 pt-4 pb-0 text-sm"
		aria-labelledby="chk-h"
	>
		<h2 id="chk-h" class="text-lg font-bold">Every check</h2>
		<p class="mt-1 opacity-85">
			{tied.length} of {r.checks.length} match.
			{#if explained.length}{explained.length} differ, and documented causes account for the whole difference.{/if}
			{#if failed.length}{failed.length} differ for reasons not yet found.{/if}
		</p>
		{#if explained.length}
			<h3 class="mt-4 font-semibold">Explained differences</h3>
			<p class="mt-1 text-xs opacity-75">
				The two official sources genuinely disagree (or measure slightly different things). The
				documented causes below account for the whole difference; nothing is adjusted to make the
				numbers match.
			</p>
			<ul class="mt-2 space-y-2">
				{#each explained as c (c.id)}
					<li class="border-t border-base-300 py-3">
						<div class="font-semibold">{plainText(c.label)}</div>
						<div class="tabular-nums opacity-85">
							Expected {moneyFull(c.expected)}, found {moneyFull(c.actual)} (difference {money(
								c.difference,
								{ sign: true }
							)})
						</div>
						{#if c.explanation}
							<p class="mt-1 text-xs leading-relaxed opacity-85">
								{plainText(c.explanation.summary)}
							</p>
							<ul class="mt-2 space-y-2 border-l border-base-300 pl-3">
								{#each c.explanation.items as it, i (i)}
									<li class="text-xs">
										<div class="font-medium">
											{plainText(it.label)}
											<span class="tabular-nums">({money(it.amount, { sign: true })})</span>
										</div>
										<p class="mt-0.5 leading-relaxed opacity-85">{plainText(it.cause)}</p>
										<div class="mt-1">
											<SourceList sources={it.sources} compact title="Sources" />
										</div>
									</li>
								{/each}
							</ul>
						{/if}
						{#if c.note}<div class="mt-1 text-xs opacity-75">{plainText(c.note)}</div>{/if}
					</li>
				{/each}
			</ul>
		{/if}
		{#if failed.length}
			<h3 class="mt-4 font-semibold">Unexplained differences</h3>
			<ul class="mt-2 space-y-2">
				{#each failed as c (c.id)}
					<li class="bg-secondary/20 p-3">
						<div class="font-semibold">{plainText(c.label)}</div>
						<div class="tabular-nums opacity-85">
							Expected {moneyFull(c.expected)}, found {moneyFull(c.actual)} (difference {money(
								c.difference,
								{ sign: true }
							)})
						</div>
						{#if c.note}<div class="text-xs opacity-75">{plainText(c.note)}</div>{/if}
						{#if c.explanation}
							<div class="text-xs opacity-75">
								Documented causes cover {money(c.difference - c.explanation.unexplained, {
									sign: true
								})}; {money(c.explanation.unexplained, { sign: true })} is unexplained.
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
		<details class="mt-3">
			<summary class="cursor-pointer font-semibold">All {r.checks.length} checks</summary>
			<div class="overflow-x-auto">
				<table class="table mt-2 table-xs">
					<caption class="text-left text-xs opacity-75">Amounts in thousands of dollars</caption>
					<thead
						><tr
							><th scope="col">Result</th><th scope="col">Check</th><th
								scope="col"
								class="text-right">Expected</th
							><th scope="col" class="text-right">Actual</th><th scope="col" class="text-right"
								>Difference</th
							></tr
						></thead
					>
					<tbody class="tabular-nums">
						{#each r.checks as c (c.id)}
							<tr>
								<td class="whitespace-nowrap">{STATUS_LABEL[statusOf(c)]}</td>
								<td>{plainText(c.label)}</td>
								<td class="text-right">{c.expected.toLocaleString('en-US')}</td>
								<td class="text-right">{c.actual.toLocaleString('en-US')}</td>
								<td class="text-right">{c.difference.toLocaleString('en-US')}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</details>
	</section>

	<!-- ───────────── The General Fund in detail ───────────── -->
	<section class="mt-12 max-w-4xl border-t border-base-300 pt-8" aria-labelledby="gf-h">
		<h2 id="gf-h" class="text-2xl font-bold">The General Fund in detail</h2>
		<p class="mt-2 leading-relaxed opacity-85">{r.problem.summary}</p>
	</section>

	<section class="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="General Fund key figures">
		{#each [{ k: 'Revenues & transfers', v: by.revenuesAndTransfers, c: C.revenue, d: 'General Fund, Schedule 1' }, { k: 'Spending', v: by.expenditures, c: C.spending, d: 'General Fund, Schedule 1' }, { k: 'Drawn from balance', v: by.beginningBalance - by.endingBalance, c: C.committed, d: `${money(by.beginningBalance)} → ${money(by.endingBalance)}` }, { k: 'Combined reserves', v: r.reserves.combined.by, c: C.bsa, d: r.reserves.withHolding.by !== r.reserves.combined.by ? `${money(r.reserves.withHolding.by)} incl. Surplus Holding` : 'BSA + PSSSA + SFEU' }] as s (s.k)}
			<div class="border-t border-base-content !p-0 p-4 px-0 !pt-4 pt-4 pb-0">
				<div class="flex items-center gap-2 text-sm font-semibold opacity-85">
					<span
						class="inline-block size-2.5 shrink-0 rounded-sm"
						style:background={s.c}
						aria-hidden="true"
					></span>
					{s.k}
				</div>
				<div class="mt-1 text-2xl font-bold tabular-nums" title={moneyFull(s.v)}>{money(s.v)}</div>
				<div class="text-xs opacity-75">{s.d}</div>
			</div>
		{/each}
	</section>

	<!-- ───────────── General Fund bridge ───────────── -->
	<section
		class="mt-6 border-t border-base-content !p-0 p-5 px-0 !pt-4 pt-4 pb-0"
		aria-labelledby="bridge-h"
	>
		<div class="flex flex-wrap items-baseline justify-between gap-3">
			<div>
				<h2 id="bridge-h" class="text-xl font-bold">The General Fund bridge</h2>
				<p class="text-sm opacity-75">
					From the balance carried in, through revenue, transfers and spending, to the balance left
					at year end.
				</p>
			</div>
			<div role="tablist" aria-label="Fiscal year" class="tabs tabs-box tabs-sm">
				{#each YEARS as y, i (y)}
					<button
						role="tab"
						id="yr-tab-{y}"
						class="tab"
						class:tab-active={year === y}
						aria-selected={year === y}
						aria-controls="yr-panel"
						tabindex={year === y ? 0 : -1}
						onclick={() => (year = y)}
						onkeydown={(e) => tabKey(e, i)}>{r.years[y]}</button
					>
				{/each}
			</div>
		</div>
		<div id="yr-panel" role="tabpanel" aria-labelledby="yr-tab-{year}">
			<ul class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Legend">
				{#each wfLegend as l (l.l)}
					<li class="flex items-center gap-1.5">
						<span class="inline-block size-3 rounded-sm" style:background={l.c} aria-hidden="true"
						></span><span class="opacity-85">{l.l}</span>
					</li>
				{/each}
			</ul>
			<div class="mt-3">
				<Waterfall {steps} label="General Fund bridge, {r.years[year]}" />
			</div>
			{#if g}
				<div class="mt-4 grid gap-4 text-sm leading-relaxed md:grid-cols-3">
					<p>
						<strong>Revenue isn’t the whole story.</strong> The General Fund collects
						{money(g.revenues ?? g.revenuesAndTransfers)}{#if g.transfers.total != null}, but net
							transfers and loans of {money(g.transfers.total, { sign: true })} — mostly deposits into
							reserve accounts that are separate funds — leave {money(g.revenuesAndTransfers)} of “revenues
							and transfers”{/if}.
					</p>
					<p>
						<strong
							>Spending exceeds that by {money(g.expenditures - g.revenuesAndTransfers)}.</strong
						>
						{#if g.expenditures > g.revenuesAndTransfers}The difference is paid from the
							{money(g.beginningBalance)} balance carried in from {prevYear[year]
								? r.years[prevYear[year]!]
								: 'the year before'}.{:else}Revenue exceeds spending, so the balance grows.{/if}
					</p>
					<p>
						<strong>What’s left:</strong>
						{money(g.endingBalance)}, of which {money(g.encumbrances)} is already committed to unpaid
						orders and contracts (encumbrances) and {money(g.sfeu)} is the flexible reserve (SFEU) — the
						number the State uses to call the budget balanced.
						{#if g.prop98}Of spending, {money(g.prop98.prop98)} is Proposition 98 (schools and community
							colleges).{/if}
					</p>
				</div>
			{/if}
		</div>
		{#if g}
			<details class="mt-4 text-sm">
				<summary class="cursor-pointer font-semibold">Table view (thousands of dollars)</summary>
				<div class="overflow-x-auto">
					<table class="table mt-2 table-sm">
						<thead
							><tr
								><th scope="col">Line</th>{#each YEARS as y (y)}<th scope="col" class="text-right"
										>{r.years[y]}</th
									>{/each}</tr
							></thead
						>
						<tbody class="tabular-nums">
							{#each [['Beginning balance', (x: typeof g) => x.beginningBalance], ['Revenues (Schedule 8)', (x: typeof g) => x.revenues], ['Transfers & loans (net)', (x: typeof g) => x.transfers.total], ['  of which Rainy Day Fund', (x: typeof g) => x.transfers.bsa], ['  of which Surplus Holding Account', (x: typeof g) => x.transfers.surplusHolding], ['  of which Safety Net Reserve', (x: typeof g) => x.transfers.safetyNet], ['  of which other', (x: typeof g) => x.transfers.other], ['Revenues & transfers', (x: typeof g) => x.revenuesAndTransfers], ['Expenditures', (x: typeof g) => x.expenditures], ['Ending fund balance', (x: typeof g) => x.endingBalance], ['  Encumbrances', (x: typeof g) => x.encumbrances], ['  SFEU', (x: typeof g) => x.sfeu]] as const as [label, fn] (label)}
								<tr>
									<td class="whitespace-pre">{label}</td>
									{#each YEARS as y (y)}
										{@const v = fn(r.generalFund.years[y])}
										<td class="text-right">{v == null ? '—' : v.toLocaleString('en-US')}</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</details>
		{/if}
		<div class="mt-4"><SourceList sources={r.generalFund.sources} compact /></div>
	</section>
	<!-- ───────────── Reserves ───────────── -->
	<section class="mt-6 grid gap-6 lg:grid-cols-5" aria-labelledby="res-h">
		<div class="border-t border-base-content !p-0 p-5 px-0 !pt-4 pt-4 pb-0 lg:col-span-3">
			<h2 id="res-h" class="text-xl font-bold">Reserves over three years</h2>
			<p class="mb-3 text-sm opacity-75">
				Balances at year end. The official “combined reserves” are
				{money(r.reserves.combined.by)} in {r.years
					.by}{#if r.reserves.withHolding.by !== r.reserves.combined.by}; with the Surplus Holding
					Account (hatched) {money(r.reserves.withHolding.by)}{/if}.
			</p>
			<StackedColumns
				series={resSeries}
				columns={resColumns}
				label="Reserve balances by year"
				height={300}
			/>
		</div>
		<div class="space-y-3 lg:col-span-2">
			{#each r.reserves.accounts as a (a.id)}
				<article class="border-t border-base-content !p-0 p-4 px-0 !pt-4 pt-4 pb-0 text-sm">
					<div class="flex items-center gap-2">
						<span
							class="inline-block size-3 rounded-sm"
							style:background={C[a.id]}
							aria-hidden="true"
						></span>
						<h3 class="font-semibold">{a.name}</h3>
						<span class="ml-auto font-bold tabular-nums" title={moneyFull(a.balance.by)}
							>{money(a.balance.by)}</span
						>
					</div>
					<p class="mt-1 text-xs leading-relaxed opacity-75">{a.description}</p>
					<dl class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
						{#each YEARS as y (y)}
							{#if a.change[y] != null}
								<div>
									<dt class="inline opacity-75">{r.years[y]}:</dt>
									<dd class="inline font-semibold tabular-nums">
										{a.change[y] === 0
											? 'no change'
											: `${a.change[y]! > 0 ? 'deposit' : 'withdrawal'} ${money(Math.abs(a.change[y]!))}`}
									</dd>
								</div>
							{/if}
						{/each}
					</dl>
				</article>
			{/each}
		</div>
	</section>

	<!-- ───────────── Problem → solutions ───────────── -->
	<details class="mt-6 border-t border-base-content !p-0 p-5 px-0 !pt-4 pt-4 pb-0">
		<summary class="cursor-pointer">
			<h2 id="prob-h" class="inline text-xl font-bold">The budget problem and how it was solved</h2>
			<span class="mt-1 block text-sm opacity-75"
				>January’s projected shortfall, the May Revision’s solutions, new revenue measures and
				reserve actions, with quotes from the budget documents.</span
			>
		</summary>
		<div class="mt-4 grid gap-6 lg:grid-cols-2">
			<div>
				<h3 class="font-semibold">January: a small gap now, a big one next year</h3>
				{#if shortfall}
					<p class="mt-1 text-sm leading-relaxed">
						The Governor’s Budget found a <strong>{shortfall.printed}</strong> shortfall for
						{shortfall.year}{#if outDeficit}, and a deficit of roughly <strong
								>{outDeficit.printed}</strong
							>
							in {outDeficit.year}{/if}. Revenue was up sharply, but constitutional funding
						requirements, the reserve and rising program costs grew faster.
					</p>
					{@render cite(quote(shortfall.quoteId))}
					{@render cite(quote(outDeficit?.quoteId))}
				{:else}
					<p class="mt-1 text-sm opacity-75">
						The narrative for this publication does not state a shortfall.
					</p>
				{/if}
				{#if contextFacts.length}
					<h3 class="mt-5 font-semibold">What changed by May</h3>
					<ul class="mt-2 space-y-2 text-sm">
						{#each contextFacts as f (f.id)}
							{@const q = quote(f.quoteId)}
							<li class="flex gap-3">
								<span class="w-20 shrink-0 text-right font-bold tabular-nums"
									>{money(f.amount)}</span
								>
								<span
									>{f.label}{#if q}
										<a
											class="link text-xs link-hover opacity-75"
											href={q.source.page ? `${q.source.url}#page=${q.source.page}` : q.source.url}
											target="_blank"
											rel="noopener noreferrer"
											title={q.text}>source</a
										>{/if}</span
								>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
			<div>
				<h3 class="font-semibold">
					Solutions for {r.problem.solutions[0]?.year ?? r.years.by}
				</h3>
				{#if solColumns.length && r.problem.solutions.length}
					<p class="mb-2 text-sm opacity-75">
						{money(r.problem.solutions.reduce((a, s) => a + s.amount, 0))} of solutions in the May Revision
						against the January gap — the extra margin, with higher revenue, also funds the reserve deposits
						and the Surplus Holding Account below.
					</p>
					<StackedColumns
						series={solSeries}
						columns={solColumns}
						label="Budget problem versus solutions"
						height={260}
						maxBand={110}
					/>
					<ul class="mt-3 space-y-1 text-xs">
						{#each r.problem.solutions as s (s.id)}
							{@const q = quote(s.quoteId)}
							<li>
								<strong>{s.label} — {s.printed}.</strong>
								{s.description}
								{#if q}<a
										class="link link-hover opacity-75"
										href={q.source.page ? `${q.source.url}#page=${q.source.page}` : q.source.url}
										target="_blank"
										rel="noopener noreferrer"
										title={q.text}>source</a
									>{/if}
							</li>
						{/each}
					</ul>
					<p class="mt-2 text-xs opacity-75">{r.problem.solutionsNote}</p>
				{:else}
					<p class="text-sm opacity-75">No solution categories were published for this budget.</p>
				{/if}
			</div>
		</div>

		<div class="mt-8 grid gap-6 lg:grid-cols-2">
			{#if measColumns.length}
				<div>
					<h3 class="font-semibold">Enacted revenue measures, growing over time</h3>
					<p class="mb-2 text-sm opacity-75">
						Most of the multi-year fix is revenue that is small in {r.years.by} and larger later — aimed
						at the structural deficit rather than the budget year.
					</p>
					<StackedColumns
						series={measSeries}
						columns={measColumns}
						label="Enacted General Fund revenue measures by year"
						height={260}
					/>
					{#each r.problem.revenueMeasures as m (m.id)}{@render cite(quote(m.quoteId))}{/each}
				</div>
			{/if}
			<div>
				<h3 class="font-semibold">Reserve actions</h3>
				<ul class="mt-2 space-y-2 text-sm">
					{#each reserveFacts as f (f!.id)}
						{@const q = quote(f!.quoteId)}
						<li class="flex gap-3">
							<span class="w-20 shrink-0 text-right font-bold tabular-nums">{money(f!.amount)}</span
							>
							<span
								>{f!.label}{f!.year ? ` (${f!.year})` : ''}{#if q}
									<a
										class="link text-xs link-hover opacity-75"
										href={q.source.page ? `${q.source.url}#page=${q.source.page}` : q.source.url}
										target="_blank"
										rel="noopener noreferrer"
										title={q.text}>source</a
									>{/if}</span
							>
						</li>
					{/each}
				</ul>
				{@render cite(quote('e-sha-why'))}
				{@render cite(quote('e-framework'))}
				{@render cite(quote('e-onetime'))}
			</div>
		</div>

		{#if r.plan.stages.length > 1}
			{@const stages = r.plan.stages}
			<div class="mt-8">
				<h3 class="font-semibold">
					How the plan moved: January → May → June ({r.years.by}, General Fund)
				</h3>
				<div class="mt-2 overflow-x-auto">
					<table class="table table-sm">
						<thead>
							<tr>
								<th></th>
								{#each stages as s (s.pit)}
									<th class="text-right"
										>{s.label}<br /><span class="text-xs font-normal opacity-75"
											>{s.date.replace(/^\w+ on /, '')}</span
										></th
									>
								{/each}
							</tr>
						</thead>
						<tbody class="tabular-nums">
							{#each PLAN_ROWS as [k, label] (k)}
								{@const mx = Math.max(...stages.map((s) => s[k]))}
								<tr>
									<td>{label}</td>
									{#each stages as s, i (s.pit)}
										<td class="text-right">
											<div class="flex items-center justify-end gap-2">
												<span
													class="hidden h-2 rounded-full sm:inline-block"
													style:width="{Math.max(2, (s[k] / (mx || 1)) * 80)}px"
													style:background={i === stages.length - 1 ? pal[0] : gray}
													aria-hidden="true"
												></span>
												<span title={moneyFull(s[k])}>{money(s[k])}</span>
											</div>
										</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<p class="mt-1 text-xs opacity-75">
					{#each stages.filter((s) => s.transcribed) as s (s.pit)}{s.label} figures are transcribed from
						a printed chart (millions).
					{/each}
				</p>
				<SourceList sources={stages.map((s) => s.source)} compact title="Plan sources" />
			</div>
		{/if}
	</details>

	<!-- ───────────── Other fund types ───────────── -->
	<section class="mt-6 grid gap-6 lg:grid-cols-2" aria-label="Other funds">
		<div class="border-t border-base-content !p-0 p-5 px-0 !pt-4 pt-4 pb-0 text-sm">
			<h2 class="text-lg font-bold">Special funds: dedicated money, plus the reserves</h2>
			<p class="mt-1 leading-relaxed opacity-85">
				Special funds (gas taxes, fees, dedicated taxes) are spent on what they were raised for.
				Because reserve accounts are special funds too, reserve deposits count as special-fund
				revenue:
				{money(r.specialFunds.reserveAccounts.by)} of the {money(r.specialFunds.end.by)} ending balance
				is General Fund reserves.
			</p>
			<table class="table mt-3 table-sm">
				<thead
					><tr
						><th></th>{#each YEARS as y (y)}<th class="text-right">{r.years[y]}</th>{/each}</tr
					></thead
				>
				<tbody class="tabular-nums">
					{#each [['Beginning balance', r.specialFunds.begin], ['+ Revenues & transfers', r.specialFunds.revenues], ['− Expenditures', r.specialFunds.expenditures], ['= Ending balance', r.specialFunds.end], ['  of which reserve accounts', r.specialFunds.reserveAccounts]] as const as [l, t] (l)}
						<tr>
							<td class="whitespace-pre">{l}</td>
							{#each YEARS as y (y)}<td class="text-right" title={moneyFull(t[y])}>{money(t[y])}</td
								>{/each}
						</tr>
					{/each}
				</tbody>
			</table>
			<div class="mt-3"><SourceList sources={r.specialFunds.sources} compact /></div>
		</div>
		<div class="border-t border-base-content !p-0 p-5 px-0 !pt-4 pt-4 pb-0 text-sm">
			<h2 class="text-lg font-bold">Federal and bond funds: spent, not raised</h2>
			<p class="mt-1 leading-relaxed opacity-85">
				{money(r.federalAndBond.federal.by)} in federal grants and {money(r.federalAndBond.bond.by)} of
				bond-financed spending appear in total spending but in no state revenue schedule — they are paid
				for by Washington and by borrowing.
			</p>
			<p class="mt-2 leading-relaxed opacity-85">
				They are why this explorer’s “State + federal funds” total is larger than the state-funds
				figure. <a class="link" href="#totals">Compare the totals</a>
			</p>
			<div class="mt-3">
				<SourceList sources={r.federalAndBond.sources} compact />
			</div>
		</div>
	</section>

	{#if notes.length}
		<details class="mt-6 border-t border-base-content !p-0 p-5 px-0 !pt-4 pt-4 pb-0 text-sm">
			<summary class="cursor-pointer font-bold">Notes on method</summary>
			<ul class="mt-2 list-disc space-y-1 pl-5 leading-relaxed opacity-85">
				{#each notes as n, i (i)}<li>{n}</li>{/each}
			</ul>
		</details>
	{/if}

	<div class="mt-6"><SourceList sources={r.sources} /></div>
{/if}
