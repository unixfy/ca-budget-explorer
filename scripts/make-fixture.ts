/**
 * Generates a small but realistic FIXTURE dataset (fy "fixture", pit "e") that conforms
 * to src/lib/data/schema.ts, so the UI can be developed before the real ETL lands.
 *
 *   npx tsx scripts/make-fixture.ts
 *
 * Writes static/data/fixture/e/** and static/data/manifest.json (only if it does not exist).
 * Amounts are invented (order-of-magnitude plausible) — NOT official figures.
 */
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type {
	BudgetNode,
	DatasetMeta,
	DepartmentDetail,
	Flows,
	Fund,
	FundType,
	Manifest,
	SearchEntry,
	SourceRef,
	Triple
} from '../src/lib/data/schema.ts';

const ROOT = join(import.meta.dirname, '..', 'static', 'data');
const OUT = join(ROOT, 'fixture', 'e');

// ---------- helpers ----------
let seed = 42;
const rnd = () => {
	seed = (seed * 1664525 + 1013904223) % 4294967296;
	return seed / 4294967296;
};
const round = (n: number) => Math.round(n);
/** by amount -> triple with plausible py/cy history */
const tri = (by: number, drift = 0.06): Triple => {
	const cy = by * (1 - drift * (rnd() - 0.3));
	const py = cy * (1 - drift * (rnd() - 0.2));
	return { py: round(py), cy: round(cy), by: round(by) };
};
const scale = (t: Triple, f: number): Triple => ({
	py: t.py == null ? null : round(t.py * f),
	cy: t.cy == null ? null : round(t.cy * f),
	by: t.by == null ? null : round(t.by * f)
});
const add = (a: Triple, b: Triple): Triple => ({
	py: (a.py ?? 0) + (b.py ?? 0),
	cy: (a.cy ?? 0) + (b.cy ?? 0),
	by: (a.by ?? 0) + (b.by ?? 0)
});
const zero = (): Triple => ({ py: 0, cy: 0, by: 0 });
const sum = (ts: Triple[]) => ts.reduce(add, zero());
const slug = (s: string) =>
	s
		.toLowerCase()
		.replace(/&/g, 'and')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');

/** split total into n weighted parts that sum exactly (on each year) */
function split(total: Triple, weights: number[]): Triple[] {
	const w = weights.reduce((a, b) => a + b, 0);
	const parts = weights.map((x) => scale(total, x / w));
	// fix rounding on the last part
	const s = sum(parts);
	const last = parts[parts.length - 1];
	for (const k of ['py', 'cy', 'by'] as const)
		last[k] = (last[k] ?? 0) + ((total[k] ?? 0) - (s[k] ?? 0));
	return parts;
}
function sumFundTypes(nodes: BudgetNode[]): Partial<Record<FundType, Triple>> {
	const out: Partial<Record<FundType, Triple>> = {};
	for (const n of nodes)
		for (const [k, v] of Object.entries(n.byFundType ?? {}) as [FundType, Triple][])
			out[k] = add(out[k] ?? zero(), v);
	return out;
}
function rollup(node: BudgetNode): BudgetNode {
	if (node.children?.length) {
		node.children.forEach(rollup);
		node.amounts = sum(node.children.map((c) => c.amounts));
		node.byFundType = sumFundTypes(node.children);
		if (node.children.some((c) => c.positions))
			node.positions = sum(node.children.map((c) => c.positions ?? zero()));
	}
	return node;
}

const EBUDGET = 'https://ebudget.ca.gov';
const src = {
	summary: {
		label: 'ebudget.ca.gov — Enacted Budget Summary (FIXTURE)',
		url: `${EBUDGET}/budget/publication/#/e/2026-27/BudgetSummary`
	},
	sched8: {
		label: 'DOF Summary Schedule 8 — Revenues (FIXTURE)',
		url: 'https://dof.ca.gov/budget/summary-schedules-and-historical-charts/'
	},
	sched9: {
		label: 'DOF Summary Schedule 9 — Expenditures by Agency (FIXTURE)',
		url: 'https://dof.ca.gov/budget/summary-schedules-and-historical-charts/'
	},
	dept: (org: string): SourceRef => ({
		label: `ebudget.ca.gov — Department ${org} detail (FIXTURE)`,
		url: `${EBUDGET}/budget/2026-27/e/Department/${org}`
	})
};

