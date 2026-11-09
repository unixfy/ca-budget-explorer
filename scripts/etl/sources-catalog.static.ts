/**
 * Hand-curated part of the sources catalog: official places California budget information is
 * published that this explorer does NOT (yet) use. Merged into the generated tree by
 * scripts/etl/sources-catalog.ts.
 *
 * `verified: true`  = the URL answered HTTP 200 to a plain request when this list was written
 *                     (2026-11). `verified: false` = the site blocks automated requests (403 or a
 *                     captcha page), so the link could not be checked; it is the publisher's
 *                     well-known entry point and should still work in a browser.
 */
import type { CatalogNode } from '../../src/lib/data/sources-catalog.ts';

type N = Omit<CatalogNode, 'used' | 'level' | 'children'> & {
	level?: CatalogNode['level'];
	children?: N[];
};

const DOF = 'https://dof.ca.gov';

/** Publishers not used by the explorer. `fy` is the budget year (e.g. "2026-27"). */
export function externalPublishers(fy: string): CatalogNode[] {
	const pubs: N[] = [
		{
			id: 'ext/dof-site',
			name: 'dof.ca.gov (Dept. of Finance)',
			kind: 'official',
			url: `${DOF}/budget/`,
			verified: true,
			description:
				'DOF’s own website. ebudget.ca.gov carries the budget publications; dof.ca.gov carries the history, the rule books for reading them, mid-year adjustments and monthly cash/revenue tracking.',
			children: [
				{
					id: 'ext/dof/history',
					name: 'Historical budget information',
					level: 'publication',
					url: `${DOF}/budget/historical-budget-information/`,
					verified: true,
					children: [
						{
							id: 'ext/dof/hist-pubs',
							name: 'Historical budget publications (past Governor’s Budgets, May Revisions, Enacted)',
							url: `${DOF}/budget/historical-budget-information/historical-budget-publications/`,
							verified: true,
							formats: ['PDF', 'HTML'],
							years: 'decades of past budgets',
							units: 'thousands of dollars'
						},
						{
							id: 'ext/dof/sched-hist',
							name: 'Summary schedules & historical charts',
							url: `${DOF}/budget/historical-budget-information/summary-schedules-and-historical-charts/`,
							verified: true,
							formats: ['PDF', 'XLSX'],
							years: 'multi-decade series',
							description:
								'Long-run General Fund and special fund revenue/expenditure history, the only place for consistent multi-year series.'
						}
					]
				},
				{
					id: 'ext/dof/adjust',
					name: 'Spring adjustments to the Governor’s Budget',
					level: 'publication',
					url: `${DOF}/budget/budget-details/`,
					verified: true,
					description:
						'Between January and May, DOF sends the Legislature formal letters proposing changes. They are not reflected in ebudget’s January detail.',
					children: [
						{
							id: 'ext/dof/april1',
							name: `${fy} Proposed April 1 adjustments (Finance Letters)`,
							url: `${DOF}/budget/historical-budget-information/historical-budget-publications/${fy}-proposed-april-1st-adjustments-to-the-governors-budget/`,
							verified: true,
							formats: ['PDF'],
							granularity: 'appropriation item'
						},
						{
							id: 'ext/dof/maylet',
							name: `${fy} Proposed May adjustments (May Revision letters)`,
							url: `${DOF}/budget/historical-budget-information/historical-budget-publications/${fy}-proposed-may-adjustments-to-the-governors-budget/`,
							verified: true,
							formats: ['PDF'],
							granularity: 'appropriation item',
							description:
								'The item-level detail of the May Revision, which ebudget only publishes as department totals.'
						},
						{
							id: 'ext/dof/bcp',
							name: 'Budget Change Proposals (BCPs)',
							url: `${DOF}/budget/budget-details/good-budget-change-proposals-bcps/`,
							verified: true,
							formats: ['PDF'],
							granularity: 'individual proposal',
							description: 'Department-by-department justification for each proposed change.'
						}
					]
				},
				{
					id: 'ext/dof/rules',
					name: 'Rule books & code lists',
					level: 'publication',
					kind: 'reference',
					url: `${DOF}/budget/resources-for-departments/`,
					verified: true,
					description: 'You need these to decode the numeric codes printed in every schedule.',
					children: [
						{
							id: 'ext/dof/msf',
							name: 'Manual of State Funds',
							kind: 'reference',
							url: `${DOF}/budget/resources-for-departments/manual-of-state-funds/`,
							verified: true,
							formats: ['PDF', 'HTML'],
							granularity: 'fund (4-digit fund code)',
							description:
								'Legal authority, purpose and classification of every fund (≈850 in this budget).'
						},
						{
							id: 'ext/dof/ucm',
							name: 'Uniform Codes Manual',
							kind: 'reference',
							url: `${DOF}/accounting/accounting-policies-and-procedures/accounting-policies-and-procedures-uniform-codes-manual/`,
							verified: true,
							formats: ['PDF', 'XLSX'],
							granularity: 'organization, fund, revenue and object codes',
							description:
								'The official code lists: organization codes, revenue source codes (e.g. 4110400 Cigarette Tax), objects of expenditure.'
						},
						{
							id: 'ext/dof/bl',
							name: 'Budget Letters',
							kind: 'reference',
							url: `${DOF}/budget/resources-for-departments/budget-letters/`,
							verified: true,
							formats: ['PDF'],
							description: 'Instructions to departments (e.g. how the budget is to be prepared).'
						}
					]
				},
				{
					id: 'ext/dof/periodic',
					name: 'Periodic reports',
					level: 'publication',
					url: `${DOF}/reports/`,
					verified: true,
					children: [
						{
							id: 'ext/dof/bulletin',
							name: 'Finance Bulletins (monthly economic & cash revenue update)',
							url: `${DOF}/forecasting/economics/economic-and-revenue-updates/`,
							verified: true,
							formats: ['PDF'],
							units: 'millions of dollars',
							years: 'monthly',
							description:
								'Monthly General Fund cash receipts vs. the budget forecast, the earliest sign a budget is off track.'
						},
						{
							id: 'ext/dof/cashflow',
							name: `${fy} General Fund cash flow projection`,
							url: `${DOF}/media/docs/budget/budget-reports-and-analyses/${fy}-Cash-Flow-Projection.pdf`,
							verified: true,
							formats: ['PDF'],
							units: 'millions of dollars',
							granularity: 'month'
						},
						{
							id: 'ext/dof/reports',
							name: 'Budget reports & analyses (multi-year projection, cash management)',
							url: `${DOF}/budget/budget-reports-and-analyses/`,
							verified: true,
							formats: ['PDF']
						},
						{
							id: 'ext/dof/sw',
							name: `${fy} Salaries and Wages Supplement`,
							url: `${DOF}/budget/salaries-and-wages/`,
							verified: true,
							formats: ['PDF'],
							granularity: 'position classification, by department',
							count: 14,
							description: 'Authorized positions and salary ranges; 14 PDFs, one per agency area.'
						},
						{
							id: 'ext/dof/demog',
							name: 'Demographic Research Unit (population estimates)',
							url: `${DOF}/forecasting/demographics/`,
							verified: true,
							formats: ['XLSX', 'PDF'],
							description: 'Population figures behind every “per capita” number (e.g. Schedule 6).'
						}
					]
				},
				{
					id: 'ext/dof/tbl',
					name: 'Trailer bill language',
					level: 'publication',
					url: 'https://trailerbill.dof.ca.gov/trailerBill.html',
					verified: true,
					formats: ['HTML', 'PDF'],
					description:
						'Draft statutory changes that implement the budget (the policy that the Budget Act’s dollars depend on).'
				}
			]
		},
		{
			id: 'ext/legislature',
			name: 'California State Legislature',
			kind: 'official',
			url: 'https://leginfo.legislature.ca.gov/',
			verified: false,
			description:
				'The Legislature passes the actual law: the Budget Act, “budget bill juniors” that amend it during the year, and trailer bills. Committee staff publish their own summaries, with their own category conventions.',
			children: [
				{
					id: 'ext/leg/leginfo',
					name: 'leginfo.legislature.ca.gov — bill text',
					level: 'publication',
					url: 'https://leginfo.legislature.ca.gov/',
					verified: false,
					children: [
						{
							id: 'ext/leg/budget-act',
							name: 'Budget Act (the enacted budget bill)',
							url: 'https://leginfo.legislature.ca.gov/',
							verified: false,
							formats: ['HTML', 'PDF'],
							units: 'dollars',
							granularity: 'appropriation item + provisions',
							description:
								'The legal appropriations, item by item, in whole dollars, with provisional language. Amounts differ from the budget display, which also shows non-Budget Act (continuous/statutory) spending.'
						},
						{
							id: 'ext/leg/bbj',
							name: 'Budget bill juniors (amendments to the Budget Act)',
							url: 'https://leginfo.legislature.ca.gov/',
							verified: false,
							formats: ['HTML', 'PDF'],
							units: 'dollars'
						},
						{
							id: 'ext/leg/trailer',
							name: 'Trailer bills (statutory changes implementing the budget)',
							url: 'https://leginfo.legislature.ca.gov/',
							verified: false,
							formats: ['HTML', 'PDF']
						}
					]
				},
				{
					id: 'ext/leg/senate',
					name: 'Senate Budget & Fiscal Review Committee',
					level: 'publication',
					url: 'https://sbud.senate.ca.gov/',
					verified: true,
					children: [
						{
							id: 'ext/leg/sen-summary',
							name: 'Budget overviews & summary action reports',
							url: 'https://sbud.senate.ca.gov/publications/budget-overviews-and-summary-action-reports',
							verified: true,
							formats: ['PDF'],
							years: 'since 2002-03'
						},
						{
							id: 'ext/leg/sen-final',
							name: 'Final action reports',
							url: 'https://sbud.senate.ca.gov/publications/final-action-reports',
							verified: true,
							formats: ['PDF']
						}
					]
				},
				{
					id: 'ext/leg/assembly',
					name: 'Assembly Budget Committee',
					level: 'publication',
					url: 'https://abgt.assembly.ca.gov/',
					verified: true,
					children: [
						{
							id: 'ext/leg/asm-floor',
							name: 'Floor reports',
							url: 'https://abgt.assembly.ca.gov/welcome-assembly-committee-budget/reports/floor-reports',
							verified: true,
							formats: ['PDF'],
							units: 'millions of dollars'
						},
						{
							id: 'ext/leg/asm-reports',
							name: 'Highlights of the Governor’s Budget / May Revision',
							url: 'https://abgt.assembly.ca.gov/welcome-assembly-committee-budget/reports',
							verified: true,
							formats: ['PDF']
						}
					]
				}
			]
		},
		{
			id: 'ext/sco',
			name: 'State Controller’s Office',
			kind: 'official',
			url: 'https://www.sco.ca.gov/',
			verified: false,
			description:
				'The Controller pays the bills and keeps the books, so it reports what was actually spent and received, on two different accounting bases.',
			children: [
				{
					id: 'ext/sco/reports',
					name: 'State financial reports',
					level: 'publication',
					url: 'https://www.sco.ca.gov/',
					verified: false,
					children: [
						{
							id: 'ext/sco/acfr',
							name: 'Annual Comprehensive Financial Report (ACFR, GAAP basis)',
							url: 'https://www.sco.ca.gov/',
							verified: false,
							formats: ['PDF'],
							units: 'thousands of dollars',
							description:
								'Audited, accrual-basis statements, organized by government-wide/fund statements rather than budget departments. Will not match the budget figures.'
						},
						{
							id: 'ext/sco/budgetary',
							name: 'Budgetary/Legal Basis Annual Report',
							url: 'https://www.sco.ca.gov/',
							verified: false,
							formats: ['PDF'],
							description: 'Actuals on the same (modified cash) basis as the Budget Act.'
						},
						{
							id: 'ext/sco/cash',
							name: 'Monthly cash reports',
							url: 'https://www.sco.ca.gov/',
							verified: false,
							formats: ['PDF', 'XLSX'],
							years: 'monthly'
						}
					]
				},
				{
					id: 'ext/sco/btn',
					name: 'ByTheNumbers open data (local government finances)',
					level: 'publication',
					url: 'https://bythenumbers.sco.ca.gov/',
					verified: true,
					formats: ['CSV', 'HTML'],
					description:
						'Cities, counties and special districts: where much state money ends up as local assistance.'
				}
			]
		},
		{
			id: 'ext/sto',
			name: 'State Treasurer’s Office',
			kind: 'official',
			url: 'https://www.treasurer.ca.gov/',
			verified: true,
			description: 'Issues and tracks the State’s debt: the other side of “bond funds”.',
			children: [
				{
					id: 'ext/sto/bonds',
					name: 'Bonds & debt',
					level: 'publication',
					url: 'https://www.treasurer.ca.gov/bonds/',
					verified: true,
					children: [
						{
							id: 'ext/sto/debtwatch',
							name: 'DebtWatch (issuance database)',
							url: 'https://debtwatch.treasurer.ca.gov/',
							verified: true,
							formats: ['HTML', 'CSV'],
							units: 'dollars'
						},
						{
							id: 'ext/sto/bondpage',
							name: 'State bond programs, disclosures and reports',
							url: 'https://www.treasurer.ca.gov/bonds/',
							verified: true,
							formats: ['PDF', 'HTML']
						}
					]
				}
			]
		},
		{
			id: 'ext/fiscal',
			name: 'FI$Cal (Financial Information System for California)',
			kind: 'official',
			url: 'https://open.fiscal.ca.gov/',
			verified: true,
			description:
				'The State’s accounting system. Its transparency portal publishes transaction-level spending: vendor payments, not budget programs.',
			children: [
				{
					id: 'ext/fiscal/open',
					name: 'Open FI$Cal transparency portal',
					level: 'publication',
					url: 'https://open.fiscal.ca.gov/transparency.html',
					verified: true,
					children: [
						{
							id: 'ext/fiscal/exp',
							name: 'Expenditure downloads (transactions)',
							url: 'https://open.fiscal.ca.gov/download-expenditures.html',
							verified: true,
							formats: ['CSV'],
							units: 'dollars',
							granularity: 'individual payment',
							description:
								'Coded by FI$Cal business unit/account, not by the budget display’s program codes; some departments are not on FI$Cal.'
						},
						{
							id: 'ext/fiscal/datasets',
							name: 'Other datasets',
							url: 'https://open.fiscal.ca.gov/datasets.html',
							verified: true,
							formats: ['CSV']
						}
					]
				}
			]
		},
		{
			id: 'ext/lao',
			name: 'Legislative Analyst’s Office (non-partisan analysis)',
			kind: 'analysis',
			url: 'https://lao.ca.gov/',
			verified: true,
			description:
				'Analysis, not official budget data: LAO re-estimates revenues and re-groups spending, so its numbers often differ from DOF’s on purpose.',
			children: [
				{
					id: 'ext/lao/budget',
					name: 'Budget analyses & overviews',
					level: 'publication',
					kind: 'analysis',
					url: 'https://lao.ca.gov/Budget',
					verified: true,
					children: [
						{
							id: 'ext/lao/year',
							name: `${fy.slice(0, 4)} budget publications (overview of the Governor’s Budget, May Revision, spending plan)`,
							kind: 'analysis',
							url: `https://lao.ca.gov/Budget?year=${fy.slice(0, 4)}`,
							verified: true,
							formats: ['HTML', 'PDF'],
							units: 'millions / billions of dollars'
						},
						{
							id: 'ext/lao/pubs',
							name: 'All publications (fiscal outlook, issue reports)',
							kind: 'analysis',
							url: 'https://lao.ca.gov/Publications',
							verified: true,
							formats: ['HTML', 'PDF']
						}
					]
				}
			]
		},
		{
			id: 'ext/cde',
			name: 'California Department of Education (Proposition 98)',
			kind: 'official',
			url: 'https://www.cde.ca.gov/fg/aa/pa/',
			verified: false,
			description:
				'Roughly 40% of the General Fund is governed by the Proposition 98 school-funding guarantee, which is recalculated and certified years after the budget passes.',
			children: [
				{
					id: 'ext/cde/pa',
					name: 'Principal Apportionment & Proposition 98',
					level: 'publication',
					url: 'https://www.cde.ca.gov/fg/aa/pa/',
					verified: false,
					children: [
						{
							id: 'ext/cde/p98',
							name: 'Proposition 98 guarantee & certification',
							url: 'https://www.cde.ca.gov/fg/aa/pa/p98.asp',
							verified: false,
							formats: ['HTML', 'XLSX'],
							description:
								'The guarantee for a year keeps changing until it is certified, so the “Prop 98” split in any one budget is an estimate.'
						},
						{
							id: 'ext/cde/eb',
							name: 'Education budget',
							url: 'https://www.cde.ca.gov/fg/fr/eb/',
							verified: false,
							formats: ['HTML', 'XLSX']
						}
					]
				}
			]
		},
		{
			id: 'ext/pension',
			name: 'Retirement systems (CalPERS / CalSTRS)',
			kind: 'official',
			url: 'https://www.calpers.ca.gov/',
			verified: true,
			description:
				'State pension contributions appear as budget lines, but the trust funds themselves are “nongovernmental cost funds” and their finances are reported separately.',
			children: [
				{
					id: 'ext/pension/reports',
					name: 'Annual financial reports',
					level: 'publication',
					children: [
						{
							id: 'ext/pension/calpers',
							name: 'CalPERS investment & financial reports',
							url: 'https://www.calpers.ca.gov/investments/about-investment-office/investment-financial-reports',
							verified: false,
							formats: ['PDF']
						},
						{
							id: 'ext/pension/calstrs',
							name: 'CalSTRS Annual Comprehensive Financial Report',
							url: 'https://www.calstrs.com/annual-comprehensive-financial-report',
							verified: true,
							formats: ['PDF']
						}
					]
				}
			]
		},
		{
			id: 'ext/revenue',
			name: 'Tax agencies (FTB / CDTFA)',
			kind: 'official',
			url: 'https://www.ftb.ca.gov/',
			verified: true,
			description:
				'The agencies that collect the money. Their statistics are on a collections basis, while Schedule 8 is on an accrual/budget basis.',
			children: [
				{
					id: 'ext/revenue/stats',
					name: 'Tax statistics',
					level: 'publication',
					children: [
						{
							id: 'ext/revenue/ftb',
							name: 'Franchise Tax Board data, reports & plans (income taxes)',
							url: 'https://www.ftb.ca.gov/about-ftb/data-reports-plans/',
							verified: true,
							formats: ['HTML', 'XLSX', 'PDF']
						},
						{
							id: 'ext/revenue/cdtfa',
							name: 'CDTFA open data portal (sales & excise taxes)',
							url: 'https://cdtfa.ca.gov/dataportal/',
							verified: true,
							formats: ['CSV', 'HTML']
						}
					]
				}
			]
		},
		{
			id: 'ext/oversight',
			name: 'Oversight & open data',
			kind: 'official',
			description:
				'Audits of how budgeted money was used, and the State’s general open-data portal.',
			children: [
				{
					id: 'ext/oversight/pubs',
					name: 'Audits & open data',
					level: 'publication',
					children: [
						{
							id: 'ext/oversight/bsa',
							name: 'California State Auditor reports',
							url: 'https://www.auditor.ca.gov/reports/',
							verified: true,
							formats: ['PDF', 'HTML']
						},
						{
							id: 'ext/oversight/data',
							name: 'data.ca.gov open data portal',
							url: 'https://data.ca.gov/',
							verified: true,
							formats: ['CSV', 'JSON', 'XLSX']
						}
					]
				}
			]
		}
	];

	// external branches are shallower: publisher -> publication -> document
	const conv = (n: N, depth: number): CatalogNode => {
		const kids = n.children?.map((c) => conv(c, depth + 1));
		const level = n.level ?? (depth === 0 ? 'publisher' : depth === 1 ? 'publication' : 'document');
		return {
			...n,
			level,
			used: false,
			...(kids?.length ? { children: kids } : {})
		} as CatalogNode;
	};
	return pubs.map((p) => conv(p, 0));
}
