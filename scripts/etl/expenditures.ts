/**
 * EXPENDITURE ETL for the CA Budget Explorer.
 *
 *   node scripts/etl/expenditures.ts --fy 2026-27 --pit e
 *   node scripts/etl/expenditures.ts --fy 2026-27 --pit p --orgs 0250,4260   # partial smoke run
 *   node scripts/etl/expenditures.ts --fy 2025-26 --pit e                    # older year ("publication" API prefix)
 *
 * Options:
 *   --fy <yyyy-yy>     fiscal year (budget year)               [default 2026-27]
 *   --pit p|m|e        Governor's Budget | May Revision | Enacted [default e]
 *   --orgs a,b,c       only these department org codes (partial run; statewide totals then cover only these)
 *   --no-pdf           skip department PDFs (JSON-only: program level + fund level)
 *   --refresh          ignore the on-disk cache in data-raw/
 *   --out <dir>        output root                             [default static/data]
 *   --raw <dir>        raw cache root                          [default data-raw]
 *   --concurrency <n>  parallel requests (max 4)               [default 4]
 *
 * Sources (all official, ebudget.ca.gov — Department of Finance):
 *   api/{prefix}/{pit}/{fy}/appInfo                 publication labels & years
 *   .../statistics                                  agency list + agency totals (state funds, all funds, GF/SF/bond)
 *   .../statistics/{agencyCd}                       departments in an agency with totals (incl. non-displayed statewide items)
 *   .../statistics/revised[/{agencyCd}]             May Revision changes (pit m only)
 *   .../org/{orgCd}                                 org record (agency/subagency codes, titles, website)
 *   .../orgProgram/{orgCd}                          program-level expenditures + positions, infrastructure totals
 *   .../rwaCntl/support/{orgCd}, rwaCntl/capOutlay/{orgCd}  expenditures by fund (support / capital outlay) with fund class
 *   .../orgProject/{orgCd}                          capital outlay projects and phases
 *   .../orgStoryCntl/{orgCd}                        narratives: N1 dept description, N2 legal citations, N4 program descr., N5 infrastructure
 *   .../fcsCntl/fundIndex                           fund index (fund code -> name, administering dept)
 *   .../sankey                                      General Fund revenue/expenditure totals (millions) for meta
 *   {fy}/pdf/{pub/}GovernorsBudget/{agency}/{org}.pdf  department detail PDF: subprograms/elements by fund,
 *                                                   expenditures by category/object, appropriation items, fund condition statements
 *
 * Outputs (static/data/{fy}/{pit}/): meta.json, expenditures.json, funds.json, departments/{org}.json, search.json;
 * plus static/data/manifest.json (upserted).
 *
 * search.json is written deterministically: expenditure-tree entries (agencies, departments) sorted by id, then
 * department-tree entries (programs..., items, projects) sorted by id, then any pre-existing entries with
 * tree === 'revenues' preserved verbatim (so the revenue ETL can append its entries and this script can be re-run).
 * meta.json: revenue totals already present (written by the revenue ETL) are preserved.
 */
import { excludeNonSpending, excludedTotal, mergeExcluded, addTriple } from './lib/exp-exclude.ts';
import fs from 'node:fs';
import path from 'node:path';
import { EBudget, mapLimit } from './lib/ebudget.ts';
import {
	parseDeptPdf,
	zeroTri,
	type Tri,
	type ParsedDeptPdf,
	type PdfProgram,
	type PdfCatLine,
	type PdfFcs
} from './lib/exp-pdf.ts';
import type {
	BudgetNode,
	DatasetMeta,
	DepartmentDetail,
	Fund,
	FundType,
	Manifest,
	Pit,
	SearchEntry,
	SourceRef,
	Triple
} from '../../src/lib/data/schema.ts';

// ---------------------------------------------------------------------------------- args
const argv = process.argv.slice(2);
const arg = (name: string, def?: string) => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 ? argv[i + 1] : def;
};
const flag = (name: string) => argv.includes(`--${name}`);
const FY = arg('fy', '2026-27')!;
const PIT = arg('pit', 'e') as Pit;
const ONLY = arg('orgs')
	?.split(',')
	.map((s) => s.trim());
const USE_PDF = !flag('no-pdf') && PIT !== 'm';
const OUT_ROOT = arg('out', 'static/data')!;
const RAW_ROOT = arg('raw', 'data-raw')!;
const CONC = Number(arg('concurrency', '4'));
if (!/^\d{4}-\d{2}$/.test(FY) || !['p', 'm', 'e'].includes(PIT)) {
	console.error('usage: node scripts/etl/expenditures.ts --fy 2026-27 --pit e');
	process.exit(1);
}
const OUT = path.join(OUT_ROOT, FY, PIT);
const log = (...a: unknown[]) => console.log('[exp]', ...a);

// ---------------------------------------------------------------------------------- api shapes
interface StatRow {
	orgCd: string;
	webAgencyCd: string;
	legalTitl: string;
	stateBudgetYearDols: number | null;
	allBudgetYearDols: number | null;
	budgetYearPers: number | null;
	generalFundTotal: number | null;
	specialFundTotal: number | null;
	bondFundTotal: number | null;
	capOutlayTotal: number | null;
	sprIncludeCoFlg: string;
	displayOnWebFlg: string;
	stateGrandTotal?: number | null;
	// pit m (revised) fields
	revisedBudgetDollars?: number;
	revisedExpendituresByGeneralFund?: number;
	revisedExpendituresBySpecialFund?: number;
	revisedExpendituresByBondFund?: number;
	revisedTotalFunds?: number;
	revisedTotalStateFunds?: number;
	revisedGeneralStateFunds?: number;
	revisedSpecialStateFunds?: number;
	revisedBondStateFunds?: number;
	revisedBudgetPYs?: number;
	revisedTotalPositions?: number;
}
interface OrgRec {
	orgCd: string;
	orgAgencyCd: string;
	orgSubagencyCd: string;
	orgLvl: string;
	legalTitl: string;
	webTitl: string;
	orgShtTitl: string;
	webAgencyCd: string;
	agencyWebsite: string | null;
	agencyAcronym: string | null;
	displayOnWebFlg: string;
	sprIncludesCoFlg: string;
}
interface ProgLine {
	programCode: string | null;
	programTitl: string;
	lineType: string | null;
	indentNbr: number | null;
	pyDols: number | null;
	cyDols: number | null;
	byDols: number | null;
	pyPersYrs: number | null;
	cyPersYrs: number | null;
	byPersYrs: number | null;
	sprIncludeCoFlg?: string;
}
interface RwaRow {
	fundCd: string;
	fundLglTitl: string;
	fundClassCd: string;
	pyTotDols: number | null;
	cyTotDols: number | null;
	byTotDols: number | null;
}
interface ProjLine {
	programCode: string | null;
	programTitl: string;
	lineType: string;
	majorMinorFlg: string;
	pyDols: number | null;
	cyDols: number | null;
	byDols: number | null;
}
interface FundIndexRow {
	fundCd: string;
	fundLglTitl: string;
	orgCd: string;
	orgAgencyCd: string;
	webIndexName: string;
}

// ---------------------------------------------------------------------------------- helpers
const T = (
	py: number | null | undefined,
	cy: number | null | undefined,
	by: number | null | undefined
): Triple => ({
	py: py ?? null,
	cy: cy ?? null,
	by: by ?? null
});
const fromTri = (t: Tri): Triple => ({ py: t[0], cy: t[1], by: t[2] });
const sumT = (...ts: (Triple | undefined)[]): Triple => {
	const out: Triple = { py: null, cy: null, by: null };
	for (const t of ts) {
		if (!t) continue;
		for (const k of ['py', 'cy', 'by'] as const)
			if (t[k] !== null) out[k] = round((out[k] ?? 0) + t[k]!);
	}
	return out;
};
const subT = (a: Triple, b: Triple): Triple => ({
	py: a.py === null && b.py === null ? null : round((a.py ?? 0) - (b.py ?? 0)),
	cy: a.cy === null && b.cy === null ? null : round((a.cy ?? 0) - (b.cy ?? 0)),
	by: a.by === null && b.by === null ? null : round((a.by ?? 0) - (b.by ?? 0))
});
const round = (n: number) => Math.round(n * 10) / 10;
const isZeroT = (t: Triple, tol = 0) =>
	(['py', 'cy', 'by'] as const).every((k) => Math.abs(t[k] ?? 0) <= tol);
const eqT = (a: Triple, b: Triple, tol = 2) => isZeroT(subT(a, b), tol);
const fmtT = (t: Triple) => `${t.py}/${t.cy}/${t.by}`;
const slug = (s: string) =>
	s
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 48) || 'x';
const APPTYPE_ABBR: Record<string, string> = {
	'State Operations': 'so',
	'Local Assistance': 'la',
	'Capital Outlay': 'co',
	Unclassified: 'un'
};
const abbr = (t: string) => APPTYPE_ABBR[t] ?? slug(t);