// ---------- funds ----------
const FUNDS: Record<string, Fund> = {
	'0001': { code: '0001', name: 'General Fund', type: 'general' },
	'0042': {
		code: '0042',
		name: 'State Highway Account, State Transportation Fund',
		type: 'special'
	},
	'0044': {
		code: '0044',
		name: 'Motor Vehicle Account, State Transportation Fund',
		type: 'special'
	},
	'3228': { code: '3228', name: 'Greenhouse Gas Reduction Fund', type: 'special' },
	'0236': { code: '0236', name: 'Cigarette and Tobacco Products Surtax Fund', type: 'special' },
	'3305': { code: '3305', name: 'Healthcare Treatment Fund', type: 'special' },
	'0890': { code: '0890', name: 'Federal Trust Fund', type: 'federal' },
	'0995': { code: '0995', name: 'Reimbursements', type: 'reimbursement' },
	'6088': {
		code: '6088',
		name: 'Safe Drinking Water, Water Quality, and Flood Protection Bond Fund',
		type: 'bond'
	},
	'6083': { code: '6083', name: 'Housing and Emergency Shelter Trust Fund of 2006', type: 'bond' },
	'0588': {
		code: '0588',
		name: 'Unemployment Compensation Disability Fund',
		type: 'nongovernmental'
	}
};
const FUND_BY_TYPE: Record<FundType, string[]> = {
	general: ['0001'],
	special: ['0042', '0044', '3228', '0236', '3305'],
	federal: ['0890'],
	reimbursement: ['0995'],
	bond: ['6088', '6083'],
	nongovernmental: ['0588'],
	other: []
};

