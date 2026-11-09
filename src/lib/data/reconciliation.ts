/**
 * Shape of static/data/{fy}/{pit}/reconciliation.json (built by scripts/etl/reconciliation.ts)
 * plus a fetch-and-cache loader. Amounts are in THOUSANDS of dollars, as printed by DOF,
 * unless a field says otherwise. Every figure carries (or inherits) an official source.
 */
import { dataUrl, DataError } from './load.ts';
import type { SourceRef } from './schema.ts';

export type YearKey = 'py' | 'cy' | 'by';
export type Tri = Record<YearKey, number | null>;

/** One fiscal year of the General Fund bridge (DOF Schedule 1 / 8 / 10). */
export interface GfBridgeYear {
	/** Prior-year resources available (beginning fund balance). */
	beginningBalance: number;
	/** Schedule 8 "TOTALS, REVENUES" (before transfers and loans). */
	revenues: number | null;
	/** Net transfers & loans (Schedule 8), negative = money leaving the General Fund. */
	transfers: {
		total: number | null;
		/** Transfer to (−) / from (+) the Budget Stabilization Account (Schedule 10, fund 1011). */
		bsa: number | null;
		/** Transfer to the Projected Surplus Temporary Holding Account (Schedule 10, fund 1032). */
		surplusHolding: number | null;
		/** Transfer from (+) the Safety Net Reserve (Schedule 10, fund 1019). */
		safetyNet: number | null;
		/** Everything else: loans and other revenue transfers with special funds (computed). */
		other: number | null;
		/** Schedule 8 "Loans" line. */
		loans: number | null;
		/** Schedule 8 "Revenue Transfers" line. */
		revenueTransfers: number | null;
	};
	/** Schedule 1 "Revenues and transfers". */
	revenuesAndTransfers: number;
	/** Schedule 1 "Expenditures". */
	expenditures: number;
	/** Schedule 1 "Fund Balance" (ending). */
	endingBalance: number;
	/** Reserve for Liquidation of Encumbrances (committed, not available). */
	encumbrances: number;
	/** Special Fund for Economic Uncertainties (the discretionary reserve). */
	sfeu: number;
	/** Proposition 98 / non-Proposition 98 split (Summary Charts, millions → thousands). */
	prop98?: { prop98: number; nonProp98: number; source: SourceRef } | null;
}

export interface ReserveAccount {
	id: 'bsa' | 'psssa' | 'safetyNet' | 'surplusHolding' | 'sfeu';
	name: string;
	short: string;
	fundCode?: string;
	description: string;
	/** Ending balance by year. */
	balance: Tri;
	/** Beginning balance of the past year (so the py change can be computed). */
	beginPy: number | null;
	/** Deposit (+) / withdrawal (−) during each year. */
	change: Tri;
	/** Counted in the official "combined reserves" figure? */
	inCombined: boolean;
	sources: SourceRef[];
}

export interface FundBridge {
	begin: Tri;
	revenues: Tri;
	expenditures: Tri;
	end: Tri;
}

export interface Quote {
	id: string;
	text: string;
	doc: string;
	source: SourceRef;
}

export interface NarrativeFact {
	id: string;
	label: string;
	/** Thousands of dollars (converted from the narrative's "$X billion/million"). */
	amount: number;
	/** Fiscal year the amount applies to, when stated. */
	year?: string;
	/** As printed, e.g. "$2.9 billion". */
	printed: string;
	quoteId: string;
}

export interface Solution {
	id: string;
	label: string;
	amount: number;
	printed: string;
	year: string;
	description: string;
	quoteId: string;
}

export interface RevenueMeasure {
	id: string;
	label: string;
	/** Amount by fiscal year label, thousands. */
	byYear: Record<string, number>;
	quoteId: string;
}

export interface PlanStage {
	pit: 'p' | 'm' | 'e';
	label: string;
	date: string;
	/** Budget-year General Fund summary (thousands). */
	beginningBalance: number;
	revenuesAndTransfers: number;
	expenditures: number;
	endingBalance: number;
	sfeu: number;
	bsa: number;
	psssa: number;
	/** Figures transcribed from a printed chart image (millions) rather than parsed text. */
	transcribed: boolean;
	source: SourceRef;
}

export interface DiffItem {
	id: string;
	title: string;
	body: string;
	/** Thousands; the budget year unless `year` says otherwise. */
	amount: number | null;
	year?: string;
	tone: 'adds' | 'removes' | 'moves' | 'neutral';
	sources: SourceRef[];
}

export interface ReconCheck {
	id: string;
	label: string;
	expected: number;
	actual: number;
	difference: number;
	/** Allowed absolute difference (e.g. 1 for thousands, 1000 for millions rounding). */
	tolerance: number;
	/** True when |difference| <= tolerance (the two figures tie). */
	ok: boolean;
	/**
	 * ties      — within tolerance;
	 * explained — the figures genuinely differ, and the whole difference is accounted for by
	 *             documented, cited causes (`explanation.items` sum to `difference`);
	 * differs   — an unexplained difference (a true failure).
	 */
	status: 'ties' | 'explained' | 'differs';
	explanation?: CheckExplanation;
	note?: string;
	sources: SourceRef[];
}

