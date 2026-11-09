/**
 * "Spending by type": a plain-language classification of every department program by what the
 * money pays for (K-12 schools, Medi-Cal, cash aid, pensions, debt payments...).
 *
 * The state budget has no official "type of payment" field — DOF classifies spending by
 * department, program, fund and character (state operations / local assistance / capital
 * outlay), and the object-of-expenditure codes put almost all local assistance under a single
 * "Grants and Subventions" line. So this file is an explicit, editable rule set over the
 * official program structure. Every program row lands in exactly one type (nothing is counted
 * twice, nothing is dropped), and the rule that placed it is kept in the output so any
 * assignment can be audited in the UI.
 *
 * Rules are tried in order; the first match wins. A rule matches on department code(s),
 * optionally a regex over the program path ("Program > Subprogram") and optionally the
 * character of the row. Agency fallbacks at the end catch anything not listed explicitly.
 */

export type Character = 'so' | 'la' | 'co' | 'unknown';

export interface SpendType {
	id: string;
	name: string;
	description?: string;
}
export interface SpendGroup extends SpendType {
	types: SpendType[];
}

export const GROUPS: SpendGroup[] = [
	{
		id: 'schools',
		name: 'K-12 schools',
		description:
			'State and federal money paid to school districts, charter schools and county offices of education, plus the cost of the Department of Education itself. Schools also receive local property taxes, which are not part of the state budget. State contributions to teacher pensions are under “Pensions and retiree health care”, and repayment of school construction bonds is under “Debt payments”.',
		types: [
			{
				id: 'instruction',
				name: 'General school funding (Instruction)',
				description:
					'The Department of Education’s Instruction program: the bulk of the money paid to districts, charter schools and county offices of education.'
			},
			{ id: 'special-programs', name: 'Special programs (Department of Education)' },
			{ id: 'instructional-support', name: 'Instructional support (Department of Education)' },
			{
				id: 'facilities',
				name: 'School construction and facility grants',
				description: 'School Facilities Aid Program and charter school facility grants.'
			},
			{ id: 'mandates', name: 'Reimbursing schools for state-mandated programs' },
			{ id: 'teachers', name: 'Teacher preparation and credentialing' },
			{
				id: 'prop98',
				name: 'Proposition 98 settle-up',
				description:
					'Statewide adjustment of the money owed to schools and community colleges under the Proposition 98 minimum funding guarantee; it can be negative.'
			},
			{ id: 'other', name: 'Other K-12 programs' },
			{ id: 'state', name: 'Department of Education operations' }
		]
	},
	{
		id: 'colleges',
		name: 'Colleges and universities',
		description:
			'State support for the community colleges, the University of California and the California State University, and financial aid paid to students. (Tuition and the universities’ other own funds are not state spending.)',
		types: [
			{ id: 'ccc', name: 'Community colleges' },
			{ id: 'uc', name: 'University of California' },
			{ id: 'csu', name: 'California State University' },
			{
				id: 'aid',
				name: 'Student financial aid (Cal Grants and more)',
				description: 'Grants paid to students by the California Student Aid Commission.'
			},
			{ id: 'other', name: 'Other higher education' }
		]
	},
	{
		id: 'health',
		name: 'Health care',
		description:
			'Medi-Cal and the state’s other health programs. Most of it is federal money: Medi-Cal is jointly funded by the state and the federal government.',
		types: [
			{
				id: 'medi-cal',
				name: 'Medi-Cal: payments to health plans, doctors and hospitals',
				description:
					'Medi-Cal benefits — what the state and federal government pay managed care plans, doctors, hospitals, nursing homes and other providers for the care of Medi-Cal enrollees.'
			},
			{
				id: 'medi-cal-county',
				name: 'Medi-Cal: county eligibility and administration',
				description:
					'Payments to counties (and others) for determining Medi-Cal eligibility and administering the program locally.'
			},
			{
				id: 'other-care',
				name: 'Behavioral health and other care services',
				description:
					'Health Care Services programs outside Medi-Cal benefits: behavioral health, children’s medical services, and primary, rural and Indian health.'
			},
			{ id: 'public-health', name: 'Public health' },
			{ id: 'state-hospitals', name: 'State mental hospitals' },
			{ id: 'covered-ca', name: 'Covered California subsidies' },
			{ id: 'grants', name: 'Health workforce, facility and other health grants' },
			{ id: 'state', name: 'State administration of health programs' }
		]
	},
	{
		id: 'care',
		name: 'Disability, senior and veterans care',
		description:
			'Services that help people with disabilities, older adults and veterans live and work in their communities.',
		types: [
			{
				id: 'ihss',
				name: 'In-Home Supportive Services (IHSS)',
				description:
					'Pays in-home caregivers for low-income older adults and people with disabilities.'
			},
			{
				id: 'dds',
				name: 'Developmental services (regional centers)',
				description:
					'Services for people with developmental disabilities, mostly purchased through regional centers.'
			},
			{ id: 'aging', name: 'Senior services (meals, caregiving)' },
			{ id: 'rehab', name: 'Vocational rehabilitation' },
			{ id: 'veterans', name: 'Veterans homes and services' },
			{ id: 'other', name: 'Other disability services' }
		]
	},
	{
		id: 'families',
		name: 'Cash aid and family support',
		description:
			'Payments to low-income individuals and families, unemployment benefits, and the county workers who administer these programs.',
		types: [
			{ id: 'calworks', name: 'CalWORKs (cash aid for families with children)' },
			{
				id: 'ssp',
				name: 'SSI/SSP (aid for low-income seniors and people with disabilities)',
				description: 'The state’s supplement (SSP) to federal Supplemental Security Income.'
			},
			{ id: 'other-aid', name: 'Other assistance payments (incl. foster care)' },
			{
				id: 'child-welfare',
				name: 'Child welfare, adult protective services and licensing',
				description:
					'The Department of Social Services’ Children and Adult Services and Licensing program.'
			},
			{
				id: 'county-admin',
				name: 'County administration of welfare programs',
				description:
					'Payments to counties for administering CalWORKs, CalFresh and related programs.'
			},
			{
				id: 'ui',
				name: 'Unemployment insurance benefits',
				description:
					'Unemployment and disability insurance benefits paid by the Employment Development Department (local assistance).'
			},
			{ id: 'child-support', name: 'Child support services' },
			{
				id: 'other',
				name: 'Other family support',
				description:
					'Energy and community services grants, victim compensation, child savings accounts and similar programs.'
			}
		]
	},
	{
		id: 'childcare',
		name: 'Child care and early childhood',
		types: [
			{ id: 'child-care', name: 'Child care' },
			{ id: 'first5', name: 'First 5 California (early childhood)' }
		]
	},
	{
		id: 'local',
		name: 'Counties and cities: realignment and general aid',
		description:
			'Revenue the state passes to counties under the 1991 and 2011 realignments (which shifted health, social services and public safety programs to counties), and other general aid to local governments.',
		types: [
			{
				id: 'realignment-1991',
				name: '1991 realignment (county health, mental health and social services)'
			},
			{
				id: 'realignment-2011',
				name: '2011 realignment (county public safety, health and human services)'
			},
			{ id: 'aid', name: 'Property tax relief, mandates and other local aid' }
		]
	},
	{
		id: 'prisons',
		name: 'Prisons and corrections',
		types: [
			{ id: 'operations', name: 'Prison security and operations' },
			{ id: 'health', name: 'Health care for people in prison' },
			{ id: 'rehabilitation', name: 'Rehabilitation and education programs' },
			{ id: 'parole', name: 'Parole' },
			{ id: 'local', name: 'Grants to local corrections' },
			{ id: 'admin', name: 'Corrections administration' }
		]
	},
	{
		id: 'justice',
		name: 'Courts and justice',
		types: [
			{ id: 'trial-courts', name: 'Trial courts' },
			{ id: 'courts-other', name: 'Appellate courts, Judicial Council and court facilities' },
			{ id: 'doj', name: 'Department of Justice' },
			{ id: 'other', name: 'Other justice programs' }
		]
	},
	{
		id: 'safety',
		name: 'Firefighting, police and emergencies',
		types: [
			{ id: 'fire', name: 'Wildfire protection (CAL FIRE)' },
			{ id: 'chp', name: 'California Highway Patrol' },
			{ id: 'emergency', name: 'Emergency services and disaster grants (Cal OES)' },
			{ id: 'military', name: 'National Guard (Military Department)' }
		]
	},
	{
		id: 'transport',
		name: 'Transportation',
		types: [
			{ id: 'highway-construction', name: 'Highway construction (Caltrans)' },
			{
				id: 'highway-maintenance',
				name: 'Highway maintenance, operations and planning (Caltrans)'
			},
			{
				id: 'local-roads',
				name: 'Local streets and roads',
				description:
					'Gas tax revenue shared with cities and counties, and Caltrans local assistance.'
			},
			{ id: 'transit', name: 'Public transit and intercity rail' },
			{ id: 'hsr', name: 'High-speed rail' },
			{ id: 'dmv', name: 'Department of Motor Vehicles' },
			{ id: 'other', name: 'Other transportation' }
		]
	},
	{
		id: 'resources',
		name: 'Environment, water and parks',
		types: [
			{ id: 'water', name: 'Water supply and water quality' },
			{
				id: 'recycling',
				name: 'Recycling and beverage container refunds',
				description:
					'Mostly CRV refunds and payments under the beverage container recycling program.'
			},
			{ id: 'air-climate', name: 'Air quality and climate' },
			{ id: 'parks-wildlife', name: 'Parks, wildlife and conservation' },
			{ id: 'energy', name: 'Energy' },
			{ id: 'other', name: 'Other environmental programs' }
		]
	},
	{
		id: 'housing',
		name: 'Housing and homelessness',
		types: [
			{ id: 'grants', name: 'Housing and homelessness grants and loans' },
			{ id: 'other', name: 'Housing finance and regulation' }
		]
	},
	{
		id: 'jobs',
		name: 'Jobs, business and consumer protection',
		types: [
			{ id: 'workforce', name: 'Workforce programs and employment services' },
			{ id: 'labor', name: 'Worker protection (Industrial Relations)' },
			{ id: 'utilities', name: 'Utility regulation and telecom assistance programs (PUC)' },
			{ id: 'agriculture', name: 'Agriculture' },
			{ id: 'consumer', name: 'Licensing and consumer protection' },
			{ id: 'business', name: 'Economic development' }
		]
	},
	{
		id: 'pensions',
		name: 'Pensions and retiree health care',
		description:
			'The state’s payments into retirement systems and for retirees’ health care. (Pension checks themselves are paid by CalPERS and CalSTRS from their own trust funds, which are not state spending.)',
		types: [
			{ id: 'calstrs', name: 'Teacher pensions (state contributions to CalSTRS)' },
			{ id: 'calpers', name: 'State worker pensions (CalPERS)' },
			{ id: 'retiree-health', name: 'Retiree health and dental care' },
			{ id: 'other', name: 'Judges’, legislators’ and other retirement costs' }
		]
	},
	{
		id: 'debt',
		name: 'Debt payments',
		description:
			'Principal and interest on voter-approved general obligation bonds, by what the bonds paid for, and other state debt.',
		types: [
			{ id: 'schools', name: 'School construction bonds (K-12)' },
			{ id: 'higher-ed', name: 'College and university bonds' },
			{ id: 'transportation', name: 'Transportation bonds' },
			{ id: 'resources', name: 'Water, parks and environment bonds' },
			{ id: 'housing', name: 'Housing bonds' },
			{ id: 'other', name: 'Other bonds and interest' }
		]
	},
	{
		id: 'government',
		name: 'Running state government',
		types: [
			{ id: 'legislature', name: 'Legislature' },
			{ id: 'tax', name: 'Tax collection' },
			{
				id: 'statewide',
				name: 'Statewide pay and budget adjustments',
				description:
					'Statewide items not yet allocated to departments: employee compensation increases, contingencies, rate adjustments and accounting offsets (some negative).'
			},
			{ id: 'other', name: 'Other state administration' }
		]
	}
];