// ---------- expenditure spec ----------
type Mix = Partial<Record<FundType, number>>;
interface DeptSpec {
	org: string;
	name: string;
	short?: string;
	by: number; // thousands
	mix: Mix;
	programs?: [string, string, number, string[]?][]; // code, name, weight, subprograms
	desc?: string;
	positions?: number;
}
const AGENCIES: { code: string; name: string; short?: string; depts: DeptSpec[] }[] = [
	{
		code: '0010',
		name: 'Legislative, Judicial, and Executive',
		short: 'Leg/Jud/Exec',
		depts: [
			{ org: '0110', name: 'Senate', by: 236_000, mix: { general: 1 }, positions: 0 },
			{ org: '0120', name: 'Assembly', by: 281_000, mix: { general: 1 }, positions: 0 },
			{
				org: '0250',
				name: 'Judicial Branch',
				by: 5_120_000,
				mix: { general: 0.68, special: 0.27, reimbursement: 0.05 },
				positions: 2100,
				desc: 'The Judicial Branch consists of the Supreme Court, Courts of Appeal, trial courts, and the Judicial Council. It interprets the law, protects individual rights, and resolves disputes in an impartial manner.',
				programs: [
					['0150010', 'Supreme Court', 0.012],
					['0155', 'Courts of Appeal', 0.05],
					['0160', 'Judicial Council', 0.07],
					['0165', 'Judicial Branch Facilities Program', 0.08],
					[
						'0140',
						'State Trial Court Funding',
						0.76,
						[
							'Support for Operation of the Trial Courts',
							'Compensation of Superior Court Judges',
							'Court Interpreters',
							'Assigned Judges'
						]
					],
					['0170', 'Habeas Corpus Resource Center', 0.028]
				]
			},
			{
				org: '0820',
				name: 'Department of Justice',
				by: 1_430_000,
				mix: { general: 0.58, special: 0.3, federal: 0.08, reimbursement: 0.04 },
				positions: 5200
			},
			{
				org: '0890',
				name: 'Secretary of State',
				by: 128_000,
				mix: { general: 0.55, special: 0.45 },
				positions: 520
			}
		]
	},
	{
		code: '0500',
		name: 'Business, Consumer Services and Housing',
		short: 'Housing',
		depts: [
			{
				org: '2240',
				name: 'Department of Housing and Community Development',
				short: 'HCD',
				by: 3_180_000,
				mix: { general: 0.18, special: 0.17, federal: 0.33, bond: 0.32 },
				positions: 1100
			},
			{
				org: '1700',
				name: 'Civil Rights Department',
				by: 46_000,
				mix: { general: 0.9, federal: 0.1 },
				positions: 260
			}
		]
	},
	{
		code: '2500',
		name: 'Transportation',
		depts: [
			{
				org: '2660',
				name: 'Department of Transportation',
				short: 'Caltrans',
				by: 18_400_000,
				mix: { special: 0.53, federal: 0.41, bond: 0.02, reimbursement: 0.04 },
				positions: 22000,
				desc: 'Caltrans manages more than 50,000 lane-miles of state highway and supports intercity passenger rail, aviation, and local transportation programs.',
				programs: [
					['1835', 'Aeronautics', 0.002],
					['1840', 'Capital Outlay Support', 0.13],
					[
						'1845',
						'Capital Outlay Projects',
						0.36,
						[
							'State Highway Operation and Protection Program',
							'State Transportation Improvement Program',
							'Active Transportation Program'
						]
					],
					['1850', 'Local Assistance', 0.27],
					['1860', 'Maintenance', 0.13],
					['1870', 'Transportation Planning', 0.03],
					['1875', 'Mass Transportation', 0.06],
					['1880', 'Legal', 0.02]
				]
			},
			{
				org: '2720',
				name: 'California Highway Patrol',
				short: 'CHP',
				by: 3_090_000,
				mix: { special: 0.97, federal: 0.01, reimbursement: 0.02 },
				positions: 11000
			},
			{
				org: '2740',
				name: 'Department of Motor Vehicles',
				short: 'DMV',
				by: 1_420_000,
				mix: { special: 0.99, reimbursement: 0.01 },
				positions: 8900
			}
		]
	},
	{
		code: '3000',
		name: 'Natural Resources',
		depts: [
			{
				org: '3540',
				name: 'Department of Forestry and Fire Protection',
				short: 'CAL FIRE',
				by: 4_240_000,
				mix: { general: 0.74, special: 0.14, federal: 0.04, reimbursement: 0.08 },
				positions: 12000
			},
			{
				org: '3860',
				name: 'Department of Water Resources',
				short: 'DWR',
				by: 2_870_000,
				mix: { general: 0.31, special: 0.27, bond: 0.4, federal: 0.02 },
				positions: 3900
			},
			{
				org: '3790',
				name: 'Department of Parks and Recreation',
				short: 'State Parks',
				by: 1_330_000,
				mix: { general: 0.3, special: 0.5, bond: 0.1, federal: 0.05, reimbursement: 0.05 },
				positions: 4100
			}
		]
	},
	{
		code: '3890',
		name: 'Environmental Protection',
		short: 'Environment',
		depts: [
			{
				org: '3900',
				name: 'State Air Resources Board',
				short: 'CARB',
				by: 2_610_000,
				mix: { special: 0.95, federal: 0.03, reimbursement: 0.02 },
				positions: 2000
			},
			{
				org: '3940',
				name: 'State Water Resources Control Board',
				short: 'Water Board',
				by: 1_520_000,
				mix: { general: 0.2, special: 0.35, federal: 0.3, bond: 0.15 },
				positions: 2600
			}
		]
	},
	{
		code: '4000',
		name: 'Health and Human Services',
		short: 'HHS',
		depts: [
			{
				org: '4260',
				name: 'Department of Health Care Services',
				short: 'DHCS (Medi-Cal)',
				by: 194_800_000,
				mix: { general: 0.23, special: 0.14, federal: 0.62, reimbursement: 0.01 },
				positions: 4700,
				desc: 'DHCS administers Medi-Cal, California’s Medicaid program, which provides health coverage to roughly 15 million low-income Californians, as well as behavioral health and other health care programs.',
				programs: [
					[
						'3960',
						'Medical Assistance Program',
						0.95,
						['Medi-Cal Benefits', 'County Administration', 'Fiscal Intermediary']
					],
					['3965', 'Children’s Medical Services', 0.01],
					['3970', 'Primary and Rural Health', 0.002],
					['3975', 'Health Care Services Administration', 0.008],
					['3980', 'Behavioral Health', 0.03]
				]
			},
			{
				org: '4300',
				name: 'Department of Developmental Services',
				short: 'DDS',
				by: 18_100_000,
				mix: { general: 0.61, federal: 0.37, reimbursement: 0.02 },
				positions: 3000
			},
			{
				org: '4440',
				name: 'Department of State Hospitals',
				short: 'State Hospitals',
				by: 3_310_000,
				mix: { general: 0.95, reimbursement: 0.05 },
				positions: 13600
			},
			{
				org: '4265',
				name: 'Department of Public Health',
				short: 'Public Health',
				by: 6_020_000,
				mix: { general: 0.2, special: 0.25, federal: 0.5, reimbursement: 0.05 },
				positions: 4600
			},
			{
				org: '5180',
				name: 'Department of Social Services',
				short: 'Social Services',
				by: 50_300_000,
				mix: { general: 0.46, federal: 0.43, reimbursement: 0.11 },
				positions: 5100
			}
		]
	},
	{
		code: '5210',
		name: 'Corrections and Rehabilitation',
		short: 'Corrections',
		depts: [
			{
				org: '5225',
				name: 'Department of Corrections and Rehabilitation',
				short: 'CDCR',
				by: 14_200_000,
				mix: { general: 0.96, special: 0.01, reimbursement: 0.03 },
				positions: 56000,
				desc: 'CDCR is responsible for the incarceration of adult felons, including the provision of rehabilitative programs, health care, and supervision of parolees.',
				programs: [
					['4500', 'Corrections and Rehabilitation Administration', 0.06],
					['4505', 'Juvenile Justice', 0.01],
					[
						'4530',
						'Adult Corrections and Rehabilitation Operations',
						0.52,
						['Security', 'Inmate Support', 'Contracted Facilities']
					],
					['4540', 'Parole Operations — Adult Supervision', 0.07],
					['4550', 'Board of Parole Hearings', 0.01],
					['4560', 'Adult Rehabilitative Programs', 0.05],
					['4570', 'Adult Health Care Services', 0.28]
				]
			},
			{
				org: '5227',
				name: 'Board of State and Community Corrections',
				short: 'BSCC',
				by: 410_000,
				mix: { general: 0.65, special: 0.2, federal: 0.15 },
				positions: 160
			}
		]
	},
	{
		code: '6010',
		name: 'K thru 12 Education',
		short: 'K-12',
		depts: [
			{
				org: '6100',
				name: 'Department of Education',
				short: 'CDE',
				by: 82_400_000,
				mix: { general: 0.73, special: 0.14, federal: 0.12, reimbursement: 0.01 },
				positions: 2400,
				desc: 'The California Department of Education oversees the state’s public school system, which serves roughly 5.8 million students in about 10,000 schools.',
				programs: [
					[
						'5200',
						'K-12 Education',
						0.92,
						[
							'Local Control Funding Formula',
							'Special Education',
							'Child Nutrition',
							'Expanded Learning Opportunities'
						]
					],
					['5205', 'Child Care and Development', 0.07],
					['5210', 'State Operations', 0.01]
				]
			},
			{
				org: '6360',
				name: 'Commission on Teacher Credentialing',
				by: 112_000,
				mix: { general: 0.4, special: 0.6 },
				positions: 280
			}
		]
	},
	{
		code: '6013',
		name: 'Higher Education',
		short: 'Higher Ed',
		depts: [
			{
				org: '6440',
				name: 'University of California',
				short: 'UC',
				by: 5_210_000,
				mix: { general: 0.97, special: 0.03 }
			},
			{
				org: '6610',
				name: 'California State University',
				short: 'CSU',
				by: 5_870_000,
				mix: { general: 0.98, special: 0.02 }
			},
			{
				org: '6870',
				name: 'California Community Colleges',
				short: 'Community Colleges',
				by: 9_040_000,
				mix: { general: 0.94, special: 0.04, federal: 0.02 },
				positions: 180
			},
			{
				org: '7980',
				name: 'California Student Aid Commission',
				short: 'CSAC',
				by: 4_130_000,
				mix: { general: 0.88, special: 0.03, federal: 0.01, reimbursement: 0.08 },
				positions: 400
			}
		]
	},
	{
		code: '7000',
		name: 'Labor and Workforce Development',
		short: 'Labor',
		depts: [
			{
				org: '7100',
				name: 'Employment Development Department',
				short: 'EDD',
				by: 23_100_000,
				mix: { general: 0.02, federal: 0.42, nongovernmental: 0.54, reimbursement: 0.02 },
				positions: 9000
			},
			{
				org: '7350',
				name: 'Department of Industrial Relations',
				by: 820_000,
				mix: { general: 0.06, special: 0.9, federal: 0.02, reimbursement: 0.02 },
				positions: 3300
			}
		]
	},
	{
		code: '7500',
		name: 'Government Operations',
		short: 'Gov Ops',
		depts: [
			{
				org: '7760',
				name: 'Department of General Services',
				short: 'DGS',
				by: 1_310_000,
				mix: { general: 0.1, special: 0.8, reimbursement: 0.1 },
				positions: 3800
			},
			{
				org: '7730',
				name: 'Franchise Tax Board',
				short: 'FTB',
				by: 1_120_000,
				mix: { general: 0.92, special: 0.05, reimbursement: 0.03 },
				positions: 6600
			}
		]
	},
	{
		code: '9000',
		name: 'General Government',
		short: 'General Gov',
		depts: [
			{ org: '9350', name: 'Shared Revenues', by: 3_820_000, mix: { special: 1 } },
			{
				org: '9650',
				name: 'Health and Dental Benefits for Annuitants',
				by: 5_030_000,
				mix: { general: 0.6, special: 0.4 }
			},
			{
				org: '9800',
				name: 'Augmentation for Employee Compensation',
				by: 1_190_000,
				mix: { general: 0.7, special: 0.3 }
			}
		]
	}
];

