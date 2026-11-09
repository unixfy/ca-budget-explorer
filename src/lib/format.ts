/**
 * Shared number formatting. All budget amounts arrive in THOUSANDS of dollars.
 */
import type { BudgetNode, FundType, NodeKind, Triple } from './data/schema';

export type YearKey = 'py' | 'cy' | 'by';

/** Format an amount given in thousands of dollars: 312_400_000 -> "$312.4B". */
export function money(
	thousands: number | null | undefined,
	opts: { digits?: number; sign?: boolean } = {}
): string {
	if (thousands == null || Number.isNaN(thousands)) return '—';
	const d = thousands * 1000;
	const abs = Math.abs(d);
	const sign = d < 0 ? '−' : opts.sign && d > 0 ? '+' : '';
	const digits = opts.digits ?? 1;
	const fmt = (v: number, suffix: string) => {
		const s = v.toFixed(digits);
		return `${sign}$${s.replace(/\.0+$/, '')}${suffix}`;
	};
	if (abs >= 1e12) return fmt(abs / 1e12, 'T');
	if (abs >= 1e9) return fmt(abs / 1e9, 'B');
	if (abs >= 1e6) return fmt(abs / 1e6, 'M');
	if (abs >= 1e3) return fmt(abs / 1e3, 'K');
	return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
}

/** Full-precision dollars, e.g. for tooltips/tables: "$312,400,000,000". */
export function moneyFull(thousands: number | null | undefined): string {
	if (thousands == null) return '—';
	const d = Math.round(thousands * 1000);
	return (d < 0 ? '−$' : '$') + Math.abs(d).toLocaleString('en-US');
}

export function num(n: number | null | undefined, digits = 0): string {
	if (n == null) return '—';
	return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function pct(r: number | null | undefined, digits = 1, sign = false): string {
	if (r == null || !Number.isFinite(r)) return '—';
	const s = (Math.abs(r) * 100).toFixed(digits);
	return (r < 0 ? '−' : sign && r > 0 ? '+' : '') + s + '%';
}

/** Change between two values; null when either is missing. rel is null when base is zero. */
export function delta(from: number | null | undefined, to: number | null | undefined) {
	if (from == null || to == null) return null;
	const abs = to - from;
	const rel = from === 0 ? null : abs / Math.abs(from);
	return { abs, rel };
}

export const YEAR_LABEL: Record<YearKey, string> = {
	py: 'Past year',
	cy: 'Current year',
	by: 'Budget year'
};

export const FUND_TYPE_LABEL: Record<FundType, string> = {
	general: 'General Fund',
	special: 'Special Funds',
	bond: 'Bond Funds',
	federal: 'Federal Funds',
	reimbursement: 'Reimbursements',
	nongovernmental: 'Nongovernmental Cost Funds',
	interimLoan: 'Loan-Financed Interim Payments',
	other: 'Other Funds'
};

export const KIND_LABEL: Record<NodeKind, string> = {
	root: 'Total',
	agency: 'Agency',
	subagency: 'Sub-agency',
	department: 'Department',
	program: 'Program',
	subprogram: 'Subprogram',
	element: 'Element',
	component: 'Component',
	fundType: 'Fund type',
	fund: 'Fund',
	item: 'Appropriation item',
	category: 'Category',
	object: 'Object of expenditure',
	revenueCategory: 'Revenue category',
	revenueSource: 'Revenue source',
	project: 'Project',
	other: 'Other'
};

/** 'all' = all spending funds, labelled "State + federal funds" (General + special + bond +
 * federal; reimbursements and nongovernmental cost funds are never spending — see
 * NON_SPENDING_FUND_TYPES);
 * 'state' = General + special + bond funds (DOF's "total state funds"). */
export type FundFilter = 'all' | 'state' | FundType;

export const COMPOSITE_FUNDS: Partial<Record<FundFilter, FundType[]>> = {
	state: ['general', 'special', 'bond']
};

const YEARS: YearKey[] = ['py', 'cy', 'by'];

/** Value of a node for a year under a fund filter ('all' = all funds). */
export function valueOf(
	node: Pick<BudgetNode, 'amounts' | 'byFundType'>,
	year: YearKey,
	fund: FundFilter = 'all'
): number | null {
	return tripleOf(node, fund)[year];
}

export function tripleOf(
	node: Pick<BudgetNode, 'amounts' | 'byFundType'>,
	fund: FundFilter = 'all'
): Triple {
	if (fund === 'all') return node.amounts;
	const bft = node.byFundType;
	// no breakdown at all -> unknown
	if (!bft) return { py: null, cy: null, by: null };
	const types = COMPOSITE_FUNDS[fund] ?? [fund as FundType];
	const out = { py: 0, cy: 0, by: 0 } as Triple;
	for (const y of YEARS) {
		let sum = 0;
		let any = false;
		for (const t of types) {
			const v = bft[t]?.[y];
			if (v != null) {
				sum += v;
				any = true;
			}
		}
		// a breakdown exists but lacks these fund types -> zero
		out[y] = any || Object.keys(bft).length ? sum : null;
	}
	return out;
}

/**
 * Lower-case label of a fund filter, for use mid-sentence. 'all' is "state + federal funds",
 * not DOF's "all funds" ($793.7B in 2026-27), which also counts reimbursements and
 * nongovernmental cost funds.
 */
export const fundFilterLabel = (f: FundFilter): string =>
	f === 'all' ? 'state + federal funds' : f === 'state' ? 'state funds' : FUND_TYPE_LABEL[f];

/** Fund filter choices, in menu order (default first). */
export const FUND_FILTER_OPTIONS: { v: FundFilter; label: string; hint: string }[] = [
	{ v: 'state', label: 'State funds', hint: 'General Fund + special funds + bond funds' },
	{ v: 'all', label: 'State + federal funds', hint: 'State funds plus federal funds' },
	{ v: 'general', label: 'General Fund', hint: 'The main state account, mostly taxes' },
	{ v: 'special', label: 'Special funds', hint: 'State money set aside by law for a purpose' },
	{ v: 'federal', label: 'Federal funds', hint: 'Money from the federal government' }
];

/** Plain phrase for what a fund filter counts, e.g. "in state funds". */
export const fundFilterPhrase = (f: FundFilter): string =>
	f === 'all'
		? 'in state and federal funds'
		: f === 'state'
			? 'in state funds'
			: f === 'general'
				? 'from the General Fund'
				: `from ${FUND_TYPE_LABEL[f].toLowerCase()}`;

export const displayName = (n: Pick<BudgetNode, 'name' | 'shortName'>, short = false) =>
	short ? (n.shortName ?? n.name) : n.name;

/** Amount in words for headlines: 351_700_000 (thousands) -> "$351.7 billion". */
export function moneyWords(thousands: number | null | undefined, digits = 1): string {
	if (thousands == null || Number.isNaN(thousands)) return '—';
	const d = thousands * 1000;
	const abs = Math.abs(d);
	const sign = d < 0 ? '−' : '';
	const fmt = (v: number, unit: string) =>
		`${sign}$${v.toFixed(digits).replace(/\.0+$/, '')} ${unit}`;
	if (abs >= 1e12) return fmt(abs / 1e12, 'trillion');
	if (abs >= 1e9) return fmt(abs / 1e9, 'billion');
	if (abs >= 1e6) return fmt(abs / 1e6, 'million');
	return money(thousands, { digits });
}
