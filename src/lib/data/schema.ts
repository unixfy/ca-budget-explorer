/**
 * CA Budget Explorer — canonical, year-agnostic data contract.
 *
 * Every ETL (any fiscal year, any publication stage) emits files matching these
 * types under `static/data/{fiscalYear}/{pit}/`. The UI only ever depends on this file.
 *
 * Layout on disk:
 *   static/data/manifest.json                         -> Manifest
 *   static/data/{fy}/{pit}/meta.json                  -> DatasetMeta
 *   static/data/{fy}/{pit}/expenditures.json          -> BudgetNode (root -> agency -> department)
 *   static/data/{fy}/{pit}/revenues.json              -> BudgetNode (root -> fundType -> revenueCategory -> revenueSource ...)
 *   static/data/{fy}/{pit}/funds.json                 -> Record<fundCode, Fund>
 *   static/data/{fy}/{pit}/flows.json                 -> Flows (revenue -> fund type -> agency; sankey-ready)
 *   static/data/{fy}/{pit}/departments/{orgCode}.json -> DepartmentDetail (lazy-loaded drill-down)
 *   static/data/{fy}/{pit}/search.json                -> SearchEntry[]
 *
 * Conventions:
 *   - All money is in THOUSANDS of dollars (the official ebudget/DOF convention), as numbers.
 *     `null` = not reported / not applicable; 0 = reported as zero.
 *   - Every amount is a 3-year triple keyed by relative year (py = past year actuals,
 *     cy = current year estimate, by = budget year). Absolute labels live in DatasetMeta.years.
 *   - Codes are the official ones, as strings with leading zeros preserved
 *     (orgCode "0250", fundCode "0001", programCode "0150010", item "0250-001-0001").
 *   - Node ids are stable, slash-delimited paths that are unique within a dataset and
 *     identical across years for the same entity, e.g. "exp/0010/0250/0150010",
 *     "rev/gf/major/pit". This is what makes year-over-year comparison possible.
 */

export type Pit = 'p' | 'm' | 'e'; // Governor's Budget (Jan) | May Revision | Enacted

export const PIT_LABELS: Record<Pit, string> = {
	p: "Governor's Budget",
	m: 'May Revision',
	e: 'Enacted Budget'
};

/** Values for the three fiscal years shown in every CA budget publication. */
export interface Triple {
	py: number | null;
	cy: number | null;
	by: number | null;
}

/** Official fund-type taxonomy used by DOF. */
export type FundType =
	| 'general' // General Fund (0001)
	| 'special' // Special funds
	| 'bond' // Bond funds
	| 'federal' // Federal trust fund / federal funds
	| 'reimbursement' // Reimbursements (0995)
	| 'nongovernmental' // Nongovernmental cost funds
	| 'interimLoan' // Loan-financed interim payments (e.g. 0201 Medical Providers Interim Payment Fund)
	| 'other';

/**
 * Fund types that are NOT spending and are never included in `amounts` or `byFundType`:
 * reimbursements (inter-department payments, already counted where the money originates) and
 * nongovernmental cost funds (UC/CSU own funds, CalPERS/CalSTRS trust funds, local property tax,
 * disability insurance... money the state holds or passes through), and loan-financed interim
 * payments (0201 Medical Providers Interim Payment Fund: General Fund / Federal Trust Fund loans
 * whose expenditures are moved to the regular Budget Act items, so DOF Schedule 9 does not count
 * them). ebudget's "all funds" total includes them; this dataset reports them separately via
 * `excluded` / `excludedChildren`.
 */
export const NON_SPENDING_FUND_TYPES = ['reimbursement', 'nongovernmental', 'interimLoan'] as const;
export type NonSpendingFundType = (typeof NON_SPENDING_FUND_TYPES)[number];

export type NodeKind =
	| 'root'
	| 'agency'
	| 'subagency'
	| 'department'
	| 'program'
	| 'subprogram'
	| 'element'
	| 'component'
	| 'fundType'
	| 'fund'
	| 'item' // Budget Act appropriation item, e.g. 0250-001-0001
	| 'category' // expenditure category (Personal Services, OE&E, Local Assistance...)
	| 'object' // detailed object of expenditure line
	| 'revenueCategory'
	| 'revenueSource'
	| 'project' // capital outlay project
	| 'other';

export interface SourceRef {
	/** Human label, e.g. "ebudget.ca.gov API: orgProgram/0250" or "DOF Summary Schedule 8". */
	label: string;
	/** Canonical URL of the official source document/endpoint. */
	url: string;
	/** Page number for PDF sources, when applicable. */
	page?: number;
}