// ---------- build expenditures + department details ----------
const details: DepartmentDetail[] = [];
const expRoot: BudgetNode = {
	id: 'exp',
	kind: 'root',
	name: 'State Expenditures',
	amounts: zero(),
	sources: [src.summary, src.sched9],
	children: []
};

const CATEGORIES: [string, string, number, [string, string, number][]][] = [
	[
		'ps',
		'Personal Services',
		0.22,
		[
			['salaries', 'Salaries and Wages', 0.68],
			['benefits', 'Staff Benefits', 0.32]
		]
	],
	[
		'oee',
		'Operating Expenses and Equipment',
		0.14,
		[
			['general', 'General Expense', 0.2],
			['consult', 'Consulting and Professional Services', 0.45],
			['it', 'Information Technology', 0.2],
			['facilities', 'Facilities Operation', 0.15]
		]
	],
	[
		'la',
		'Local Assistance',
		0.6,
		[
			['grants', 'Grants and Subventions', 0.85],
			['other', 'Other Local Assistance', 0.15]
		]
	],
	[
		'co',
		'Capital Outlay',
		0.04,
		[
			['major', 'Major Capital Outlay', 0.9],
			['minor', 'Minor Capital Outlay', 0.1]
		]
	]
];

for (const ag of AGENCIES) {
	const agNode: BudgetNode = {
		id: `exp/${ag.code}`,
		kind: 'agency',
		name: ag.name,
		shortName: ag.short,
		code: ag.code,
		amounts: zero(),
		sources: [src.sched9],
		children: []
	};
	for (const d of ag.depts) {
		const total = tri(d.by);
		const types = Object.keys(d.mix) as FundType[];
		const ftParts = split(
			total,
			types.map((t) => d.mix[t]!)
		);
		const byFundType = Object.fromEntries(types.map((t, i) => [t, ftParts[i]])) as Partial<
			Record<FundType, Triple>
		>;
		const positions = d.positions ? tri(d.positions, 0.03) : undefined;
		const base = `exp/${ag.code}/${d.org}`;

		// programs
		const progSpecs = d.programs ?? [
			[`${d.org}010`, d.name.replace(/^Department of /, '') + ' Program', 0.88],
			[`${d.org}019`, 'Administration', 0.12]
		];
		const progAmts = split(
			total,
			progSpecs.map((p) => p[2])
		);
		const programs: BudgetNode[] = progSpecs.map(([code, name, , subs], i) => {
			const amt = progAmts[i];
			const id = `${base}/${code}`;
			const node: BudgetNode = {
				id,
				kind: 'program',
				code,
				name,
				amounts: amt,
				byFundType: Object.fromEntries(
					types.map((t) => [t, scale(amt, d.mix[t]! / types.reduce((a, x) => a + d.mix[x]!, 0))])
				),
				positions: positions ? scale(positions, progSpecs[i][2]) : undefined,
				sources: [src.dept(d.org)]
			};
			if (subs?.length) {
				const w = subs.map((_, j) => (j === 0 ? 3 : 1) + rnd());
				const subAmts = split(amt, w);
				node.children = subs.map((sname, j) => ({
					id: `${id}/${code}${String(j + 1).padStart(3, '0')}`,
					kind: 'subprogram',
					code: `${code}${String(j + 1).padStart(3, '0')}`,
					name: sname,
					amounts: subAmts[j],
					byFundType: Object.fromEntries(types.map((t) => [t, scale(subAmts[j], d.mix[t]!)])),
					sources: [src.dept(d.org)]
				}));
			}
			return node;
		});
		const programsRoot = rollup({
			id: `${base}`,
			kind: 'department',
			code: d.org,
			name: d.name,
			amounts: total,
			children: programs
		});

		// funding: fundType -> fund -> item
		const fundingChildren: BudgetNode[] = types.map((t, i) => {
			const funds = FUND_BY_TYPE[t].filter((_, j) =>
				t === 'special' ? j < 2 + Math.floor(rnd() * 2) : true
			);
			const fAmts = split(
				ftParts[i],
				funds.map((_, j) => (j === 0 ? 3 : 1))
			);
			return {
				id: `dept/${d.org}/funding/${t}`,
				kind: 'fundType',
				name: fundTypeName(t),
				amounts: ftParts[i],
				byFundType: { [t]: ftParts[i] },
				children: funds.map((fc, j) => {
					const items = ['001', '101'].map((it) => `${d.org}-${it}-${fc}`);
					const itAmts = split(fAmts[j], [0.3, 0.7]);
					return {
						id: `dept/${d.org}/funding/${t}/${fc}`,
						kind: 'fund',
						code: fc,
						name: FUNDS[fc].name,
						amounts: fAmts[j],
						byFundType: { [t]: fAmts[j] },
						children: items.map((it, k) => ({
							id: `dept/${d.org}/funding/${t}/${fc}/${it}`,
							kind: 'item',
							code: it,
							name: `Item ${it} — ${k === 0 ? 'Support' : 'Local Assistance'}`,
							amounts: itAmts[k],
							byFundType: { [t]: itAmts[k] }
						}))
					} satisfies BudgetNode;
				})
			} satisfies BudgetNode;
		});
		const funding = rollup({
			id: `dept/${d.org}/funding`,
			kind: 'root',
			name: 'Funding',
			amounts: total,
			children: fundingChildren
		});

		// categories
		const catAmts = split(
			total,
			CATEGORIES.map((c) => c[2])
		);
		const categories = rollup({
			id: `dept/${d.org}/categories`,
			kind: 'root',
			name: 'Expenditures by Category',
			amounts: total,
			children: CATEGORIES.map(([ck, cname, , objs], i) => {
				const oAmts = split(
					catAmts[i],
					objs.map((o) => o[2])
				);
				return {
					id: `dept/${d.org}/categories/${ck}`,
					kind: 'category',
					name: cname,
					amounts: catAmts[i],
					byFundType: Object.fromEntries(types.map((t) => [t, scale(catAmts[i], d.mix[t]!)])),
					children: objs.map(([ok, oname], j) => ({
						id: `dept/${d.org}/categories/${ck}/${ok}`,
						kind: 'object',
						name: oname,
						amounts: oAmts[j],
						byFundType: Object.fromEntries(types.map((t) => [t, scale(oAmts[j], d.mix[t]!)]))
					}))
				} satisfies BudgetNode;
			})
		});

		// projects (capital outlay) for a few
		let projects: BudgetNode | undefined;
		if (['2660', '5225', '3790', '3540', '0250'].includes(d.org)) {
			const names = {
				'2660': [
					'I-405 Express Lanes',
					'SR-99 Rehabilitation, Merced County',
					'Bay Bridge Seismic Retrofit Follow-up'
				],
				'5225': [
					'Statewide: Health Care Facility Improvement',
					'San Quentin Rehabilitation Center'
				],
				'3790': ['Topanga State Park: Trail Renovation', 'Old Town San Diego: Visitor Center'],
				'3540': ['Butte Unit Headquarters Replacement', 'Ventura Air Attack Base'],
				'0250': ['Sacramento: New Courthouse', 'Riverside: Mid-County Civil Courthouse']
			}[d.org]!;
			const pAmts = split(
				scale(catAmts[3], 0.9),
				names.map(() => 1 + rnd())
			);
			projects = rollup({
				id: `dept/${d.org}/projects`,
				kind: 'root',
				name: 'Capital Outlay Projects',
				amounts: zero(),
				children: names.map((n, j) => ({
					id: `dept/${d.org}/projects/${slug(n)}`,
					kind: 'project',
					code: `${d.org}-${String(j + 1).padStart(3, '0')}`,
					name: n,
					amounts: pAmts[j],
					description: 'Phase: Construction (fixture)'
				}))
			});
		}

		const deptNode: BudgetNode = {
			id: base,
			kind: 'department',
			code: d.org,
			name: d.name,
			shortName: d.short,
			amounts: total,
			positions,
			byFundType,
			description: d.desc,
			detailRef: d.org,
			sources: [src.dept(d.org)]
		};
		agNode.children!.push(deptNode);

		details.push({
			orgCode: d.org,
			name: d.name,
			agencyCode: ag.code,
			agencyName: ag.name,
			description: d.desc ?? `The ${d.name} (fixture description).`,
			website: 'https://www.ca.gov/',
			totals: { amounts: total, positions },
			programs: programsRoot,
			funding,
			categories,
			projects,
			tables: [
				{
					title: 'Budget Change Proposals (fixture)',
					columns: ['Proposal', 'Fund', `${'2026-27'}`, 'Positions'],
					rows: [
						['Workload Adjustment', 'General Fund', round((total.by ?? 0) * 0.004), 12],
						['Information Technology Modernization', 'Various', round((total.by ?? 0) * 0.002), 4],
						['Baseline Reduction', 'General Fund', -round((total.by ?? 0) * 0.003), -6]
					],
					source: src.dept(d.org)
				}
			],
			sources: [src.dept(d.org), src.summary]
		});
	}
	expRoot.children!.push(agNode);
}
rollup(expRoot);
// departments keep their own byFundType; rollup already summed from children for agencies.