const CLASS_TO_TYPE: Record<string, FundType> = {
	G: 'general',
	S: 'special',
	B: 'bond',
	F: 'federal',
	R: 'reimbursement',
	N: 'nongovernmental'
};
const FUND_TYPE_ORDER: FundType[] = [
	'general',
	'special',
	'bond',
	'federal',
	'reimbursement',
	'nongovernmental',
	'interimLoan',
	'other'
];
const FUND_TYPE_NAMES: Record<FundType, string> = {
	general: 'General Fund',
	special: 'Special Funds',
	bond: 'Bond Funds',
	federal: 'Federal Funds',
	reimbursement: 'Reimbursements',
	nongovernmental: 'Nongovernmental Cost Funds',
	interimLoan: 'Loan-Financed Interim Payments',
	other: 'Other Funds'
};

/**
 * Funds whose DOF class letter does not say how DOF's statewide summary counts them.
 * 0201 Medical Providers Interim Payment Fund (DHCS): rwaCntl class "F" (legal basis
 * "Non-Governmental/Trust and Agency Funds-Federal"), but its only revenue is loans from the
 * General Fund and the Federal Trust Fund (Gov. Code 16531.1); upon enactment of the Budget Act the
 * Controller moves its expenditures to the appropriate Budget Act item, and the loans are repaid by
 * debiting those items (DOF Manual of State Funds, fund 0201). DOF Schedule 9 therefore leaves it
 * out of every fund-type column. Counting it would double count General Fund / federal spending.
 */
const FUND_TYPE_OVERRIDE: Record<string, FundType> = { '0201': 'interimLoan' };
const fundClass = new Map<string, string>(); // fundCd -> class letter
const fundNames = new Map<string, string>();
function fundTypeOf(fundCd: string): FundType {
	if (FUND_TYPE_OVERRIDE[fundCd]) return FUND_TYPE_OVERRIDE[fundCd];
	const c = fundClass.get(fundCd);
	if (c && CLASS_TO_TYPE[c]) return CLASS_TO_TYPE[c];
	if (fundCd === '0001') return 'general';
	if (fundCd === '0995') return 'reimbursement';
	if (fundCd === '0890') return 'federal';
	return 'other';
}

function htmlToText(html: string | null | undefined): string | undefined {
	if (!html) return undefined;
	const t = html
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|li|h\d)>/gi, '\n\n')
		.replace(/<li[^>]*>/gi, '• ')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&rsquo;|&lsquo;/g, "'")
		.replace(/&ldquo;|&rdquo;/g, '"')
		.replace(/&mdash;/g, '—')
		.replace(/&ndash;/g, '–')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
		.replace(/[ \t\u00a0]+/g, ' ')
		.replace(/ *\n */g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return t || undefined;
}

/** Title-case an ALL CAPS PDF name; keeps short words lower and acronyms intact-ish. */
function titleCase(s: string): string {
	if (s !== s.toUpperCase()) return s;
	const small = new Set([
		'and',
		'or',
		'of',
		'the',
		'for',
		'to',
		'in',
		'on',
		'at',
		'by',
		'a',
		'an',
		'with'
	]);
	return s
		.toLowerCase()
		.split(/(\s+|-|\/)/)
		.map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
		.join('');
}

function writeJson(file: string, data: unknown, pretty = false) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(data, null, pretty ? '\t' : undefined) + '\n');
}

/** Recompute byFundType of a node from its fund-leaf descendants (kind === 'fund'). */
function fundTypeBreakdown(
	funds: { fundCd: string; amounts: Triple }[]
): Partial<Record<FundType, Triple>> {
	const out: Partial<Record<FundType, Triple>> = {};
	for (const f of funds) {
		const ft = fundTypeOf(f.fundCd);
		out[ft] = sumT(out[ft], f.amounts);
	}
	return orderFt(out);
}
function orderFt(o: Partial<Record<FundType, Triple>>): Partial<Record<FundType, Triple>> {
	const out: Partial<Record<FundType, Triple>> = {};
	for (const k of FUND_TYPE_ORDER) if (o[k]) out[k] = o[k];
	return out;
}
function addFt(
	a: Partial<Record<FundType, Triple>>,
	b: Partial<Record<FundType, Triple>> | undefined
) {
	if (!b) return a;
	for (const [k, v] of Object.entries(b) as [FundType, Triple][]) a[k] = sumT(a[k], v);
	return a;
}

// ---------------------------------------------------------------------------------- main
const eb = await new EBudget({
	fy: FY,
	pit: PIT,
	rawRoot: RAW_ROOT,
	concurrency: CONC,
	refresh: flag('refresh'),
	log
}).init();
const info = eb.appInfo;
log(`${FY} ${PIT} (${info.publication}, ${info.publicationDate}); api ${eb.apiBase}`);
const src = (label: string, p: string): SourceRef => ({
	label: `ebudget.ca.gov API: ${p}`,
	url: eb.apiUrl(p)
});
const validation: string[] = [];
const warn = (s: string) => {
	validation.push(s);
};

const agencies = await eb.api<StatRow[]>('statistics');
const revisedAgencies = PIT === 'm' ? await eb.api<StatRow[]>('statistics/revised', []) : [];
const deptStats = new Map<string, StatRow[]>();
await mapLimit(agencies, CONC, async (a) => {
	deptStats.set(a.orgCd, await eb.api<StatRow[]>(`statistics/${a.orgCd}`, []));
});
const revisedDept = new Map<string, StatRow>();
if (PIT === 'm') {
	await mapLimit(agencies, CONC, async (a) => {
		for (const r of await eb.api<StatRow[]>(`statistics/revised/${a.orgCd}`, []))
			revisedDept.set(r.orgCd, r);
	});
}
const fundIndex = await eb.api<FundIndexRow[]>('fcsCntl/fundIndex', []);
for (const f of fundIndex) fundNames.set(f.fundCd, f.fundLglTitl);
const sankey = await eb.api<{
	revenueTotal?: number;
	expenditureTotal?: number;
	transferTotal?: number;
} | null>('sankey', null);

interface DeptJob {
	agency: StatRow;
	stat: StatRow;
}
let jobs: DeptJob[] = [];
for (const a of agencies)
	for (const d of deptStats.get(a.orgCd) ?? []) jobs.push({ agency: a, stat: d });
if (ONLY) jobs = jobs.filter((j) => ONLY.includes(j.stat.orgCd));
log(`${agencies.length} agencies, ${jobs.length} departments/statewide items`);

// ---------------- fetch everything (JSON first for all departments, then PDFs)
interface DeptRaw {
	job: DeptJob;
	org: OrgRec | null;
	prog: { totals: ProgLine[]; lines: ProgLine[] } | null;
	rwaSupport: RwaRow[];
	rwaCo: RwaRow[];
	proj: { totals: ProjLine | null; lines: ProjLine[] } | null;
	story: Record<string, unknown> | null;
	pdf: ParsedDeptPdf | null;
	pdfUrl: string | null;
	pdfError?: string;
}
const raws: DeptRaw[] = await mapLimit(jobs, CONC, async (job) => {
	const c = job.stat.orgCd;
	const [org, prog, rwaSupport, rwaCo, proj, story] = await Promise.all([
		eb.api<OrgRec | null>(`org/${c}`, null),
		eb.api<DeptRaw['prog']>(`orgProgram/${c}`, null),
		eb.api<RwaRow[]>(`rwaCntl/support/${c}`, []),
		eb.api<RwaRow[]>(`rwaCntl/capOutlay/${c}`, []),
		eb.api<DeptRaw['proj']>(`orgProject/${c}`, null),
		eb.api<Record<string, unknown> | null>(`orgStoryCntl/${c}`, null)
	]);
	for (const r of [...(rwaSupport ?? []), ...(rwaCo ?? [])]) {
		if (r.fundClassCd) fundClass.set(r.fundCd, r.fundClassCd);
		if (r.fundLglTitl && !fundNames.has(r.fundCd)) fundNames.set(r.fundCd, r.fundLglTitl);
	}
	return {
		job,
		org,
		prog,
		rwaSupport: rwaSupport ?? [],
		rwaCo: rwaCo ?? [],
		proj,
		story,
		pdf: null,
		pdfUrl: null
	};
});
log('JSON fetched', eb.stats);