export interface CheckExplanationItem {
	/** What differs, e.g. "4260 Health Care Services — federal funds, 2025-26". */
	label: string;
	/** Part of `difference` (actual − expected) this item accounts for. */
	amount: number;
	cause: string;
	sources: SourceRef[];
}
export interface CheckExplanation {
	summary: string;
	items: CheckExplanationItem[];
	/** difference − sum(items); 0 (within tolerance) when status is "explained". */
	unexplained: number;
}

export interface Reconciliation {
	fiscalYear: string;
	pit: 'p' | 'm' | 'e';
	publication: string;
	publicationDate: string;
	years: Record<YearKey, string>;
	units: 'thousands';
	generatedAt: string;

	generalFund: {
		years: Record<YearKey, GfBridgeYear>;
		sources: SourceRef[];
	};
	reserves: {
		accounts: ReserveAccount[];
		/** BSA + PSSSA + SFEU + Safety Net (the official "combined reserves" definition). */
		combined: Tri;
		/** combined + Surplus Holding Account. */
		withHolding: Tri;
	};
	specialFunds: FundBridge & {
		/** Portion of the special-fund ending balance that is actually GF reserves (BSA, PSSSA, SHA, SNR). */
		reserveAccounts: Tri;
		sources: SourceRef[];
	};
	federalAndBond: {
		federal: Tri;
		bond: Tri;
		sources: SourceRef[];
	};
	allFunds: {
		/** ebudget "all funds" budget-year total (statistics API). */
		ebudgetAllFunds: number | null;
		state: number | null;
		federal: number | null;
		reimbursements: number | null;
		nongovernmental: number | null;
		/** Loan-financed interim payments (fund 0201), excluded from spending. */
		interimLoans?: number | null;
		sources: SourceRef[];
	};
	plan: {
		stages: PlanStage[];
	};
	problem: {
		summary: string;
		facts: NarrativeFact[];
		solutions: Solution[];
		solutionsNote: string;
		revenueMeasures: RevenueMeasure[];
		quotes: Quote[];
	};
	differences: DiffItem[];
	checks: ReconCheck[];
	sources: SourceRef[];
	notes: string[];
	warnings: string[];
}

const cache = new Map<string, Promise<Reconciliation | null>>();

/**
 * Fetch `{dir}/reconciliation.json`, memoised per URL. Resolves to `null` when the file is
 * not published for this dataset (404 or SPA HTML fallback) so pages can show an empty state.
 */
export function getReconciliation(
	dir: string,
	f: typeof fetch = fetch
): Promise<Reconciliation | null> {
	const url = dataUrl(`${dir}/reconciliation.json`);
	let p = cache.get(url);
	if (!p) {
		p = f(url).then(async (r) => {
			if (r.status === 404) return null;
			if (!r.ok)
				throw new DataError(`Could not load reconciliation.json (HTTP ${r.status})`, r.status, url);
			const text = await r.text();
			if (/^\s*</.test(text)) return null;
			return JSON.parse(text) as Reconciliation;
		});
		cache.set(url, p);
		p.catch(() => cache.delete(url));
	}
	return p;
}

/**
 * Strip build-process detail (internal ids, fund and department codes, file names) from a
 * reconciliation string, keeping its plain-language meaning.
 */
export function plainText(s: string): string {
	return (
		s
			// "Details: reconciliation page, check explorer-general-cy."
			.replace(/\s*Details:[^.]*\bcheck [\w-]+\.?/g, '')
			// "(meta.json)" and similar file references
			.replace(/\s*\([\w-]+\.json\)/g, '')
			// "(fund 1011)", "fund 0201 ", "Schedule 10 fund 1032"
			.replace(/\s*\(fund \d{4}\)/g, '')
			.replace(/,\s*fund \d{4}\)/g, ')')
			.replace(/;\s*ebudget class “(\w+)”/g, '; listed online as a $1 fund')
			.replace(
				/ebudget’s expenditures-by-fund API/g,
				'ebudget.ca.gov’s online spending-by-fund data'
			)
			.replace(/\bin the API\b/g, 'online')
			.replace(/\bfund \d{4}\s+/g, '')
			.replace(/(Schedule \d+) fund \d{4}/g, '$1')
			// leading department / fund codes: "4260 Health Care Services", "; 3340 California …"
			.replace(/(^|[;:(]\s*|—\s*)\d{4} (?=[A-Z])/g, '$1')
			.replace(/\bGF\b/g, 'General Fund')
			.replace(/: explorer (\w+) spending total/g, ': this explorer’s $1-fund spending total')
			.replace(/\s{2,}/g, ' ')
			.trim()
	);
}

/**
 * Notes meant for the public. Notes that only restate an explained check (they end with a
 * pointer to that check) are dropped, since the check itself is shown on the page.
 */
export function publicNotes(notes: string[]): string[] {
	return notes.filter((n) => !/\bcheck [\w-]+\.?\s*$/.test(n)).map(plainText);
}