function fundTypeName(t: FundType): string {
	return {
		general: 'General Fund',
		special: 'Special Funds',
		bond: 'Bond Funds',
		federal: 'Federal Funds',
		reimbursement: 'Reimbursements',
		nongovernmental: 'Nongovernmental Cost Funds',
		other: 'Other Funds'
	}[t];
}

// ---------- revenues ----------
type RevSpec = [string, string, [string, string, number][]][];
const REV: { key: string; type: FundType; name: string; cats: RevSpec }[] = [
	{
		key: 'gf',
		type: 'general',
		name: 'General Fund',
		cats: [
			[
				'major',
				'Major Taxes',
				[
					['pit', 'Personal Income Tax', 133_900_000],
					['sales', 'Sales and Use Tax', 35_100_000],
					['corp', 'Corporation Tax', 41_800_000]
				]
			],
			[
				'minor',
				'Other Revenues',
				[
					['insurance', 'Insurance Tax', 3_950_000],
					['alcohol', 'Alcoholic Beverage Taxes and Fees', 410_000],
					['tobacco', 'Cigarette Tax', 48_000],
					['mcf', 'Motor Vehicle Fees', 31_000],
					['interest', 'Pooled Money Investment Interest', 1_900_000],
					['misc', 'Other Revenues', 1_250_000]
				]
			],
			['transfers', 'Transfers', [['transfers', 'Transfers and Loans', 2_100_000]]]
		]
	},
	{
		key: 'sf',
		type: 'special',
		name: 'Special Funds',
		cats: [
			[
				'motor',
				'Motor Vehicle Revenues',
				[
					['fuel', 'Motor Vehicle Fuel Taxes', 9_480_000],
					['vlf', 'Vehicle License Fees', 4_210_000],
					['reg', 'Registration and Other Fees', 5_020_000]
				]
			],
			[
				'taxes',
				'Special Fund Taxes',
				[
					['sales', 'Sales and Use Tax (Local Revenue Fund)', 18_200_000],
					['mco', 'Managed Care Organization Tax', 7_300_000],
					['tobacco', 'Cigarette and Tobacco Taxes', 1_600_000]
				]
			],
			[
				'other',
				'Other Special Fund Revenues',
				[
					['ggrf', 'Cap-and-Invest Auction Proceeds', 4_050_000],
					['other', 'Other Regulatory Fees and Revenues', 11_800_000]
				]
			]
		]
	},
	{
		key: 'fed',
		type: 'federal',
		name: 'Federal Funds',
		cats: [
			[
				'grants',
				'Federal Grants',
				[
					['medicaid', 'Medicaid (Title XIX)', 120_800_000],
					['education', 'Education Grants', 9_900_000],
					['tanf', 'TANF and Social Services Grants', 21_600_000],
					['transport', 'Federal Highway Administration', 7_550_000],
					['other', 'Other Federal Grants', 16_200_000]
				]
			]
		]
	},
	{
		key: 'bond',
		type: 'bond',
		name: 'Bond Funds',
		cats: [['proceeds', 'Bond Proceeds', [['go', 'General Obligation Bond Proceeds', 3_100_000]]]]
	}
];
const revRoot: BudgetNode = rollup({
	id: 'rev',
	kind: 'root',
	name: 'State Revenues',
	amounts: zero(),
	sources: [src.sched8],
	children: REV.map((ft) => ({
		id: `rev/${ft.key}`,
		kind: 'fundType',
		name: ft.name,
		amounts: zero(),
		sources: [src.sched8],
		children: ft.cats.map(([ck, cname, srcs]) => ({
			id: `rev/${ft.key}/${ck}`,
			kind: 'revenueCategory',
			name: cname,
			amounts: zero(),
			sources: [src.sched8],
			children: srcs.map(([sk, sname, by]) => {
				const a = tri(by, 0.1);
				return {
					id: `rev/${ft.key}/${ck}/${sk}`,
					kind: 'revenueSource',
					name: sname,
					amounts: a,
					byFundType: { [ft.type]: a },
					sources: [src.sched8]
				} satisfies BudgetNode;
			})
		}))
	}))
});