export interface Rule {
	/** "group/type" */
	to: string;
	/** department org codes */
	dept?: string[];
	/** agency codes (fallbacks) */
	agency?: string[];
	/** regex over "Program > Subprogram" */
	prog?: RegExp;
	char?: Character;
}

const r = (to: string, dept: string | string[], prog?: RegExp, char?: Character): Rule => ({
	to,
	dept: Array.isArray(dept) ? dept : [dept],
	prog,
	char
});

export const RULES: Rule[] = [
	// ── K-12
	r('schools/state', '6100', undefined, 'so'),
	r('schools/instruction', '6100', /^Instruction$/),
	r('schools/special-programs', '6100', /^Special Programs/),
	r('schools/instructional-support', '6100', /^Instructional Support/),
	r('schools/mandates', '6100', /Mandated/),
	r('schools/state', '6100'),
	r('schools/facilities', ['6350', '0985']),
	r('schools/teachers', '6360'),
	r('schools/prop98', '9894'),
	r('government/other', ['6120']),
	// ── colleges
	r('colleges/ccc', '6870'),
	r('colleges/uc', '6440'),
	r('colleges/csu', '6610'),
	r('colleges/aid', '6980'),
	r('colleges/other', ['6600', '6445']),
	// ── health
	r('health/medi-cal', '4260', /Benefits/),
	r('health/medi-cal-county', '4260', /County and Other Local Assistance/),
	r('health/other-care', '4260', /Other Care Services|Children's Medical|Primary, Rural/),
	r('health/state', '4260'),
	r('health/public-health', ['4265', '4120']),
	r('health/state-hospitals', '4440'),
	r('health/covered-ca', '4800', /Subsidy/),
	r('health/grants', ['4140', '0977', '4560', '4800']),
	r('health/state', ['4150', '0530', '5209']),
	// ── care
	r('care/ihss', '5180', /Ihss/i),
	r('care/dds', '4300'),
	r('care/aging', '4170'),
	r('care/rehab', '5160'),
	r('care/veterans', '8955'),
	r('care/other', '5180', /Disability Evaluation/),
	// ── families
	r('childcare/child-care', '5180', /Child Care/),
	r('childcare/first5', '4250'),
	r('families/calworks', '5180', /CalWORKs/),
	r('families/ssp', '5180', /Ssi\/Ssp/i),
	r('families/other-aid', '5180', /Other Assistance Payments/),
	r('families/child-welfare', '5180', /Children and Adult Services/),
	r('families/county-admin', '5180', /County Administration/),
	r('families/other', '5180'),
	r('families/ui', '7100', /^Unemployment Insurance Program/, 'la'),
	r('families/child-support', '5175'),
	r('families/other', ['4700', '7870', '0954']),
	// ── local governments
	r('local/realignment-1991', '5195'),
	r('local/realignment-2011', ['5196', '5296', '5396', '5496', '5596', '5696', '5796', '9285']),
	r('transport/local-roads', '9350', /Fuel Tax/),
	r('local/aid', ['9100', '9210', '8885', '9350']),
	// ── prisons
	r('prisons/health', '5225', /Medical|Mental Health|Dental|Ancillary Health/),
	r('prisons/rehabilitation', '5225', /Rehabilitative Programs/),
	r('prisons/parole', '5225', /Parole/),
	r('prisons/admin', '5225', /Administration|Legal Services|Peace Officer Selection/),
	r('prisons/operations', '5225'),
	r('prisons/local', ['5227']),
	// ── justice
	r('justice/trial-courts', '0250', /Trial Court|Local Property Tax/),
	r('justice/courts-other', '0250'),
	r('justice/doj', '0820'),
	r('justice/other', ['8140', '0552', '8120', '0855', '0820']),
	// ── safety
	r('safety/fire', '3540'),
	r('safety/chp', '2720'),
	r('safety/emergency', '0690'),
	r('safety/military', '8940'),
	// ── transportation
	r('transport/highway-construction', '2660', /Capital Outlay|Program Development/),
	r('transport/local-roads', '2660', /Highway Transportation > Local Assistance/),
	r('transport/transit', '2660', /Mass Transportation/),
	r('transport/highway-maintenance', '2660'),
	r('transport/transit', ['2640']),
	r('transport/transit', '0521', /Transit/),
	r('transport/hsr', '2665'),
	r('transport/dmv', '2740'),
	// ── resources
	r('resources/water', ['3860', '3940', '3885', '3830', '3860']),
	r('resources/recycling', '3970'),
	r('resources/air-climate', '3900'),
	r('resources/parks-wildlife', [
		'3790',
		'3600',
		'3640',
		'3100',
		'3720',
		'3340',
		'3760',
		'3810',
		'3835',
		'3840',
		'3845',
		'3850',
		'3855',
		'3875'
	]),
	r('resources/energy', ['3360', '3355']),
	// ── housing
	r('housing/grants', ['2240']),
	r('housing/other', ['2245', '2250']),
	// ── jobs
	r('jobs/workforce', ['7100', '7120']),
	r('jobs/labor', ['7350', '7320']),
	r('jobs/utilities', '8660'),
	r('jobs/agriculture', ['8570']),
	r('jobs/business', ['0509']),
	// ── pensions
	r('pensions/calstrs', '6300'),
	r('pensions/calpers', ['7900', '9892']),
	r('pensions/retiree-health', ['9650', '6645']),
	r('pensions/other', ['0390', '0150', '6305', '6878']),
	// ── debt
	r('debt/schools', '6396'),
	r('debt/higher-ed', ['6874', '7996']),
	r('debt/transportation', '2830'),
	r('debt/resources', ['3882', '3996']),
	r('debt/housing', '2496'),
	r('debt/other', ['9600', '9620', '9625', '9610', '0996', '1996', '5206']),
	// ── government
	r('government/legislature', ['0110', '0120', '0130', '0160']),
	r('government/tax', ['7730', '7600', '0860', '0870']),
	r('government/statewide', [
		'9800',
		'9801',
		'9802',
		'9804',
		'9840',
		'9897',
		'9900',
		'9901',
		'9910',
		'9655',
		'9658',
		'9659',
		'9885',
		'9898',
		'9935',
		'9940',
		'9975'
	]),
	// ── agency fallbacks
	{ to: 'resources/other', agency: ['3000', '3890'] },
	{ to: 'housing/other', agency: ['2000'] },
	{ to: 'jobs/consumer', agency: ['1000'] },
	{ to: 'jobs/workforce', agency: ['7000'] },
	{ to: 'transport/other', agency: ['2500'] },
	{ to: 'prisons/local', agency: ['5210'] },
	{ to: 'health/state', agency: ['4000'] },
	{ to: 'colleges/other', agency: ['6013'] },
	{ to: 'schools/other', agency: ['6010'] },
	{ to: 'government/other', agency: ['0010', '8000', '7500'] }
];

export interface RowKey {
	dept: string;
	agency: string;
	path: string;
	char: Character;
}

/** Index of the first matching rule, or -1. */
export function classify(row: RowKey): number {
	return RULES.findIndex(
		(x) =>
			(!x.dept || x.dept.includes(row.dept)) &&
			(!x.agency || x.agency.includes(row.agency)) &&
			(!x.prog || x.prog.test(row.path)) &&
			(!x.char || x.char === row.char)
	);
}

/** Human description of a rule, for the audit trail shown in the UI. */
export function describeRule(i: number): string {
	const x = RULES[i];
	const parts: string[] = [];
	if (x.dept) parts.push(`department ${x.dept.join('/')}`);
	if (x.agency) parts.push(`any other department of agency ${x.agency.join('/')}`);
	if (x.prog) parts.push(`program matching ${x.prog.source}`);
	if (x.char)
		parts.push(
			{ so: 'state operations', la: 'local assistance', co: 'capital outlay', unknown: '' }[x.char]
		);
	return parts.join(', ');
}