if (USE_PDF) {
	let done = 0;
	await mapLimit(raws, CONC, async (r) => {
		if (!r.org || r.job.stat.displayOnWebFlg !== 'Y') return;
		const url = eb.deptPdfUrl(r.org.orgAgencyCd, r.org.orgCd);
		try {
			const buf = await eb.pdf(url);
			if (buf) {
				r.pdfUrl = url;
				r.pdf = await parseDeptPdf(buf, r.org.orgCd);
				if (!r.pdf.programs && (r.prog?.lines?.length ?? 0) > 0)
					warn(
						`${r.org.orgCd}: PDF has no "Detailed Expenditures by Program" section (sections: ${r.pdf.sectionTitles.join('; ')})`
					);
				if (!r.pdf.appropriations && (r.rwaSupport.length || r.rwaCo.length))
					warn(`${r.org.orgCd}: PDF has no "Detail of Appropriations" section`);
			}
		} catch (e) {
			r.pdfError = (e as Error).message;
			warn(`${r.org.orgCd}: PDF failed: ${r.pdfError}`);
		}
		if (++done % 25 === 0) log(`pdf ${done}`, eb.stats);
	});
	log('PDFs done', eb.stats);
}

// fund classes from FCS letters (for funds not seen in rwa)
for (const r of raws)
	for (const f of r.pdf?.fcs?.funds ?? [])
		if (f.fundClass && !fundClass.has(f.fundCd)) fundClass.set(f.fundCd, f.fundClass);

// ---------------------------------------------------------------------------------- build departments
const counts = {
	programs: 0,
	subprograms: 0,
	items: 0,
	lineItems: 0,
	projects: 0,
	categoryLines: 0,
	pdfs: 0
};
const deptNodes = new Map<string, BudgetNode>(); // orgCd -> summary node
const search: SearchEntry[] = [];
const fcsByFund = new Map<string, { fcs: PdfFcs; url: string; org: string }>();
const fundsSeen = new Map<string, Set<string>>(); // fundCd -> orgs using it

if (!ONLY) fs.rmSync(path.join(OUT, 'departments'), { recursive: true, force: true });