// ---------- flows ----------
const flowNodes: Flows['nodes'] = [];
const links: Flows['links'] = [];
for (const ft of revRoot.children!)
	for (const cat of ft.children!) {
		flowNodes.push({ id: cat.id, name: cat.name, column: 0, kind: 'revenueCategory' });
		links.push({ source: cat.id, target: `ft/${ft.id.split('/')[1]}`, value: cat.amounts.by ?? 0 });
	}
const ftKeys: [string, FundType, string][] = [
	['gf', 'general', 'General Fund'],
	['sf', 'special', 'Special Funds'],
	['fed', 'federal', 'Federal Funds'],
	['bond', 'bond', 'Bond Funds']
];
for (const [k, , n] of ftKeys)
	flowNodes.push({ id: `ft/${k}`, name: n, column: 1, kind: 'fundType' });
for (const ag of expRoot.children!) {
	flowNodes.push({ id: ag.id, name: ag.shortName ?? ag.name, column: 2, kind: 'agency' });
	for (const [k, t] of ftKeys) {
		const v = ag.byFundType?.[t]?.by ?? 0;
		if (v > 0) links.push({ source: `ft/${k}`, target: ag.id, value: v });
	}
}
const flows: Flows = { year: 'by', nodes: flowNodes, links, sources: [src.sched8, src.sched9] };