/**
 * The universal hierarchical unit. Expenditure trees, revenue trees, fund breakdowns,
 * program trees and category trees are all BudgetNodes, so a single set of UI
 * components (treemap, sunburst, 3D city, table, breadcrumb) can render any of them.
 */
export interface BudgetNode {
	id: string;
	kind: NodeKind;
	name: string;
	/** Official code (orgCode, programCode, fundCode, revenue code, item number...). */
	code?: string;
	/** Short/abbreviated name for tight spaces. */
	shortName?: string;
	amounts: Triple;
	/** Authorized positions (personnel years), when the source reports them. */
	positions?: Triple;
	/** Breakdown of `amounts` by fund type (sums to amounts where data permits). */
	byFundType?: Partial<Record<FundType, Triple>>;
	/** Plain-text (or sanitized minimal HTML) official description/narrative. */
	description?: string;
	/** If set, a DepartmentDetail exists at departments/{detailRef}.json. */
	detailRef?: string;
	children?: BudgetNode[];
	sources?: SourceRef[];
	/** Non-spending amounts for this node, NOT included in `amounts` (see NON_SPENDING_FUND_TYPES). */
	excluded?: Partial<Record<NonSpendingFundType, Triple>>;
	/** Children funded entirely by non-spending fund types; shown separately, never summed. */
	excludedChildren?: BudgetNode[];
	/** Escape hatch for source-specific fields we want to keep but not model yet. */
	extra?: Record<string, unknown>;
}

export interface Fund {
	code: string;
	name: string;
	type: FundType;
	/** Optional fund condition statement (beginning balance, revenues, expenditures, reserve). */
	condition?: {
		beginningBalance?: Triple;
		revenues?: Triple;
		transfers?: Triple;
		expenditures?: Triple;
		endingBalance?: Triple;
	};
	sources?: SourceRef[];
}

/** Full drill-down for one department (lazy-loaded). */
export interface DepartmentDetail {
	orgCode: string;
	name: string;
	agencyCode: string;
	agencyName: string;
	description?: string;
	website?: string;
	totals: {
		amounts: Triple;
		positions?: Triple;
		excluded?: Partial<Record<NonSpendingFundType, Triple>>;
	};
	/** Program -> subprogram -> element tree (from "Detailed Expenditures by Program"). */
	programs: BudgetNode;
	/** Fund type -> fund -> appropriation item tree (from "Detailed Budget Adjustments"/"Funding"). */
	funding: BudgetNode;
	/** Category -> object-of-expenditure tree (Personal Services, OE&E, Local Assistance...). */
	categories?: BudgetNode;
	/** Capital outlay / infrastructure projects. */
	projects?: BudgetNode;
	/** Workload / statistical items, budget change proposals, anything else tabular. */
	tables?: {
		title: string;
		columns: string[];
		rows: (string | number | null)[][];
		source?: SourceRef;
	}[];
	sources: SourceRef[];
}

export interface FlowNode {
	id: string; // matches a BudgetNode id when one exists
	name: string;
	column: number; // 0 = revenue sources, 1 = funds/fund types, 2 = agencies/spending areas
	kind: NodeKind;
}

export interface Flows {
	year: 'py' | 'cy' | 'by';
	nodes: FlowNode[];
	links: { source: string; target: string; value: number }[];
	sources: SourceRef[];
}

export interface SearchEntry {
	id: string;
	name: string;
	kind: NodeKind;
	code?: string;
	/** Breadcrumb of ancestor names, root-first. */
	path: string[];
	/** Budget-year amount for ranking. */
	by: number | null;
	/** Department orgCode to load for detail, when applicable. */
	detailRef?: string;
	tree: 'expenditures' | 'revenues' | 'department';
}

export interface DatasetMeta {
	fiscalYear: string; // "2026-27"
	pit: Pit;
	publication: string; // "Enacted"
	publicationDate: string; // "Enacted on June 29, 2026"
	years: { py: string; cy: string; by: string }; // absolute labels
	units: 'thousands';
	totals: {
		expenditures: Triple;
		revenues: Triple;
		expendituresByFundType: Partial<Record<FundType, Triple>>;
		revenuesByFundType: Partial<Record<FundType, Triple>>;
		/** Non-spending amounts kept out of `expenditures` (reimbursements, nongovernmental). */
		excluded?: Partial<Record<NonSpendingFundType, Triple>>;
	};
	counts: {
		agencies: number;
		departments: number;
		programs: number;
		funds: number;
		lineItems: number;
	};
	sources: SourceRef[];
	generatedAt: string; // ISO timestamp
	/** Known gaps / caveats, shown in the UI. */
	notes: string[];
}

export interface Manifest {
	defaultYear: string;
	defaultPit: Pit;
	datasets: { fiscalYear: string; pit: Pit; publication: string; path: string }[];
}