for (const r of raws) {
	const { agency, stat } = r.job;
	const org = r.org;
	const c = stat.orgCd;
	const agCd = agency.orgCd;
	const deptId = `exp/${agCd}/${c}`;
	const name = org?.legalTitl ?? stat.legalTitl;
	const sources: SourceRef[] = [
		src('statistics', `statistics/${agCd}`),
		src('org', `org/${c}`),
		src('orgProgram', `orgProgram/${c}`),
		src('rwaCntl', `rwaCntl/support/${c}`),
		src('rwaCntl', `rwaCntl/capOutlay/${c}`)
	];
	if (r.proj?.lines?.length) sources.push(src('orgProject', `orgProject/${c}`));
	if (r.story) sources.push(src('orgStoryCntl', `orgStoryCntl/${c}`));
	if (r.pdfUrl) {
		sources.push({
			label: `ebudget.ca.gov ${info.publication} budget detail PDF: ${c}`,
			url: r.pdfUrl
		});
		counts.pdfs++;
	}
	const story = (r.story ?? {}) as Record<string, unknown>;
	const progDesc = (story.N4 ?? {}) as Record<string, string>;
	const sprCo = (r.prog?.totals?.[0]?.sprIncludeCoFlg ?? stat.sprIncludeCoFlg) === 'Y';

	// ---- fund-level amounts (authoritative all-funds totals)
	const fundRows = new Map<string, { fundCd: string; name: string; support: Triple; co: Triple }>();
	for (const [rows, key] of [
		[r.rwaSupport, 'support'],
		[r.rwaCo, 'co']
	] as const) {
		for (const x of rows) {
			const e = fundRows.get(x.fundCd) ?? {
				fundCd: x.fundCd,
				name: x.fundLglTitl,
				support: T(0, 0, 0),
				co: T(0, 0, 0)
			};
			e[key] = sumT(e[key], T(x.pyTotDols, x.cyTotDols, x.byTotDols));
			fundRows.set(x.fundCd, e);
			if (!fundsSeen.has(x.fundCd)) fundsSeen.set(x.fundCd, new Set());
			fundsSeen.get(x.fundCd)!.add(c);
		}
	}
	// The printed "Detail of Appropriations and Adjustments" (department PDF) is the official
	// department-level fund total. Where the rwaCntl API disagrees with it, use the printed figure
	// (e.g. 9889 PSSSA 2025-26: the API omits the $500M discretionary deposit offset that the PDF,
	// the fund condition statement and DOF Schedule 9 all show) and keep the API value for audit.
	const apiOverrides: Record<string, { api: Triple; pdf: Triple }> = {};
	if (r.pdf?.appropriations) {
		const pdfFund = new Map<string, { support: Triple; co: Triple; name: string }>();
		for (const pf of r.pdf.appropriations.funds) {
			const e = pdfFund.get(pf.fundCd) ?? {
				support: T(0, 0, 0),
				co: T(0, 0, 0),
				name: pf.fundName
			};
			const net = fromTri(pf.netTotal ?? pf.total ?? zeroTri());
			if (pf.appType === 'Capital Outlay') e.co = sumT(e.co, net);
			else e.support = sumT(e.support, net);
			pdfFund.set(pf.fundCd, e);
		}
		for (const [fundCd, p] of pdfFund) {
			const api = fundRows.get(fundCd);
			const apiTot = api ? sumT(api.support, api.co) : T(0, 0, 0);
			const pdfTot = sumT(p.support, p.co);
			if (eqT(apiTot, pdfTot, 3)) continue;
			// only when the PDF itemizes the same appropriation types the API reports
			if (api && !isZeroT(api.co) && isZeroT(p.co)) continue;
			if (api && !isZeroT(api.support) && isZeroT(p.support)) continue;
			apiOverrides[fundCd] = { api: apiTot, pdf: pdfTot };
			warn(
				`${c}: fund ${fundCd} API ${fmtT(apiTot)} replaced by printed Detail of Appropriations ${fmtT(pdfTot)}`
			);
			fundRows.set(fundCd, {
				fundCd,
				name: api?.name ?? p.name,
				support: p.support,
				co: p.co
			});
			if (!fundsSeen.has(fundCd)) fundsSeen.set(fundCd, new Set());
			fundsSeen.get(fundCd)!.add(c);
		}
	}
	const fundTotals = [...fundRows.values()].map((f) => ({ ...f, amounts: sumT(f.support, f.co) }));
	const rwaTotal = sumT(T(0, 0, 0), ...fundTotals.map((f) => f.amounts));
	const byFundType = fundTypeBreakdown(fundTotals);

	// ---- program-level totals from orgProgram
	const lines = (r.prog?.lines ?? []).filter((l) => l.programCode);
	const pt0 = r.prog?.totals?.[0];
	const linesSum = sumT(T(0, 0, 0), ...lines.map((l) => T(l.pyDols, l.cyDols, l.byDols)));
	const progTotal = pt0
		? T(pt0.pyDols ?? linesSum.py, pt0.cyDols ?? linesSum.cy, pt0.byDols ?? linesSum.by)
		: linesSum;
	const positions = pt0
		? T(
				pt0.pyPersYrs ?? sumT(...lines.map((l) => T(l.pyPersYrs, null, null))).py,
				pt0.cyPersYrs ?? sumT(...lines.map((l) => T(null, l.cyPersYrs, null))).cy,
				pt0.byPersYrs
			)
		: undefined;
	const projTotals = r.proj?.totals
		? T(r.proj.totals.pyDols, r.proj.totals.cyDols, r.proj.totals.byDols)
		: T(0, 0, 0);
	const infra = sprCo ? T(0, 0, 0) : projTotals;
	const progPlusInfra = sumT(progTotal, infra);

	// Department total: prefer fund-level (rwa) when present; fall back to programs+infra, then statistics.
	let amounts: Triple;
	if (fundTotals.length) amounts = rwaTotal;
	else if (lines.length) amounts = progPlusInfra;
	else amounts = T(null, null, stat.allBudgetYearDols);
	if (fundTotals.length && lines.length && !eqT(rwaTotal, progPlusInfra, 3))
		warn(`${c}: fund total ${fmtT(rwaTotal)} != programs+infrastructure ${fmtT(progPlusInfra)}`);
	if (
		stat.allBudgetYearDols !== null &&
		amounts.by !== null &&
		Math.abs(amounts.by - stat.allBudgetYearDols) > 3
	)
		warn(`${c}: BY total ${amounts.by} != statistics allBudgetYearDols ${stat.allBudgetYearDols}`);
	if (
		stat.generalFundTotal !== null &&
		Math.abs((byFundType.general?.by ?? 0) - stat.generalFundTotal) > 3
	)
		warn(
			`${c}: BY General Fund ${byFundType.general?.by ?? 0} != statistics generalFundTotal ${stat.generalFundTotal}`
		);

	// ---- May Revision: department-level revised amounts on top of January detail
	let mayExtra: Record<string, unknown> | undefined;
	const rev = revisedDept.get(c);
	if (PIT === 'm' && rev) {
		const dAll = rev.revisedBudgetDollars ?? 0;
		const dG = rev.revisedExpendituresByGeneralFund ?? 0;
		const dS = rev.revisedExpendituresBySpecialFund ?? 0;
		const dB = rev.revisedExpendituresByBondFund ?? 0;
		amounts = { ...amounts, by: round((amounts.by ?? 0) + dAll) };
		if (dG)
			byFundType.general = {
				...(byFundType.general ?? T(0, 0, 0)),
				by: round((byFundType.general?.by ?? 0) + dG)
			};
		if (dS)
			byFundType.special = {
				...(byFundType.special ?? T(0, 0, 0)),
				by: round((byFundType.special?.by ?? 0) + dS)
			};
		if (dB)
			byFundType.bond = {
				...(byFundType.bond ?? T(0, 0, 0)),
				by: round((byFundType.bond?.by ?? 0) + dB)
			};
		const resid = round(dAll - dG - dS - dB);
		if (resid)
			byFundType.other = {
				...(byFundType.other ?? T(0, 0, 0)),
				by: round((byFundType.other?.by ?? 0) + resid)
			};
		mayExtra = {
			mayRevisionChange: {
				allFunds: dAll,
				generalFund: dG,
				specialFunds: dS,
				bondFunds: dB,
				positions: rev.revisedBudgetPYs ?? null
			}
		};
		sources.push(src('statistics/revised', `statistics/revised/${agCd}`));
	}

	// ---------------- programs tree
	const pdfProgs = r.pdf?.programs;
	const jsonByCode = new Map(lines.map((l) => [l.programCode!, l]));
	const programChildren: BudgetNode[] = [];
	const progSearch: BudgetNode[] = [];

	const buildFromPdf = (p: PdfProgram, depth: number): BudgetNode => {
		const kinds = ['program', 'subprogram', 'element', 'component', 'component'] as const;
		const kind =
			(
				{
					PROGRAM: 'program',
					SUBPROGRAM: 'subprogram',
					ELEMENT: 'element',
					COMPONENT: 'component'
				} as Record<string, BudgetNode['kind']>
			)[p.level] ?? kinds[Math.min(depth, 4)];
		const id = `${deptId}/${p.code}`;
		// fund lines aggregated per fund across appropriation types
		const byFund = new Map<
			string,
			{ fundCd: string; name: string; amounts: Triple; byType: Record<string, Triple> }
		>();
		for (const f of p.funds) {
			const e = byFund.get(f.fundCd) ?? {
				fundCd: f.fundCd,
				name: f.fundName,
				amounts: T(0, 0, 0),
				byType: {}
			};
			e.amounts = sumT(e.amounts, fromTri(f.amt));
			e.byType[f.appType] = sumT(e.byType[f.appType], fromTri(f.amt));
			byFund.set(f.fundCd, e);
		}
		const funds = [...byFund.values()];
		const own = sumT(T(0, 0, 0), ...funds.map((f) => f.amounts));
		const byType: Record<string, Triple> = {};
		for (const f of funds)
			for (const [k, v] of Object.entries(f.byType)) byType[k] = sumT(byType[k], v);
		const js = jsonByCode.get(p.code);
		const node: BudgetNode = {
			id,
			kind,
			name: js?.programTitl ?? titleCase(p.name),
			code: p.code,
			amounts: own,
			byFundType: fundTypeBreakdown(funds)
		};
		if (js) node.positions = T(js.pyPersYrs, js.cyPersYrs, js.byPersYrs);
		const d = htmlToText(progDesc[p.code]);
		if (d) node.description = d;
		node.extra = { byAppropriationType: byType };
		if (kind === 'program') counts.programs++;
		else counts.subprograms++;
		progSearch.push(node);
		if (p.children.length) {
			node.children = p.children.map((ch) => buildFromPdf(ch, depth + 1));
			const kidSum = sumT(T(0, 0, 0), ...node.children.map((k) => k.amounts));
			const resid = subT(own, kidSum);
			if (!isZeroT(resid, 2)) {
				node.children.push({
					id: `${id}/unallocated`,
					kind: 'other',
					name: `${node.name} (not allocated to a subprogram)`,
					amounts: resid,
					extra: { residual: true }
				});
			}
		} else {
			node.children = funds.map((f) => {
				counts.lineItems++;
				return {
					id: `${id}/f${f.fundCd}`,
					kind: 'fund' as const,
					name: f.name,
					code: f.fundCd,
					amounts: f.amounts,
					byFundType: { [fundTypeOf(f.fundCd)]: f.amounts },
					extra: { fundType: fundTypeOf(f.fundCd), byAppropriationType: f.byType }
				};
			});
			if (!node.children.length) delete node.children;
		}
		return node;
	};

	if (pdfProgs?.programs.length) {
		const seen = new Set<string>();
		const pdfByCode = new Map<string, BudgetNode>();
		const index = (n: BudgetNode) => {
			if (n.code) pdfByCode.set(n.code, n);
			n.children?.forEach(index);
		};
		for (const p of pdfProgs.programs) {
			const n = buildFromPdf(p, 0);
			programChildren.push(n);
			index(n);
		}
		// The API lists the department's "display" program level, which can be subprograms
		// (e.g. DHCS 3960010...) — match API lines anywhere in the PDF tree.
		for (const l of lines) {
			const n = pdfByCode.get(l.programCode!);
			if (!n) continue;
			seen.add(l.programCode!);
			n.name = l.programTitl;
			n.positions = T(l.pyPersYrs, l.cyPersYrs, l.byPersYrs);
			n.extra = { ...n.extra, apiProgramLine: true };
			if (!eqT(n.amounts, T(l.pyDols, l.cyDols, l.byDols), 3))
				warn(
					`${c}: program ${n.code} PDF ${fmtT(n.amounts)} != API ${fmtT(T(l.pyDols, l.cyDols, l.byDols))}`
				);
		}
		for (const l of lines) {
			if (seen.has(l.programCode!)) continue;
			if (!isZeroT(T(l.pyDols, l.cyDols, l.byDols)))
				warn(`${c}: program ${l.programCode} in API but not in PDF`);
			counts.programs++;
			const n: BudgetNode = {
				id: `${deptId}/${l.programCode}`,
				kind: 'program',
				name: l.programTitl,
				code: l.programCode!,
				amounts: T(l.pyDols, l.cyDols, l.byDols),
				positions: T(l.pyPersYrs, l.cyPersYrs, l.byPersYrs)
			};
			programChildren.push(n);
			progSearch.push(n);
		}
		for (const w of pdfProgs.warnings) warn(`${c}: ${w}`);
	} else {
		for (const l of lines) {
			counts.programs++;
			const n: BudgetNode = {
				id: `${deptId}/${l.programCode}`,
				kind: 'program',
				name: l.programTitl,
				code: l.programCode!,
				amounts: T(l.pyDols, l.cyDols, l.byDols),
				positions: T(l.pyPersYrs, l.cyPersYrs, l.byPersYrs)
			};
			const d = htmlToText(progDesc[l.programCode!]);
			if (d) n.description = d;
			programChildren.push(n);
			progSearch.push(n);
		}
	}
	// infrastructure (capital outlay) when not already included in programs
	const coFunds = [...fundRows.values()].filter((f) => !isZeroT(f.co));
	let infraResidual: Triple | null = null;
	if (!sprCo && !isZeroT(infra)) {
		const coHeader = r.proj?.lines.find(
			(l) => l.majorMinorFlg === 'n' && /^\d{4}$/.test(l.programCode ?? '')
		);
		const code = coHeader?.programCode ?? undefined;
		const n: BudgetNode = {
			id: `${deptId}/${code ?? 'infrastructure'}`,
			kind: 'program',
			name: 'Infrastructure (Capital Outlay)',
			code,
			amounts: infra,
			byFundType: fundTypeBreakdown(coFunds.map((f) => ({ fundCd: f.fundCd, amounts: f.co }))),
			description: htmlToText(story.N5 as string),
			extra: { infrastructure: true },
			children: coFunds.map((f) => {
				counts.lineItems++;
				return {
					id: `${deptId}/${code ?? 'infrastructure'}/f${f.fundCd}`,
					kind: 'fund' as const,
					name: f.name,
					code: f.fundCd,
					amounts: f.co,
					byFundType: { [fundTypeOf(f.fundCd)]: f.co },
					extra: { fundType: fundTypeOf(f.fundCd), byAppropriationType: { 'Capital Outlay': f.co } }
				};
			})
		};
		const coSum = sumT(T(0, 0, 0), ...n.children!.map((k) => k.amounts));
		if (!eqT(coSum, infra, 2)) {
			warn(
				`${c}: infrastructure total (orgProject) ${fmtT(infra)} != capital outlay by fund (rwaCntl) ${fmtT(coSum)}`
			);
			// The projects list has spending the fund detail does not attribute to any fund: keep it
			// as fund type "other" so the node is not mistaken for a fully non-spending subtree and
			// the programs tree still adds up (amounts = sum of children = sum of byFundType).
			const resid = subT(infra, coSum);
			infraResidual = resid;
			n.children!.push({
				id: `${n.id}/unreconciled`,
				kind: 'other',
				name: 'Difference between project total and capital outlay by fund',
				amounts: resid,
				byFundType: { other: resid },
				extra: { residual: true, fundType: 'other' }
			});
			n.byFundType = orderFt(addFt({ ...n.byFundType }, { other: resid }));
		}
		counts.programs++;
		programChildren.push(n);
	}
	const programsTotal = sumT(T(0, 0, 0), ...programChildren.map((n) => n.amounts));
	if (programChildren.length && !eqT(programsTotal, amounts, 3) && PIT !== 'm')
		warn(`${c}: programs tree ${fmtT(programsTotal)} != department total ${fmtT(amounts)}`);
	const programsRoot: BudgetNode = {
		id: deptId,
		kind: 'department',
		name,
		code: c,
		amounts: programChildren.length ? programsTotal : amounts,
		positions,
		byFundType: infraResidual
			? orderFt(addFt({ ...byFundType }, { other: infraResidual }))
			: byFundType,
		children: programChildren,
		sources: [
			src('orgProgram', `orgProgram/${c}`),
			...(r.pdfUrl ? [{ label: 'Detailed Expenditures by Program (PDF)', url: r.pdfUrl }] : [])
		]
	};
	const legal = htmlToText(story.N2 as string);
	if (legal) programsRoot.extra = { legalCitations: legal };

	// ---------------- funding tree: fund type -> fund -> appropriation item / authority
	const appr = r.pdf?.appropriations;
	const fundNodes = new Map<string, BudgetNode>();
	for (const f of fundTotals) {
		const ft = fundTypeOf(f.fundCd);
		fundNodes.set(f.fundCd, {
			id: `${deptId}/fund/${f.fundCd}`,
			kind: 'fund',
			name: f.name,
			code: f.fundCd,
			amounts: f.amounts,
			byFundType: { [ft]: f.amounts },
			extra: {
				fundType: ft,
				fundClass: fundClass.get(f.fundCd) ?? null,
				support: f.support,
				capitalOutlay: f.co,
				...(apiOverrides[f.fundCd]
					? {
							apiAmounts: apiOverrides[f.fundCd].api,
							amountsSource:
								'Printed Detail of Appropriations and Adjustments (department PDF); the ebudget rwaCntl API reports apiAmounts.'
						}
					: {})
			}
		});
	}
	if (appr) {
		for (const w of appr.warnings) warn(`${c}: ${w}`);
		const pdfFundTotals = new Map<string, Triple>();
		const usedIds = new Set<string>();
		for (const pf of appr.funds) {
			let fn = fundNodes.get(pf.fundCd);
			if (!fn) {
				const ft = fundTypeOf(pf.fundCd);
				fn = {
					id: `${deptId}/fund/${pf.fundCd}`,
					kind: 'fund',
					name: pf.fundName,
					code: pf.fundCd,
					amounts: T(0, 0, 0),
					byFundType: {},
					extra: { fundType: ft, fundClass: fundClass.get(pf.fundCd) ?? null, notInApi: true }
				};
				fundNodes.set(pf.fundCd, fn);
			}
			const net = fromTri(pf.netTotal ?? pf.total ?? zeroTri());
			pdfFundTotals.set(pf.fundCd, sumT(pdfFundTotals.get(pf.fundCd) ?? T(0, 0, 0), net));
			fn.children ??= [];
			const nonAdd: { label: string; appropriationType: string; amounts: Triple }[] = [];
			for (const l of pf.lines) {
				if (l.kind === 'nonAdd') {
					nonAdd.push({ label: l.label, appropriationType: pf.appType, amounts: fromTri(l.amt) });
					continue;
				}
				let id = l.item
					? `${deptId}/fund/${pf.fundCd}/${l.item}`
					: `${deptId}/fund/${pf.fundCd}/${abbr(pf.appType)}-${slug(l.label)}`;
				for (let k = 2; usedIds.has(id); k++) id = id.replace(/~\d+$/, '') + `~${k}`;
				usedIds.add(id);
				const node: BudgetNode = {
					id,
					kind: l.kind === 'item' ? 'item' : 'other',
					name: l.label,
					amounts: fromTri(l.amt),
					extra: { lineType: l.kind, appropriationType: pf.appType }
				};
				if (l.item) {
					node.code = l.item;
					counts.items++;
				}
				if (l.adjustments.length) {
					node.extra!.enacted = fromTri(l.base!);
					node.extra!.adjustments = l.adjustments.map((a) => ({
						label: a.label,
						amounts: fromTri(a.amt)
					}));
				}
				counts.lineItems++;
				fn.children.push(node);
			}
			if (nonAdd.length)
				fn.extra = { ...fn.extra, nonAdd: [...((fn.extra?.nonAdd as unknown[]) ?? []), ...nonAdd] };
		}
		// reconcile PDF fund totals vs API fund totals; keep trees additive with a residual node
		for (const fn of fundNodes.values()) {
			const kids = fn.children ?? [];
			const kidSum = sumT(T(0, 0, 0), ...kids.map((k) => k.amounts));
			const pdfTot = pdfFundTotals.get(fn.code!);
			if (fn.extra?.notInApi) {
				fn.amounts = pdfTot ?? kidSum;
				fn.byFundType = { [fundTypeOf(fn.code!)]: fn.amounts };
				if (!isZeroT(fn.amounts, 1))
					warn(`${c}: fund ${fn.code} in PDF appropriations but not in API (${fmtT(fn.amounts)})`);
			} else if (pdfTot && !eqT(pdfTot, fn.amounts, 3)) {
				warn(`${c}: fund ${fn.code} PDF appropriations ${fmtT(pdfTot)} != API ${fmtT(fn.amounts)}`);
			}
			if (kids.length) {
				const resid = subT(fn.amounts, kidSum);
				if (!isZeroT(resid, 2))
					kids.push({
						id: `${fn.id}/unreconciled`,
						kind: 'other',
						name: 'Difference between fund total and listed appropriations',
						amounts: resid,
						extra: { residual: true }
					});
			} else delete fn.children;
		}
	}
	const ftGroups: BudgetNode[] = [];
	for (const ft of FUND_TYPE_ORDER) {
		const fns = [...fundNodes.values()]
			.filter((f) => fundTypeOf(f.code!) === ft)
			.sort((a, b) => a.code!.localeCompare(b.code!));
		if (!fns.length) continue;
		const amt = sumT(T(0, 0, 0), ...fns.map((f) => f.amounts));
		ftGroups.push({
			id: `${deptId}/funding/${ft}`,
			kind: 'fundType',
			name: FUND_TYPE_NAMES[ft],
			code: ft,
			amounts: amt,
			byFundType: { [ft]: amt },
			children: fns
		});
	}
	const funding: BudgetNode = {
		id: `${deptId}/funding`,
		kind: 'root',
		name: `${name}: Funding by fund and appropriation`,
		amounts: sumT(T(0, 0, 0), ...ftGroups.map((g) => g.amounts)),
		byFundType,
		children: ftGroups,
		sources: [
			src('rwaCntl', `rwaCntl/support/${c}`),
			src('rwaCntl', `rwaCntl/capOutlay/${c}`),
			...(r.pdfUrl
				? [{ label: `Detail of Appropriations and Adjustments (PDF)`, url: r.pdfUrl }]
				: [])
		]
	};

	// ---------------- categories tree
	let categories: BudgetNode | undefined;
	const cats = r.pdf?.categories;
	if (cats?.types.length) {
		for (const w of cats.warnings) warn(`${c}: ${w}`);
		const usedIds = new Set<string>();
		const mk = (l: PdfCatLine, parentId: string, depth: number): BudgetNode => {
			let id = `${parentId}/${slug(l.name)}`;
			for (let k = 2; usedIds.has(id); k++) id = id.replace(/~\d+$/, '') + `~${k}`;
			usedIds.add(id);
			counts.categoryLines++;
			const n: BudgetNode = {
				id,
				kind: depth === 0 ? 'category' : 'object',
				name: l.name === l.name.toUpperCase() ? titleCase(l.name) : l.name,
				amounts: fromTri(l.amt)
			};
			if (l.pos && l.pos.some((v) => v)) n.positions = fromTri(l.pos);
			if (l.children.length) n.children = l.children.map((k) => mk(k, id, depth + 1));
			if (l.isGroup && isZeroT(n.amounts) && n.children)
				n.amounts = sumT(T(0, 0, 0), ...n.children.map((k) => k.amounts));
			return n;
		};
		const typeNodes = cats.types.map((t) => {
			const id = `${deptId}/cat/${abbr(t.appType)}`;
			const kids = t.lines.map((l) => mk(l, id, 0));
			const n: BudgetNode = {
				id,
				kind: 'category',
				name: t.appType,
				amounts: t.total ? fromTri(t.total) : sumT(T(0, 0, 0), ...kids.map((k) => k.amounts)),
				children: kids
			};
			if (t.totalPositions) n.positions = fromTri(t.totalPositions);
			return n;
		});
		categories = {
			id: `${deptId}/cat`,
			kind: 'root',
			name: `${name}: Expenditures by category`,
			amounts: sumT(T(0, 0, 0), ...typeNodes.map((n) => n.amounts)),
			children: typeNodes,
			sources: [{ label: 'Expenditures by Category (PDF)', url: r.pdfUrl! }]
		};
		const supportTotal = subT(amounts, infra);
		if (!eqT(categories.amounts, supportTotal, 3) && PIT !== 'm')
			warn(
				`${c}: categories ${fmtT(categories.amounts)} != department support (non-infrastructure) total ${fmtT(supportTotal)}`
			);
	}

	// ---------------- capital outlay projects
	let projects: BudgetNode | undefined;
	if (r.proj?.lines?.length) {
		const root: BudgetNode = {
			id: `${deptId}/projects`,
			kind: 'root',
			name: `${name}: Capital outlay projects`,
			amounts: projTotals,
			children: [],
			description: htmlToText(story.N5 as string),
			sources: [src('orgProject', `orgProject/${c}`)]
		};
		let progNode: BudgetNode | null = null;
		let projNode: BudgetNode | null = null;
		const usedIds = new Set<string>();
		const uid = (id: string) => {
			for (let k = 2; usedIds.has(id); k++) id = id.replace(/~\d+$/, '') + `~${k}`;
			usedIds.add(id);
			return id;
		};
		for (const l of r.proj.lines) {
			const amt = T(l.pyDols, l.cyDols, l.byDols);
			const code = (l.programCode ?? '').trim();
			const title = (l.programTitl ?? '').trim();
			if (l.majorMinorFlg === 'n' && /^\d{4}$/.test(code)) {
				progNode = {
					id: uid(`${deptId}/projects/${code}`),
					kind: 'program',
					name: titleCase(title),
					code,
					amounts: T(0, 0, 0),
					children: []
				};
				root.children!.push(progNode);
				projNode = null;
			} else if (code) {
				projNode = {
					id: uid(`${deptId}/projects/${code}`),
					kind: 'project',
					name: title,
					code,
					amounts: amt,
					children: []
				};
				(progNode?.children ?? root.children!).push(projNode);
				counts.projects++;
			} else if (projNode) {
				projNode.children!.push({
					id: uid(`${projNode.id}/${slug(title)}`),
					kind: 'other',
					name: title,
					amounts: amt,
					extra: { phase: true }
				});
			}
		}
		const fix = (n: BudgetNode) => {
			n.children?.forEach(fix);
			if (n.children && !n.children.length) delete n.children;
			if (n.kind === 'program' && n.children)
				n.amounts = sumT(T(0, 0, 0), ...n.children.map((k) => k.amounts));
		};
		fix(root);
		const projSum = sumT(T(0, 0, 0), ...(root.children ?? []).map((k) => k.amounts));
		if (!eqT(projSum, root.amounts, 2)) {
			(root.children ??= []).push({
				id: `${root.id}/unitemized`,
				kind: 'other',
				name: 'Projects not itemized',
				amounts: subT(root.amounts, projSum),
				extra: { residual: true }
			});
		}
		projects = root;
	}

	// ---------------- fund condition statements (collected for funds.json)
	for (const f of r.pdf?.fcs?.funds ?? [])
		if (!fcsByFund.has(f.fundCd)) fcsByFund.set(f.fundCd, { fcs: f, url: r.pdfUrl!, org: c });

	// ---------------- detail file
	const agencyName = agency.legalTitl;
	const detail: DepartmentDetail = {
		orgCode: c,
		name,
		agencyCode: agCd,
		agencyName,
		description: htmlToText(story.N1 as string),
		website: org?.agencyWebsite
			? org.agencyWebsite.startsWith('http')
				? org.agencyWebsite
				: `https://${org.agencyWebsite}`
			: undefined,
		totals: { amounts, positions },
		programs: programsRoot,
		funding,
		categories,
		projects,
		sources
	};
	// Reimbursements & nongovernmental cost funds are not spending: move them out of all totals.
	excludeNonSpending(detail.programs);
	excludeNonSpending(detail.funding);
	if (detail.projects) excludeNonSpending(detail.projects);
	detail.totals = {
		...detail.totals,
		amounts: detail.funding.amounts,
		excluded: detail.funding.excluded
	};
	if (detail.categories)
		detail.categories.extra = {
			...detail.categories.extra,
			basis: 'gross',
			basisNote:
				'Category and object totals are published only on a gross basis (they include spending funded by reimbursements and nongovernmental cost funds).'
		};
	const hasDetail = lines.length > 0 || fundTotals.length > 0;
	if (hasDetail) writeJson(path.join(OUT, 'departments', `${c}.json`), detail);

	// ---------------- summary node
	const summary: BudgetNode = {
		id: deptId,
		kind: 'department',
		name,
		code: c,
		shortName: org?.orgShtTitl && org.orgShtTitl !== name ? org.orgShtTitl : undefined,
		amounts,
		positions,
		byFundType,
		detailRef: hasDetail ? c : undefined,
		sources: [src('statistics', `statistics/${agCd}`), src('rwaCntl', `rwaCntl/support/${c}`)],
		extra: {
			displayOnWeb: stat.displayOnWebFlg === 'Y',
			orgAgencyCd: org?.orgAgencyCd,
			orgSubagencyCd: org?.orgSubagencyCd,
			orgLvl: org?.orgLvl,
			statewideItem: stat.displayOnWebFlg !== 'Y' || undefined,
			capitalOutlayIncludedInPrograms: sprCo || undefined,
			infrastructure: isZeroT(infra) ? undefined : infra,
			officialTotals: {
				stateFunds: stat.stateBudgetYearDols,
				allFunds: stat.allBudgetYearDols,
				generalFund: stat.generalFundTotal,
				specialFunds: stat.specialFundTotal,
				bondFunds: stat.bondFundTotal,
				capitalOutlay: stat.capOutlayTotal
			},
			...mayExtra
		}
	};
	excludeNonSpending(summary);
	deptNodes.set(c, summary);

	// ---------------- search entries (department tree)
	const deptPath = [agencyName, name];
	const walkSearch = (n: BudgetNode, p: string[]) => {
		search.push({
			id: n.id,
			name: n.name,
			kind: n.kind,
			code: n.code,
			path: p,
			by: n.amounts.by,
			detailRef: c,
			tree: 'department'
		});
		for (const k of [...(n.children ?? []), ...(n.excludedChildren ?? [])])
			if (k.kind !== 'fund' && k.kind !== 'other') walkSearch(k, [...p, n.name]);
	};
	for (const n of programChildren) walkSearch(n, deptPath);
	for (const g of ftGroups)
		for (const fn of g.children ?? [])
			for (const it of fn.children ?? [])
				if (it.kind === 'item')
					search.push({
						id: it.id,
						name: `${it.code} ${it.name}`,
						kind: 'item',
						code: it.code,
						path: [...deptPath, 'Funding', fn.name],
						by: it.amounts.by,
						detailRef: c,
						tree: 'department'
					});
	const walkProj = (n: BudgetNode, p: string[]) => {
		for (const k of n.children ?? []) {
			if (k.kind === 'project')
				search.push({
					id: k.id,
					name: k.name,
					kind: 'project',
					code: k.code,
					path: p,
					by: k.amounts.by,
					detailRef: c,
					tree: 'department'
				});
			else if (k.kind === 'program') walkProj(k, [...p, k.name]);
		}
	};
	if (projects) walkProj(projects, [...deptPath, 'Capital outlay']);
	void progSearch;
}