// ---------- funds.json ----------
const gfRev = revRoot.children![0].amounts;
const gfExp = expRoot.byFundType!.general!;
FUNDS['0001'].condition = {
	beginningBalance: { py: 38_100_000, cy: 31_400_000, by: 24_800_000 },
	revenues: gfRev,
	expenditures: gfExp,
	endingBalance: {
		py: 38_100_000 + (gfRev.py ?? 0) - (gfExp.py ?? 0),
		cy: 31_400_000 + (gfRev.cy ?? 0) - (gfExp.cy ?? 0),
		by: 24_800_000 + (gfRev.by ?? 0) - (gfExp.by ?? 0)
	}
};
for (const f of Object.values(FUNDS)) f.sources = [src.summary];

// ---------- search ----------
const search: SearchEntry[] = [];
function index(node: BudgetNode, path: string[], tree: SearchEntry['tree'], detailRef?: string) {
	if (node.kind !== 'root')
		search.push({
			id: node.id,
			name: node.name,
			kind: node.kind,
			code: node.code,
			path,
			by: node.amounts.by,
			detailRef: node.detailRef ?? detailRef,
			tree
		});
	for (const c of node.children ?? [])
		index(
			c,
			node.kind === 'root' && tree !== 'department' ? path : [...path, node.name],
			tree,
			detailRef
		);
}
index(expRoot, [], 'expenditures');
index(revRoot, [], 'revenues');
for (const d of details) {
	for (const t of [d.programs, d.funding, d.categories, d.projects]) {
		if (!t) continue;
		for (const c of t.children ?? [])
			index(
				c,
				[d.agencyName, d.name, ...(t === d.programs ? [] : [t.name])],
				'department',
				d.orgCode
			);
	}
}