// ---------------------------------------------------------------------------------- expenditures tree
const agencyNodes: BudgetNode[] = [];
for (const a of agencies) {
	const kids = (deptStats.get(a.orgCd) ?? [])
		.map((d) => deptNodes.get(d.orgCd))
		.filter((n): n is BudgetNode => !!n);
	if (!kids.length) continue;
	kids.sort((x, y) => (y.amounts.by ?? 0) - (x.amounts.by ?? 0) || x.code!.localeCompare(y.code!));
	const ft: Partial<Record<FundType, Triple>> = {};
	for (const k of kids) addFt(ft, k.byFundType);
	const node: BudgetNode = {
		id: `exp/${a.orgCd}`,
		kind: 'agency',
		name: a.legalTitl,
		code: a.orgCd,
		amounts: sumT(T(0, 0, 0), ...kids.map((k) => k.amounts)),
		positions: sumT(...kids.map((k) => k.positions)),
		byFundType: orderFt(ft),
		children: kids,
		sources: [src('statistics', 'statistics'), src('statistics', `statistics/${a.orgCd}`)],
		extra: {
			officialTotals: {
				stateFunds: a.stateBudgetYearDols,
				allFunds: a.allBudgetYearDols,
				generalFund: a.generalFundTotal,
				specialFunds: a.specialFundTotal,
				bondFunds: a.bondFundTotal,
				capitalOutlay: a.capOutlayTotal,
				positions: a.budgetYearPers
			}
		}
	};
	const rv = revisedAgencies.find((x) => x.orgCd === a.orgCd);
	if (rv)
		node.extra!.mayRevisionChange = {
			allFunds: rv.revisedTotalFunds,
			stateFunds: rv.revisedTotalStateFunds,
			generalFund: rv.revisedGeneralStateFunds,
			specialFunds: rv.revisedSpecialStateFunds,
			bondFunds: rv.revisedBondStateFunds
		};
	const agEx: NonNullable<BudgetNode['excluded']> = {};
	for (const k of kids) mergeExcluded(agEx, k.excluded);
	if (Object.keys(agEx).length) node.excluded = agEx;
	agencyNodes.push(node);
	if (!ONLY) {
		const off =
			PIT === 'm' && rv
				? (a.allBudgetYearDols ?? 0) + (rv.revisedTotalFunds ?? 0)
				: a.allBudgetYearDols;
		const gross = addTriple(node.amounts, excludedTotal(node)).by ?? 0;
		if (off !== null && Math.abs(gross - off) > 5)
			warn(`agency ${a.orgCd}: sum of departments ${node.amounts.by} != official all-funds ${off}`);
	}
}
agencyNodes.sort((x, y) => (y.amounts.by ?? 0) - (x.amounts.by ?? 0));
const rootFt: Partial<Record<FundType, Triple>> = {};
for (const a of agencyNodes) addFt(rootFt, a.byFundType);
const root: BudgetNode = {
	id: 'exp',
	kind: 'root',
	name: `${FY} ${info.publication === 'Enacted' ? 'Enacted Budget' : info.publicationTitle}: Expenditures`,
	amounts: sumT(T(0, 0, 0), ...agencyNodes.map((a) => a.amounts)),
	positions: sumT(...agencyNodes.map((a) => a.positions)),
	byFundType: orderFt(rootFt),
	children: agencyNodes,
	sources: [src('statistics', 'statistics')]
};
{
	const ex: NonNullable<BudgetNode['excluded']> = {};
	for (const a of agencyNodes) mergeExcluded(ex, a.excluded);
	if (Object.keys(ex).length) root.excluded = ex;
}
writeJson(path.join(OUT, 'expenditures.json'), root);

// ---------------------------------------------------------------------------------- funds.json
const funds: Record<string, Fund> = {};
const fundCodes = new Set<string>([...fundNames.keys(), ...fundsSeen.keys()]);
for (const code of [...fundCodes].sort()) {
	const fi = fundIndex.find((f) => f.fundCd === code);
	const fund: Fund = {
		code,
		name: fundNames.get(code) ?? code,
		type: fundTypeOf(code),
		sources: []
	};
	if (fi)
		fund.sources!.push({
			label: 'ebudget.ca.gov API: fcsCntl/fundIndex',
			url: eb.apiUrl('fcsCntl/fundIndex')
		});
	const fc = fcsByFund.get(code);
	if (fc) {
		const f = fc.fcs;
		const rt = f.totalRevenuesTransfers ? fromTri(f.totalRevenuesTransfers) : undefined;
		fund.condition = {
			beginningBalance: f.adjustedBeginningBalance
				? fromTri(f.adjustedBeginningBalance)
				: f.beginningBalance
					? fromTri(f.beginningBalance)
					: undefined,
			revenues: fromTri(f.revenues),
			transfers: rt ? subT(rt, fromTri(f.revenues)) : undefined,
			expenditures: f.expenditures ? fromTri(f.expenditures) : undefined,
			endingBalance: f.fundBalance ? fromTri(f.fundBalance) : undefined
		};
		fund.sources!.push({
			label: `Fund Condition Statement (${fc.org} budget detail PDF)`,
			url: fc.url,
			page: f.page
		});
		// fund condition statement identity check: begin + rev/transfers - exp = end
		if (f.adjustedBeginningBalance && rt && f.expenditures && f.fundBalance) {
			const calc = subT(sumT(fromTri(f.adjustedBeginningBalance), rt), fromTri(f.expenditures));
			if (!eqT(calc, fromTri(f.fundBalance), 3))
				warn(
					`fund ${code}: FCS (${fc.org} PDF p${f.page}) does not balance: begin+revenues/transfers-expenditures ${fmtT(calc)} vs printed fund balance ${fmtT(fromTri(f.fundBalance))}`
				);
		}
	}
	if (fundsSeen.has(code))
		fund.sources!.push({
			label: 'ebudget.ca.gov API: rwaCntl (fund class, by department)',
			url: eb.apiUrl(`rwaCntl/support/${[...fundsSeen.get(code)!][0]}`)
		});
	funds[code] = fund;
}
writeJson(path.join(OUT, 'funds.json'), funds);