// ---------- meta ----------
const allProg = details.reduce((a, d) => a + (d.programs.children?.length ?? 0), 0);
const meta: DatasetMeta = {
	fiscalYear: 'fixture',
	pit: 'e',
	publication: 'Enacted (fixture)',
	publicationDate: 'Sample data — not an official publication',
	years: { py: '2024-25', cy: '2025-26', by: '2026-27' },
	units: 'thousands',
	totals: {
		expenditures: expRoot.amounts,
		revenues: revRoot.amounts,
		expendituresByFundType: expRoot.byFundType!,
		revenuesByFundType: revRoot.byFundType!
	},
	counts: {
		agencies: expRoot.children!.length,
		departments: details.length,
		programs: allProg,
		funds: Object.keys(FUNDS).length,
		lineItems: search.length
	},
	sources: [src.summary, src.sched8, src.sched9],
	generatedAt: new Date().toISOString(),
	notes: [
		'FIXTURE DATA: amounts are invented for UI development and are not official figures.',
		'Federal funds are included in all-funds totals.'
	]
};

// ---------- write ----------
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'departments'), { recursive: true });
const w = (p: string, v: unknown) => writeFileSync(join(OUT, p), JSON.stringify(v));
w('meta.json', meta);
w('expenditures.json', expRoot);
w('revenues.json', revRoot);
w('funds.json', FUNDS);
w('flows.json', flows);
w('search.json', search);
for (const d of details) w(`departments/${d.orgCode}.json`, d);

const manifestPath = join(ROOT, 'manifest.json');
if (!existsSync(manifestPath)) {
	const manifest: Manifest = {
		defaultYear: 'fixture',
		defaultPit: 'e',
		datasets: [
			{
				fiscalYear: 'fixture',
				pit: 'e',
				publication: 'Enacted (fixture sample data)',
				path: 'fixture/e'
			}
		]
	};
	writeFileSync(manifestPath, JSON.stringify(manifest, null, '\t'));
	console.log('wrote manifest.json');
}
console.log(`fixture: ${details.length} departments, ${search.length} search entries -> ${OUT}`);