// ---------------------------------------------------------------------------------- search.json
const expSearch: SearchEntry[] = [];
for (const a of agencyNodes) {
	expSearch.push({
		id: a.id,
		name: a.name,
		kind: 'agency',
		code: a.code,
		path: [],
		by: a.amounts.by,
		tree: 'expenditures'
	});
	for (const d of a.children ?? [])
		expSearch.push({
			id: d.id,
			name: d.name,
			kind: 'department',
			code: d.code,
			path: [a.name],
			by: d.amounts.by,
			detailRef: d.detailRef,
			tree: 'expenditures'
		});
}
const byId = (x: SearchEntry, y: SearchEntry) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
expSearch.sort(byId);
search.sort(byId);
const searchFile = path.join(OUT, 'search.json');
let preserved: SearchEntry[] = [];
if (fs.existsSync(searchFile)) {
	try {
		preserved = (JSON.parse(fs.readFileSync(searchFile, 'utf8')) as SearchEntry[]).filter(
			(e) => e.tree === 'revenues'
		);
	} catch {
		/* ignore */
	}
}
const strip = (e: SearchEntry) =>
	Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined)) as SearchEntry;
writeJson(searchFile, [...expSearch, ...search].map(strip).concat(preserved));

// ---------------------------------------------------------------------------------- statewide validation + meta
const official = {
	allFunds: agencies.reduce((s, a) => s + (a.allBudgetYearDols ?? 0), 0),
	stateFunds: agencies.reduce((s, a) => s + (a.stateBudgetYearDols ?? 0), 0),
	generalFund: agencies.reduce((s, a) => s + (a.generalFundTotal ?? 0), 0),
	specialFunds: agencies.reduce((s, a) => s + (a.specialFundTotal ?? 0), 0),
	bondFunds: agencies.reduce((s, a) => s + (a.bondFundTotal ?? 0), 0)
};
if (PIT === 'm') {
	official.allFunds += revisedAgencies.reduce((s, a) => s + (a.revisedTotalFunds ?? 0), 0);
	official.stateFunds += revisedAgencies.reduce((s, a) => s + (a.revisedTotalStateFunds ?? 0), 0);
	official.generalFund += revisedAgencies.reduce(
		(s, a) => s + (a.revisedGeneralStateFunds ?? 0),
		0
	);
	official.specialFunds += revisedAgencies.reduce(
		(s, a) => s + (a.revisedSpecialStateFunds ?? 0),
		0
	);
	official.bondFunds += revisedAgencies.reduce((s, a) => s + (a.revisedBondStateFunds ?? 0), 0);
}
const ours = {
	allFunds: addTriple(root.amounts, excludedTotal(root)).by ?? 0,
	generalFund: root.byFundType?.general?.by ?? 0,
	specialFunds: root.byFundType?.special?.by ?? 0,
	bondFunds: root.byFundType?.bond?.by ?? 0
};
const stateOurs = ours.generalFund + ours.specialFunds + ours.bondFunds;
const fmtB = (n: number) => `$${(n / 1e6).toFixed(3)}B`;
const notes: string[] = [];
notes.push(
	`Amounts are in thousands of dollars. Spending totals count General, special, bond and federal funds, including infrastructure/capital outlay, from ebudget "expenditures by fund" (rwaCntl). Reimbursements (payments between departments, already counted where the money originates) and nongovernmental cost funds (e.g. UC/CSU own funds, CalPERS/CalSTRS trust funds, local property tax revenues, disability insurance) are not spending: they are kept out of every total and reported separately (excluded). ebudget's "all funds" figure includes them.`
);
notes.push(
	`Fund 0201 Medical Providers Interim Payment Fund (Health Care Services) is also kept out of spending ("loan-financed interim payments"): ebudget classes it as a federal fund, but its money is loans from the General Fund and Federal Trust Fund (Gov. Code 16531.1) and its expenditures are moved to the regular Budget Act items once the budget is enacted (DOF Manual of State Funds, fund 0201), so DOF Schedule 9 does not count it in any fund type.`
);
const overridden = validation.filter((v) =>
	v.includes('replaced by printed Detail of Appropriations')
);
if (overridden.length)
	notes.push(
		`Where the ebudget expenditures-by-fund API (rwaCntl) disagrees with the department's printed "Detail of Appropriations and Adjustments", the printed figure is used: ${overridden.join('; ')}.`
	);
if (!ONLY) {
	notes.push(
		`Validation (budget year): sum of departments, all funds ${fmtB(ours.allFunds)} vs. official ebudget statistics ${fmtB(official.allFunds)} (diff ${round(ours.allFunds - official.allFunds)}K); ` +
			`state funds (GF+special+bond) ${fmtB(stateOurs)} vs. ${fmtB(official.stateFunds)} (diff ${round(stateOurs - official.stateFunds)}K); ` +
			`General Fund ${fmtB(ours.generalFund)} vs. ${fmtB(official.generalFund)}; special funds ${fmtB(ours.specialFunds)} vs. ${fmtB(official.specialFunds)}; bond funds ${fmtB(ours.bondFunds)} vs. ${fmtB(official.bondFunds)}.`
	);
} else
	notes.push(
		`PARTIAL RUN for org codes ${ONLY.join(', ')} only; statewide totals cover only these departments.`
	);
if (sankey?.expenditureTotal)
	notes.push(
		`ebudget's General Fund summary (sankey) reports General Fund expenditures of $${(sankey.expenditureTotal / 1000).toFixed(1)}B and revenues/transfers of $${((sankey.revenueTotal ?? 0) / 1000).toFixed(1)}B (rounded, millions).`
	);
notes.push(
	`"Statewide" items without a department page (e.g. general obligation bond debt service, Augmentation for Employee Compensation, Supplemental Pension Payments, Proposition 98 reconciliation) are included as departments flagged extra.statewideItem; some carry negative amounts.`
);
if (PIT === 'm')
	notes.push(
		`May Revision: ebudget publishes May Revision changes only at department level (statistics/revised). Budget-year department totals and General/special/bond fund splits include the May changes; program, fund and appropriation detail reflect the January Governor's Budget (no May Revision department PDFs). May changes not attributed to General/special/bond funds are shown under fund type "other".`
	);
if (!USE_PDF && PIT !== 'm')
	notes.push(`Run without department PDFs: program detail is limited to the program level.`);
const pdfMissing = raws
	.filter(
		(r) =>
			r.job.stat.displayOnWebFlg === 'Y' && USE_PDF && !r.pdf && (r.prog?.lines?.length ?? 0) > 0
	)
	.map((r) => r.job.stat.orgCd);
if (pdfMissing.length)
	notes.push(
		`No department detail PDF available for: ${pdfMissing.join(', ')} (program-level JSON used).`
	);
notes.push(
	`Subprogram/element, appropriation-item, category/object and fund-condition detail is parsed from the official department detail PDFs; where a printed fund total (Detail of Appropriations) differs from the API, the printed figure is used (see above); other PDF-vs-API differences keep the API figure for totals and show the difference as an explicit residual node. ${validation.length} reconciliation messages (see data-raw/${FY}/${PIT}/exp-validation.json).`
);

for (const v of validation.slice(0, 25)) notes.push(`Reconciliation: ${v}`);
if (validation.length > 25) notes.push(`Reconciliation: ... and ${validation.length - 25} more.`);

const metaFile = path.join(OUT, 'meta.json');
let prevMeta: Partial<DatasetMeta> | null = null;
if (fs.existsSync(metaFile)) {
	try {
		prevMeta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
	} catch {
		/* ignore */
	}
}
const nullT = T(null, null, null);
const sankeyRev = sankey?.revenueTotal ? T(null, null, sankey.revenueTotal * 1000) : undefined;
const prevRev = prevMeta?.totals?.revenues;
const prevRevFt = prevMeta?.totals?.revenuesByFundType;
const meta: DatasetMeta = {
	fiscalYear: FY,
	pit: PIT,
	publication: info.publication,
	publicationDate: info.publicationDate,
	years: { py: info.previousYear, cy: info.currentYear, by: info.budgetYear },
	units: 'thousands',
	totals: {
		expenditures: root.amounts,
		revenues:
			prevRev && (prevRev.py !== null || prevRev.cy !== null || prevRev.by !== null)
				? prevRev
				: nullT,
		expendituresByFundType: root.byFundType ?? {},
		excluded: root.excluded,
		revenuesByFundType:
			prevRevFt && Object.keys(prevRevFt).length
				? prevRevFt
				: sankeyRev
					? { general: sankeyRev }
					: {}
	},
	counts: {
		agencies: agencyNodes.length,
		departments: [...deptNodes.values()].length,
		programs: counts.programs + counts.subprograms,
		funds: Object.keys(funds).length,
		lineItems: counts.lineItems
	},
	sources: [
		{ label: 'ebudget.ca.gov API: appInfo', url: eb.apiUrl('appInfo') },
		{ label: 'ebudget.ca.gov API: statistics (agency totals)', url: eb.apiUrl('statistics') },
		...(PIT === 'm'
			? [{ label: 'ebudget.ca.gov API: statistics/revised', url: eb.apiUrl('statistics/revised') }]
			: []),
		{ label: 'ebudget.ca.gov API: fcsCntl/fundIndex', url: eb.apiUrl('fcsCntl/fundIndex') },
		{ label: 'ebudget.ca.gov API: sankey (General Fund summary)', url: eb.apiUrl('sankey') },
		{
			label: `ebudget.ca.gov ${info.publication} budget detail PDFs (GovernorsBudget/{agency}/{org}.pdf)`,
			url: `${eb.pdfRoot}GovernorsBudget/`
		},
		{
			label: 'ebudget.ca.gov',
			url: `https://ebudget.ca.gov/${eb.prefix}/${PIT}/${FY}/BudgetDetail`
		}
	],
	generatedAt: new Date().toISOString(),
	notes
};
// keep sources/notes contributed by the revenue ETL (patch-meta.ts) when its totals were preserved
if (meta.totals.revenues === prevRev && prevMeta?.sources) {
	const urls = new Set(meta.sources.map((s) => s.url));
	for (const s of prevMeta.sources) if (!urls.has(s.url)) meta.sources.push(s);
}
// keep notes contributed by other ETLs (prefixed "Revenue")
if (prevMeta?.notes)
	for (const n of prevMeta.notes)
		if (/^revenue/i.test(n) && !meta.notes.includes(n)) meta.notes.push(n);
writeJson(metaFile, meta, true);

// ---------------------------------------------------------------------------------- manifest
const manFile = path.join(OUT_ROOT, 'manifest.json');
let manifest: Manifest = { defaultYear: FY, defaultPit: PIT, datasets: [] };
if (fs.existsSync(manFile)) {
	try {
		manifest = JSON.parse(fs.readFileSync(manFile, 'utf8'));
	} catch {
		/* ignore */
	}
}
if (!ONLY) {
	manifest.datasets = manifest.datasets.filter((d) => !(d.fiscalYear === FY && d.pit === PIT));
	manifest.datasets.push({
		fiscalYear: FY,
		pit: PIT,
		publication:
			info.publication === 'Revised'
				? 'May Revision'
				: info.publication === 'Enacted'
					? 'Enacted Budget'
					: "Governor's Budget",
		path: `${FY}/${PIT}`
	});
}
const pitRank: Record<string, number> = { e: 3, m: 2, p: 1 };
const isYear = (s: string) => /^\d{4}-\d{2}$/.test(s);
// real fiscal years first (newest first), then non-year entries (e.g. UI fixtures) in their existing order
manifest.datasets.sort(
	(a, b) =>
		Number(isYear(b.fiscalYear)) - Number(isYear(a.fiscalYear)) ||
		(isYear(a.fiscalYear)
			? b.fiscalYear.localeCompare(a.fiscalYear) || pitRank[b.pit] - pitRank[a.pit]
			: 0)
);
const isPartial = (d: Manifest['datasets'][number]) =>
	!fs.existsSync(path.join(OUT_ROOT, d.path, 'expenditures.json'));
const best = manifest.datasets.find((d) => isYear(d.fiscalYear) && !isPartial(d));
if (best) {
	manifest.defaultYear = best.fiscalYear;
	manifest.defaultPit = best.pit;
}
writeJson(manFile, manifest, true);

// ---------------------------------------------------------------------------------- report
fs.mkdirSync(eb.rawDir, { recursive: true });
writeJson(
	path.join(eb.rawDir, 'exp-validation.json'),
	{
		generatedAt: meta.generatedAt,
		official,
		ours: { ...ours, stateFunds: stateOurs },
		messages: validation
	},
	true
);
log('counts', {
	...counts,
	agencies: agencyNodes.length,
	departments: deptNodes.size,
	funds: Object.keys(funds).length,
	searchEntries: expSearch.length + search.length
});
log('totals BY: ours', ours, 'state', stateOurs, 'official', official);
log(`${validation.length} validation messages -> ${path.join(eb.rawDir, 'exp-validation.json')}`);
log('network', eb.stats);
