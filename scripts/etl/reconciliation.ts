/**
 * Reconciliation ETL: how revenues, spending, transfers and reserves fit together.
 *
 *   node scripts/etl/reconciliation.ts --fy 2026-27 --pit e [--refresh] [--out static/data]
 *
 * Official sources only (ebudget.ca.gov, which hosts DOF's Budget Summary):
 *   - Schedule 1  "General Budget Summary"           -> General Fund bridge + reserves
 *   - Schedule 8  "Comparative Statement of Revenues" -> revenues vs. transfers & loans
 *   - Schedule 9  "Comparative Statement of Expenditures" -> spending by fund type
 *   - Schedule 10 "Summary of Fund Condition Statements" -> special funds + reserve accounts
 *   - Budget Summary narrative chapters (Introduction PDFs of the Governor's Budget, May
 *     Revision and Enacted Budget; listed by the `budgetSummaryChapter` API) -> the budget
 *     problem and how it was solved, quoted verbatim
 *   - Budget Summary "Summary Charts" (images; a few figures are transcribed, flagged)
 *   - ebudget `statistics` API -> official "all funds" total
 *
 * Output: static/data/{fy}/{pit}/reconciliation.json (see src/lib/data/reconciliation.ts).
 * Raw downloads are cached under data-raw/{fy}/{pit}/rev/ (shared with the revenue ETL).
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { RevFetcher, EBUDGET } from './lib/rev-fetch.ts';
import { readRows, parseAmount, splitRow, type Row } from './lib/rev-pdf.ts';
import { departmentDifferences, type SourceHelpers } from './lib/recon-explained.ts';
import {
	parseSchedule8,
	parseSchedule9,
	parseSchedule10,
	type S10Fund,
	type Tri as PTri
} from './lib/rev-parse.ts';
import type { SourceRef } from '../../src/lib/data/schema.ts';
import type {
	Reconciliation,
	GfBridgeYear,
	ReserveAccount,
	ReconCheck,
	CheckExplanationItem,
	DiffItem,
	Quote,
	NarrativeFact,
	Solution,
	RevenueMeasure,
	PlanStage,
	Tri,
	YearKey
} from '../../src/lib/data/reconciliation.ts';

const { values: args } = parseArgs({
	options: {
		fy: { type: 'string', default: '2026-27' },
		pit: { type: 'string', default: 'e' },
		out: { type: 'string', default: 'static/data' },
		raw: { type: 'string', default: 'data-raw' },
		refresh: { type: 'boolean', default: false }
	}
});
const FY = args.fy!;
const PIT = args.pit! as 'p' | 'm' | 'e';
const YK: YearKey[] = ['py', 'cy', 'by'];

const warnings: string[] = [];
const warn = (m: string) => {
	warnings.push(m);
	console.warn('  ! ' + m);
};
const log = (m: string) => console.log(m);

// ───────────────────────────── Schedule 1 ─────────────────────────────

interface S1Year {
	gf: Record<string, number>;
	sf: Record<string, number>;
	bond: Record<string, number>;
	total: Record<string, number>;
}

const S1_LABELS: [RegExp, string][] = [
	[/^Prior year resources available/i, 'begin'],
	[/^Revenues and transfers/i, 'revenues'],
	[/^Expenditures/i, 'expenditures'],
	[/^Fund Balance/i, 'end'],
	[/^Reserve for Liquidation of Encumbrances/i, 'encumbrances'],
	[/^Reserves for Economic Uncertainties/i, 'reu'],
	[/^Special Fund for Economic Uncertainties/i, 'sfeu'],
	[/^Budget Stabilization Account/i, 'bsa'],
	[/^Safety Net Reserve/i, 'safetyNet'],
	[/^Public School System Stabilization Account/i, 'psssa']
];

/**
 * Parse Schedule 1. Columns are located from the header row ("General Fund", "Special
 * Funds", "… Expenditures", "Expenditure Totals"); each amount is assigned to the column
 * whose header centre is nearest.
 */
function parseSchedule1(rows: Row[]): Record<string, S1Year> {
	const hdr = rows.find(
		(r) =>
			r.toks.some((t) => /^General Fund$/i.test(t.s)) &&
			r.toks.some((t) => /Special Funds/i.test(t.s))
	);
	if (!hdr) throw new Error('schedule 1: header row not found');
	const cols = hdr.toks
		.filter((t) => /General Fund|Special Funds|Expenditures|Totals/i.test(t.s))
		.map((t) => ({ s: t.s, c: (t.x + t.r) / 2 }));
	const colKey = (s: string) =>
		/General Fund/i.test(s)
			? 'gf'
			: /Special/i.test(s)
				? 'sf'
				: /Totals/i.test(s)
					? 'total'
					: 'bond';
	const out: Record<string, S1Year> = {};
	let year: string | null = null;
	for (const r of rows) {
		const first = r.toks[0]?.s ?? '';
		if (/^\d{4}-\d{2}$/.test(first) && r.toks.length === 1) {
			year = first;
			out[year] = { gf: {}, sf: {}, bond: {}, total: {} };
			continue;
		}
		if (!year) continue;
		const label = r.toks
			.filter((t) => parseAmount(t.s) === undefined || t.x < 200)
			.map((t) => t.s)
			.join(' ');
		const hit = S1_LABELS.find(([re]) => re.test(label));
		if (!hit) continue;
		const key = hit[1];
		let prevDashCol: string | null = null;
		for (const t of r.toks) {
			if (t.x < cols[0].c - 60) continue; // label / reference / footnote area
			const v = parseAmount(t.s);
			if (v === undefined) continue;
			const c = (t.x + t.r) / 2;
			const col = cols.reduce((a, b) => (Math.abs(b.c - c) < Math.abs(a.c - c) ? b : a));
			const k = colKey(col.s);
			const isDash = /^[$\s-]+$/.test(t.s);
			if (isDash && prevDashCol === k) continue;
			prevDashCol = isDash ? k : null;
			out[year][k as keyof S1Year][key] = v;
		}
	}
	return out;
}

// ───────────────────────────── narrative text ─────────────────────────────

interface Para {
	page: number;
	text: string;
}

/** Turn an ebudget Budget Summary chapter PDF into paragraphs (per page). */
function toParagraphs(rows: Row[]): Para[] {
	const lines: { page: number; s: string; y: number }[] = [];
	for (const r of rows) {
		const s = r.toks
			.map((t) => t.s)
			.join(' ')
			.replace(/\s+/g, ' ')
			.trim();
		if (!s || /^Version number/i.test(s)) continue;
		if (/—\s*\d{4}-\d{2}(\s+\d+)?$/.test(s) && /BUDGET|REVISION/i.test(s.replace(/\s/g, '')))
			continue;
		lines.push({ page: r.page, s, y: r.y });
	}
	// drop caps: a lone capital letter is printed after the first line or two of its
	// paragraph; it belongs to the earliest nearby preceding line that starts lowercase
	for (let i = 0; i < lines.length; i++) {
		if (!/^[A-Z]$/.test(lines[i].s)) continue;
		let at = -1;
		for (let j = i - 1; j >= Math.max(0, i - 2); j--) if (/^[a-z]/.test(lines[j].s)) at = j;
		if (at >= 0) lines[at].s = lines[i].s + lines[at].s;
		lines[i].s = '';
	}
	const paras: Para[] = [];
	let cur: Para | null = null;
	let prevY = 0;
	for (const l of lines) {
		if (!l.s) continue;
		const collapsed = l.s.replace(/\b([A-Z]) (?=[A-Z’'])/g, '$1');
		const heading = collapsed === collapsed.toUpperCase() && /[A-Z]{3}/.test(collapsed);
		const bullet = /^[•◦]/.test(l.s);
		// body lines are ~16.5pt apart; paragraphs are separated by ~28pt
		const gap = cur && cur.page === l.page ? prevY - l.y > 22 : true;
		if (heading && l.y > 730) continue; // running page header (chapter title)
		if (heading) {
			cur = null;
			prevY = l.y;
			continue;
		}
		if (!cur || bullet || (gap && cur.page === l.page)) {
			cur = { page: l.page, text: l.s };
			paras.push(cur);
		} else cur.text += ' ' + l.s;
		prevY = l.y;
	}
	for (const p of paras)
		p.text = p.text
			.replace(/\s+([,.;:)”])/g, '$1')
			.replace(/([(“])\s+/g, '$1')
			.replace(/\s+/g, ' ')
			.trim();
	return paras;
}

/** The sentence (or bullet) of `p` that contains character index `at`. */
function sentenceAt(p: Para, at: number, endAt = at): string {
	const t = p.text;
	let s = 0;
	const re = /[.!?]["”’]?\s+(?=[A-Z•◦$])/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(t)) && m.index + m[0].length <= at) s = m.index + m[0].length;
	re.lastIndex = Math.max(endAt, s);
	const next = re.exec(t);
	const e = next ? next.index + 1 : t.length;
	return t
		.slice(s, e)
		.replace(/^[•◦]\s*/, '')
		.trim();
}

const toThousands = (n: string, unit: string) =>
	Math.round(Number(n.replace(/,/g, '')) * (/billion/i.test(unit) ? 1e6 : 1e3));

class Doc {
	paras: Para[] = [];
	id: string;
	label: string;
	url: string;
	constructor(id: string, label: string, url: string) {
		this.id = id;
		this.label = label;
		this.url = url;
	}
	src(page?: number): SourceRef {
		return { label: this.label, url: this.url, ...(page ? { page } : {}) };
	}
	find(re: RegExp): { para: Para; m: RegExpExecArray } | null {
		for (const para of this.paras) {
			const m = new RegExp(re.source, re.flags.replace('g', '')).exec(para.text);
			if (m) return { para, m };
		}
		return null;
	}
}

// ───────────────────────────── helpers ─────────────────────────────

const sum = (...xs: (number | null | undefined)[]) =>
	xs.every((x) => x == null) ? null : xs.reduce<number>((a, x) => a + (x ?? 0), 0);
const tri = (f: (y: YearKey) => number | null | undefined): Tri => ({
	py: f('py') ?? null,
	cy: f('cy') ?? null,
	by: f('by') ?? null
});
const fromP = (t: PTri | undefined): Tri => tri((y) => t?.[y]);
const readJSON = <T>(p: string): T | null => {
	try {
		return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
	} catch {
		return null;
	}
};

/**
 * Figures printed only as images in the Budget Summary "Summary Charts" chapter,
 * transcribed by hand (dollars in millions). Each is cross-checked against the parsed
 * schedules where both exist (see checks).
 */
const CHART_TRANSCRIPTIONS: Record<
	string,
	{
		e?: {
			page: number;
			gfSummary: Record<'cy' | 'by', Record<string, number>>;
			revenueSourcesPage: number;
			gfRevenueSubtotal: Record<'cy' | 'by', number>;
			bsaTransfer: Record<'cy' | 'by', number>;
		};
		m?: { page: number; by: Record<string, number> };
	}
> = {
	'2026-27': {
		e: {
			page: 2,
			gfSummary: {
				cy: {
					begin: 56707,
					revenues: 245817,
					nonProp98: 157557,
					prop98: 87746,
					expenditures: 245303,
					end: 57221,
					encumbrances: 27998,
					sfeu: 29223,
					psssa: 9195,
					safetyNet: 0,
					bsa: 11496
				},
				by: {
					begin: 57221,
					revenues: 226754,
					nonProp98: 158546,
					prop98: 92931,
					expenditures: 251477,
					end: 32498,
					encumbrances: 27998,
					sfeu: 4500,
					psssa: 9195,
					safetyNet: 0,
					bsa: 15070
				}
			},
			revenueSourcesPage: 4,
			gfRevenueSubtotal: { cy: 238717, by: 230328 },
			bsaTransfer: { cy: 7100, by: -3574 }
		},
		m: {
			page: 2,
			by: {
				begin: 56190,
				revenues: 222874,
				expenditures: 246566,
				end: 32498,
				encumbrances: 27998,
				sfeu: 4500,
				psssa: 10325,
				safetyNet: 0,
				bsa: 15075
			}
		}
	}
};

// ───────────────────────────── main ─────────────────────────────

async function main() {
	log(`reconciliation ETL ${FY}/${PIT}`);
	const f = await new RevFetcher(FY, PIT, { rawRoot: args.raw, refresh: args.refresh }).init();
	const ai = f.appInfo;
	const Y: Record<YearKey, string> = { py: ai.previousYear, cy: ai.currentYear, by: ai.budgetYear };
	const pub = ai.publication;

	const schedUrl = (n: number) => f.summaryPdfUrl(`BS_SCH${n}.pdf`);
	const SRC = {
		s1: { label: `DOF Summary Schedule 1 — General Budget Summary (${pub})`, url: schedUrl(1) },
		s8: {
			label: `DOF Summary Schedule 8 — Comparative Statement of Revenues (${pub})`,
			url: schedUrl(8)
		},
		s9: {
			label: `DOF Summary Schedule 9 — Comparative Statement of Expenditures (${pub})`,
			url: schedUrl(9)
		},
		s10: {
			label: `DOF Summary Schedule 10 — Summary of Fund Condition Statements (${pub})`,
			url: schedUrl(10)
		},
		charts: {
			label: `Budget Summary — Summary Charts (${pub})`,
			url: f.summaryPdfUrl('SummaryCharts.pdf')
		},
		stats: {
			label: 'ebudget.ca.gov API: statistics (agency totals, all funds)',
			url: f.apiUrl('statistics')
		}
	} satisfies Record<string, SourceRef>;

	const pdfRows = async (url: string) => {
		const buf = await f.pdf(url);
		if (!buf) throw new Error(`not published: ${url}`);
		return readRows(buf);
	};

	// ---- schedules
	const s1 = parseSchedule1(await pdfRows(schedUrl(1)));
	const s8 = parseSchedule8(await pdfRows(schedUrl(8)), warn);
	const s9 = parseSchedule9(await pdfRows(schedUrl(9)), warn);
	const s10 = parseSchedule10(await pdfRows(schedUrl(10)), warn);
	const s1y = (y: YearKey) => {
		const v = s1[Y[y]];
		if (!v) throw new Error(`schedule 1: no block for ${Y[y]}`);
		return v;
	};
	const fund = (code: string): S10Fund | undefined => s10.funds.find((x) => x.code === code);
	const gf10 = fund('0001');
	const bsa10 = fund('1011');
	const sn10 = fund('1019');
	const ps10 = fund('1029');
	const sha10 = fund('1032');
	const sfTot = s10.totals['special-funds'];
	const transfers = s8.categories.find((c) => c.slug === 'transfers');
	const tLine = (slug: string) => transfers?.sources.find((s) => s.code === slug);
	if (!bsa10) warn('schedule 10: Budget Stabilization Account (1011) not found');

	// ---- BSA fund condition statement (9658 Budget Stabilization Account): itemizes the
	// transfers that Schedule 10 shows only net (deposits, true-ups, suspensions, withdrawals).
	const bsaFcsSrc: SourceRef = {
		label: `9658 Budget Stabilization Account — Fund Condition Statement (${pub})`,
		url: f.fcsPdfUrl('8000', '9658'),
		page: 1
	};
	const bsaFcs = await (async () => {
		const buf = await f.pdf(bsaFcsSrc.url);
		if (!buf) return null;
		let withdrawals: PTri | null = null;
		let total: PTri | null = null;
		for (const r of await readRows(buf)) {
			const { label, vals } = splitRow(r, 380);
			if (vals.length !== 3) continue;
			const t = { py: vals[0], cy: vals[1], by: vals[2] };
			if (/Sec\. 22 \(a\)\(2\)\(A\)/.test(label))
				withdrawals = withdrawals
					? { py: withdrawals.py + t.py, cy: withdrawals.cy + t.cy, by: withdrawals.by + t.by }
					: t;
			else if (/^Total Revenues, Transfers, and Other Adjustments/.test(label) && !total) total = t;
		}
		if (!withdrawals || !total) {
			warn('9658 FCS: BSA withdrawal or total line not found');
			return null;
		}
		return { withdrawals, total };
	})();

	// ---- Summary Charts transcription (Prop 98 split)
	const chartE = PIT === 'e' ? CHART_TRANSCRIPTIONS[FY]?.e : undefined;
	const chartSrc = (page: number): SourceRef => ({ ...SRC.charts, page });

	// ---- General Fund bridge
	const gfYears = {} as Record<YearKey, GfBridgeYear>;
	for (const y of YK) {
		const g = s1y(y).gf;
		const total = transfers?.total?.gf[y] ?? null;
		const bsa = bsa10 ? -bsa10.revenues[y] : null;
		const surplusHolding = sha10 ? -sha10.revenues[y] : null;
		const safetyNet = sn10 ? -sn10.revenues[y] : null;
		const cs = y !== 'py' ? chartE?.gfSummary[y] : undefined;
		gfYears[y] = {
			beginningBalance: g.begin,
			revenues: s8.totalRevenues?.gf[y] ?? null,
			transfers: {
				total,
				bsa,
				surplusHolding,
				safetyNet,
				other: total == null ? null : total - (bsa ?? 0) - (surplusHolding ?? 0) - (safetyNet ?? 0),
				loans: tLine('loans')?.gf[y] ?? null,
				revenueTransfers: tLine('revenue-transfers')?.gf[y] ?? null
			},
			revenuesAndTransfers: g.revenues,
			expenditures: g.expenditures,
			endingBalance: g.end,
			encumbrances: g.encumbrances,
			sfeu: g.sfeu,
			prop98: cs
				? {
						prop98: cs.prop98 * 1000,
						nonProp98: cs.nonProp98 * 1000,
						source: chartSrc(chartE!.page)
					}
				: null
		};
	}

	// ---- reserves
	const s1Tri = (k: string) => tri((y) => s1y(y).gf[k] ?? null);
	const changeOf = (bal: Tri, beginPy: number | null): Tri => ({
		py: bal.py != null && beginPy != null ? bal.py - beginPy : null,
		cy: bal.cy != null && bal.py != null ? bal.cy - bal.py : null,
		by: bal.by != null && bal.cy != null ? bal.by - bal.cy : null
	});
	const acct = (a: Omit<ReserveAccount, 'change'> & { change?: Tri }): ReserveAccount => ({
		...a,
		change: a.change ?? changeOf(a.balance, a.beginPy)
	});
	const sfeuBal = s1Tri('sfeu');
	const accounts: ReserveAccount[] = [
		acct({
			id: 'bsa',
			name: 'Budget Stabilization Account',
			short: 'Rainy Day Fund (BSA)',
			fundCode: '1011',
			description:
				'The constitutional rainy-day fund created by Proposition 2 (2014). It receives 1.5% of General Fund revenue each year plus a share of capital-gains revenue; withdrawals require a budget emergency.',
			balance: s1Tri('bsa'),
			beginPy: bsa10?.begin.py ?? null,
			inCombined: true,
			sources: [SRC.s1, SRC.s10]
		}),
		acct({
			id: 'psssa',
			name: 'Public School System Stabilization Account',
			short: 'School reserve (PSSSA)',
			fundCode: '1029',
			description:
				'Proposition 98 reserve for TK-12 schools and community colleges, filled in strong capital-gains years and drawn when the school funding guarantee falls.',
			balance: s1Tri('psssa'),
			beginPy: ps10?.begin.py ?? null,
			inCombined: true,
			sources: [SRC.s1, SRC.s10]
		}),
		acct({
			id: 'sfeu',
			name: 'Special Fund for Economic Uncertainties',
			short: 'Discretionary reserve (SFEU)',
			description:
				'The General Fund’s discretionary reserve — the part of the ending fund balance not set aside for encumbrances. A positive SFEU is how the State measures a balanced budget.',
			balance: sfeuBal,
			beginPy: null, // the prior-year SFEU is not printed in this Schedule 1
			inCombined: true,
			sources: [SRC.s1]
		}),
		acct({
			id: 'safetyNet',
			name: 'Safety Net Reserve',
			short: 'Safety Net Reserve',
			fundCode: '1019',
			description:
				'Reserve for CalWORKs and Medi-Cal costs in a downturn. It was fully drawn down in the past year.',
			balance: s1Tri('safetyNet'),
			beginPy: sn10?.begin.py ?? null,
			inCombined: true,
			sources: [SRC.s1, SRC.s10]
		})
	];
	if (sha10 && YK.some((y) => sha10.end[y] !== 0)) {
		accounts.push(
			acct({
				id: 'surplusHolding',
				name: 'Projected Surplus Temporary Holding Account',
				short: 'Surplus Holding Account',
				fundCode: '1032',
				description:
					'Created in 2024 to park part of a projected surplus until revenues are realized; the money is allocated in the following fiscal year. Not counted in the official “combined reserves”.',
				balance: fromP(sha10.end),
				beginPy: sha10.begin.py,
				inCombined: false,
				sources: [SRC.s10]
			})
		);
	}
	const combined = tri((y) =>
		sum(...accounts.filter((a) => a.inCombined).map((a) => a.balance[y]))
	);
	const withHolding = tri((y) => sum(...accounts.map((a) => a.balance[y])));

	// ---- special funds / federal / bond
	const reserveFundCodes = ['1011', '1019', '1029', '1032'];
	const specialFunds = {
		begin: fromP(sfTot?.begin),
		revenues: fromP(sfTot?.revenues),
		expenditures: fromP(sfTot?.expenditures),
		end: fromP(sfTot?.end),
		reserveAccounts: tri((y) => sum(...reserveFundCodes.map((c) => fund(c)?.end[y] ?? null))),
		sources: [SRC.s1, SRC.s8, SRC.s10]
	};
	const gt9 = s9.grandTotal;
	const federalAndBond = {
		federal: fromP(gt9?.federal),
		bond: fromP(gt9?.bond),
		sources: [SRC.s9, SRC.s1]
	};

	// ---- all funds (ebudget statistics + explorer meta for the excluded categories)
	type Stat = { allBudgetYearDols: number; stateBudgetYearDols: number };
	const stats = await f.api<Stat[]>('statistics', []);
	const metaPath = path.join(args.out!, FY, PIT, 'meta.json');
	type Meta = {
		totals?: {
			expenditures?: Tri;
			expendituresByFundType?: Record<string, Tri>;
			excluded?: Record<string, Tri>;
		};
	};
	const meta = readJSON<Meta>(metaPath);
	const flows = readJSON<{ extra?: { fundTypeBalance?: Record<string, number> } }>(
		path.join(args.out!, FY, PIT, 'flows.json')
	);
	const allFunds = {
		ebudgetAllFunds: stats.length
			? stats.reduce((a, s) => a + (s.allBudgetYearDols ?? 0), 0)
			: null,
		state: gt9?.total.by ?? null,
		federal: gt9?.federal.by ?? null,
		reimbursements: meta?.totals?.excluded?.reimbursement?.by ?? null,
		nongovernmental: meta?.totals?.excluded?.nongovernmental?.by ?? null,
		interimLoans: meta?.totals?.excluded?.interimLoan?.by ?? null,
		sources: [
			SRC.stats,
			SRC.s9,
			{
				label:
					'ebudget.ca.gov budget detail — expenditures by fund (reimbursements, nongovernmental cost funds)',
				url: `${EBUDGET}/budget/${PIT}/${FY}/BudgetDetail`
			}
		]
	};

	// ---- narrative chapters (Introduction of each publication of this budget year)
	type Chapter = { fileName: string; title: string };
	const docs: Record<string, Doc> = {};
	const pubs: { pit: 'p' | 'm' | 'e'; name: string }[] = [
		{ pit: 'p', name: "Governor's Budget Summary" },
		{ pit: 'm', name: 'May Revision' },
		{ pit: 'e', name: 'Enacted Budget Summary' }
	];
	const fetchers: Partial<Record<'p' | 'm' | 'e', RevFetcher>> = { [PIT]: f };
	for (const p of pubs) {
		if (p.pit === 'm' && PIT === 'p') continue; // later publications don't exist yet
		if (p.pit === 'e' && PIT !== 'e') continue;
		try {
			const pf = (fetchers[p.pit] ??= await new RevFetcher(FY, p.pit, {
				rawRoot: args.raw,
				refresh: args.refresh
			}).init());
			const chapters = await pf.api<Chapter[]>('budgetSummaryChapter', []);
			const intro = chapters.find((c) => /^Introduction$/i.test(c.title)) ?? {
				fileName: 'Introduction',
				title: 'Introduction'
			};
			const url = pf.summaryPdfUrl(intro.fileName + '.pdf');
			const buf = await pf.pdf(url);
			if (!buf) {
				warn(`${p.name}: Introduction chapter not published (${url})`);
				continue;
			}
			const d = new Doc(p.pit, `${p.name} ${FY} — Introduction`, url);
			d.paras = toParagraphs(await readRows(buf));
			docs[p.pit] = d;
			log(`  narrative ${p.pit}: ${d.paras.length} paragraphs`);
		} catch (e) {
			warn(`${p.name}: ${(e as Error).message}`);
		}
	}

	const quotes: Quote[] = [];
	const facts: NarrativeFact[] = [];
	const quoteFor = (d: Doc, para: Para, at: number, endAt = at, id?: string): Quote => {
		const text = sentenceAt(para, at, endAt);
		const ex = quotes.find((q) => q.text === text);
		if (ex) return ex;
		const q: Quote = {
			id: id ?? `${d.id}-q${quotes.length + 1}`,
			text,
			doc: d.label,
			source: d.src(para.page)
		};
		quotes.push(q);
		return q;
	};
	/** Find `re` (group 1 = number, group 2 = unit) in a doc and record a fact. */
	const fact = (
		docId: string,
		id: string,
		label: string,
		re: RegExp,
		year?: string
	): NarrativeFact | null => {
		const d = docs[docId];
		if (!d) return null;
		const hit = d.find(re);
		if (!hit) {
			warn(`narrative ${docId}: no match for ${id} (${re.source})`);
			return null;
		}
		const g = hit.m;
		const q = quoteFor(d, hit.para, hit.m.index, hit.m.index + hit.m[0].length);
		const nf: NarrativeFact = {
			id,
			label,
			amount: toThousands(g[1], g[2]),
			printed: `$${g[1]} ${g[2]}`,
			year,
			quoteId: q.id
		};
		facts.push(nf);
		return nf;
	};
	const quote = (docId: string, re: RegExp, id: string) => {
		const d = docs[docId];
		const hit = d?.find(re);
		if (!d || !hit) {
			if (d) warn(`narrative ${docId}: quote not found (${re.source})`);
			return null;
		}
		return quoteFor(d, hit.para, hit.m.index, hit.m.index + hit.m[0].length, id);
	};
	const AMT = String.raw`\$([\d.,]+) (billion|million)`;
	const R = (s: string) => new RegExp(s.replace(/AMT/g, AMT), 'i');

	// headline quotes
	quote('e', /largely maintains the May Revision framework/i, 'e-framework');
	quote('e', /possible in large part because of increased revenue/i, 'e-onetime');
	quote('e', /measured\s+by maintaining a positive balance/i, 'e-balanced-def');
	quote('e', /allows the state to set aside a portion/i, 'e-sha-why');
	quote('p', /Budget does not include new significant spending proposals/i, 'p-nonew');

	// the problem
	const fShort = fact(
		'p',
		'gb-shortfall',
		'Shortfall projected in the Governor’s Budget',
		R('projected shortfall of AMT'),
		Y.by
	);
	const fOut = fact(
		'p',
		'gb-outyear-deficit',
		'Deficit projected for the following year',
		R('projects a deficit of roughly AMT in the (\\d{4}-\\d{2})')
	);
	if (fOut)
		fOut.year = docs.p?.find(R('projects a deficit of roughly AMT in the (\\d{4}-\\d{2})'))?.m[3];
	fact(
		'p',
		'gb-revenue-up',
		'General Fund revenue upgrade since the 2025 Budget Act (3-year window)',
		R('higher by more than AMT over the budget window')
	);
	fact(
		'm',
		'mr-bigthree',
		'Big Three tax revenues above January forecast (3-year window)',
		R('AMT higher than projected in January')
	);
	fact(
		'm',
		'mr-spending-lower',
		'General Fund spending below the Governor’s Budget estimate',
		R('approximately AMT lower than estimated at the Governor'),
		Y.by
	);
	fact(
		'm',
		'mr-gb-shortfall',
		'January shortfall (as restated in the May Revision)',
		R('close a shortfall estimated at\\s+AMT'),
		Y.by
	);
	fact(
		'e',
		'e-prior-savings',
		'Ongoing savings from 2025 Budget Act reductions',
		R('almost AMT in ongoing savings')
	);

	// reserves (narrative)
	const fSfeu = fact(
		'e',
		'e-sfeu',
		'Discretionary reserve (SFEU), budget year',
		R('SFEU balances of AMT in \\d{4}-\\d{2}'),
		Y.by
	);
	fact(
		'e',
		'e-sfeu-next',
		'Discretionary reserve (SFEU), following year',
		R('SFEU balances of \\$[\\d.,]+ \\w+ in \\d{4}-\\d{2} and AMT in (\\d{4}-\\d{2})')
	);
	const fSha = fact(
		'e',
		'e-sha',
		'Transfer into the Surplus Holding Account',
		R('transfer of AMT into the Projected Surplus'),
		Y.by
	);
	const fBsaDep = fact(
		'e',
		'e-bsa-deposit',
		'Deposit into the Rainy Day Fund (BSA)',
		R('AMT deposit into the BSA'),
		Y.by
	);
	fact(
		'e',
		'e-bsa-suspension',
		'BSA “true-up” deposit suspended for the current year',
		R('total suspension in \\d{4}-\\d{2} is AMT'),
		Y.cy
	);
	const fWithdrawn = fact(
		'e',
		'e-bsa-withdrawn',
		'Withdrawn from the BSA over the last two fiscal years',
		R('withdrawn approximately AMT from\\s+the BSA')
	);
	const fBsaBal = fact(
		'e',
		'e-bsa-balance',
		'BSA balance, budget year',
		R('BSA\\s+balance in \\d{4}-\\d{2} is AMT'),
		Y.by
	);
	const fPsssa = fact(
		'e',
		'e-psssa',
		'Public School System Stabilization Account',
		R('AMT in the Public School System Stabilization Account'),
		Y.by
	);
	const fCombined = fact(
		'e',
		'e-combined',
		'Combined reserves (BSA + SFEU + PSSSA)',
		R('combined reserves in \\d{4}-\\d{2} to AMT'),
		Y.by
	);
	const fSetAside = fact(
		'e',
		'e-set-aside',
		'Set aside incl. the Surplus Holding Account',
		R('sets aside approximately AMT'),
		Y.by
	);

	// solutions (May Revision categories, which the Enacted Budget "largely maintains")
	const solutions: Solution[] = [];
	const SOL: [string, string, string][] = [
		[
			'revenue',
			'Revenue',
			'New or extended taxes: business credit limits, software sales tax, MCO tax renewal.'
		],
		[
			'spending',
			'Spending Reductions and Reforms',
			'Program reductions, e.g. Medi-Cal asset test limits.'
		],
		[
			'offsets',
			'General Fund Offsets',
			'Paying for General Fund costs from other funds (e.g. Behavioral Health Services Fund).'
		]
	];
	for (const [id, name, description] of SOL) {
		const re = R(`${name}\\s*—\\s*AMT in total solutions in (\\d{4}-\\d{2})`);
		const d = docs.m;
		const hit = d?.find(re);
		if (!d || !hit) {
			if (d) warn(`narrative m: solution category "${name}" not found`);
			continue;
		}
		const q = quoteFor(d, hit.para, hit.m.index, hit.m.index + hit.m[0].length);
		solutions.push({
			id,
			label: name,
			amount: toThousands(hit.m[1], hit.m[2]),
			printed: `$${hit.m[1]} ${hit.m[2]}`,
			year: hit.m[3],
			description,
			quoteId: q.id
		});
	}

	// enacted revenue measures (multi-year)
	const revenueMeasures: RevenueMeasure[] = [];
	const MEAS: [string, string, RegExp][] = [
		[
			'mco',
			'Managed Care Organization (MCO) Tax renewal',
			/^•?\s*Managed Care Organization \(MCO\) Tax/i
		],
		['credits', 'Business tax credit limitation', /^•?\s*Business Tax Credit Limitation/i],
		['software', 'Sales tax on electronically delivered software', /^•?\s*Prewritten Software Tax/i]
	];
	const fyRe = /\d{4}-\d{2}/;
	const nextFy = (s: string) => {
		const a = Number(s.slice(0, 4)) + 1;
		return `${a}-${String((a + 1) % 100).padStart(2, '0')}`;
	};
	for (const [id, label, head] of MEAS) {
		const d = docs.e;
		const para = d?.paras.find((p) => head.test(p.text));
		if (!d || !para) {
			if (d) warn(`narrative e: revenue measure "${label}" not found`);
			continue;
		}
		// only the General Fund impact: text after "…revenue by", before local-revenue sentences
		const m = /increas\w* (?:General Fund )?revenue by/i.exec(para.text);
		if (!m) {
			warn(`narrative e: no revenue amounts for "${label}"`);
			continue;
		}
		let tail = para.text.slice(m.index + m[0].length);
		tail = tail.split(/Additionally|local sales tax|, to support/i)[0];
		const byYear: Record<string, number> = {};
		let cur: number | null = null;
		let lastYear: string | null = null;
		const tokRe = /\$([\d.,]+) (billion|million)|(\d{4}-\d{2})|annually thereafter/gi;
		let t: RegExpExecArray | null;
		while ((t = tokRe.exec(tail))) {
			if (t[1]) cur = toThousands(t[1], t[2]);
			else if (t[3] && cur != null) {
				byYear[t[3]] = cur;
				lastYear = t[3];
			} else if (/annually/i.test(t[0]) && cur != null && lastYear) {
				// "and annually thereafter": carry through the four-year outlook DOF uses
				let y = lastYear;
				for (let i = 0; i < 4 && fyRe.test(y); i++) {
					y = nextFy(y);
					if (Number(y.slice(0, 4)) > Number(FY.slice(0, 4)) + 3) break;
					byYear[y] ??= cur;
				}
			}
		}
		const q = quoteFor(d, para, m.index, m.index + m[0].length);
		revenueMeasures.push({ id, label, byYear, quoteId: q.id });
	}

	// ---- plan evolution (budget year, GF): Governor's Budget -> May Revision -> Enacted
	const stages: PlanStage[] = [];
	if (PIT === 'e' || PIT === 'm') {
		try {
			const pf = (fetchers.p ??= await new RevFetcher(FY, 'p', { rawRoot: args.raw }).init());
			const url = pf.summaryPdfUrl('BS_SCH1.pdf');
			const buf = await pf.pdf(url);
			const b = buf ? parseSchedule1(await readRows(buf))[FY]?.gf : undefined;
			if (b)
				stages.push({
					pit: 'p',
					label: "Governor's Budget",
					date: pf.appInfo.publicationDate,
					beginningBalance: b.begin,
					revenuesAndTransfers: b.revenues,
					expenditures: b.expenditures,
					endingBalance: b.end,
					sfeu: b.sfeu,
					bsa: b.bsa,
					psssa: b.psssa,
					transcribed: false,
					source: {
						label: "DOF Summary Schedule 1 — General Budget Summary (Governor's Budget)",
						url
					}
				});
			else warn("Governor's Budget Schedule 1 not available");
		} catch (e) {
			warn(`Governor's Budget Schedule 1: ${(e as Error).message}`);
		}
	}
	const mt = CHART_TRANSCRIPTIONS[FY]?.m;
	if (PIT === 'e' && mt) {
		const mf = (fetchers.m ??= await new RevFetcher(FY, 'm', { rawRoot: args.raw }).init());
		const k = (n: number) => n * 1000;
		stages.push({
			pit: 'm',
			label: 'May Revision',
			date: mf.appInfo.publicationDate,
			beginningBalance: k(mt.by.begin),
			revenuesAndTransfers: k(mt.by.revenues),
			expenditures: k(mt.by.expenditures),
			endingBalance: k(mt.by.end),
			sfeu: k(mt.by.sfeu),
			bsa: k(mt.by.bsa),
			psssa: k(mt.by.psssa),
			transcribed: true,
			source: {
				label:
					'May Revision — Summary Charts, “General Fund Budget Summary” (millions, transcribed)',
				url: mf.summaryPdfUrl('SummaryCharts.pdf'),
				page: mt.page
			}
		});
	}
	{
		const b = s1y('by').gf;
		stages.push({
			pit: PIT,
			label: PIT === 'e' ? 'Enacted Budget' : PIT === 'm' ? 'May Revision' : "Governor's Budget",
			date: ai.publicationDate,
			beginningBalance: b.begin,
			revenuesAndTransfers: b.revenues,
			expenditures: b.expenditures,
			endingBalance: b.end,
			sfeu: b.sfeu,
			bsa: b.bsa,
			psssa: b.psssa,
			transcribed: false,
			source: SRC.s1
		});
	}
	// keep one stage per publication, in order
	const order = { p: 0, m: 1, e: 2 };
	const planStages = stages
		.filter((s, i) => stages.findIndex((x) => x.pit === s.pit) === i)
		.sort((a, b) => order[a.pit] - order[b.pit]);

	// ───────────────────────── checks ─────────────────────────
	const checks: ReconCheck[] = [];
	const check = (
		id: string,
		label: string,
		expected: number | null | undefined,
		actual: number | null | undefined,
		sources: SourceRef[],
		tolerance = 1,
		note?: string
	) => {
		if (expected == null || actual == null) {
			warn(`check ${id}: missing value (${expected} vs ${actual})`);
			return;
		}
		const difference = actual - expected;
		const ok = Math.abs(difference) <= tolerance;
		checks.push({
			id,
			label,
			expected,
			actual,
			difference,
			tolerance,
			ok,
			status: ok ? 'ties' : 'differs',
			note,
			sources
		});
	};
	/**
	 * Attach documented causes to a check. It becomes "explained" only if it does not tie and the
	 * items account for the whole difference (within the check's tolerance); otherwise it stays
	 * "differs" and the explanation shows what is still unaccounted for.
	 */
	const explain = (id: string, summary: string, items: CheckExplanationItem[]) => {
		const c = checks.find((x) => x.id === id);
		if (!c || c.ok) return;
		const unexplained = c.difference - items.reduce((a, i) => a + i.amount, 0);
		c.explanation = { summary, items, unexplained };
		if (Math.abs(unexplained) <= c.tolerance) c.status = 'explained';
	};
	for (const y of YK) {
		const g = gfYears[y];
		const yl = Y[y];
		check(
			`gf-identity-${y}`,
			`${yl}: beginning balance + revenues & transfers − expenditures = ending fund balance (General Fund)`,
			g.endingBalance,
			g.beginningBalance + g.revenuesAndTransfers - g.expenditures,
			[SRC.s1]
		);
		check(
			`gf-split-${y}`,
			`${yl}: ending fund balance = encumbrance reserve + SFEU`,
			g.endingBalance,
			g.encumbrances + g.sfeu,
			[SRC.s1]
		);
		check(
			`gf-s8-${y}`,
			`${yl}: Schedule 1 GF revenues & transfers = Schedule 8 total`,
			g.revenuesAndTransfers,
			s8.totalAll?.gf[y],
			[SRC.s1, SRC.s8]
		);
		check(
			`gf-s8-parts-${y}`,
			`${yl}: Schedule 8 GF revenues + transfers & loans = revenues, transfers & loans`,
			s8.totalAll?.gf[y],
			sum(g.revenues, g.transfers.total),
			[SRC.s8]
		);
		check(
			`gf-s9-${y}`,
			`${yl}: Schedule 1 GF expenditures = Schedule 9 grand total`,
			g.expenditures,
			gt9?.gf[y],
			[SRC.s1, SRC.s9]
		);
		if (gf10) {
			check(
				`gf-s10-begin-${y}`,
				`${yl}: GF beginning balance, Schedule 1 = Schedule 10`,
				g.beginningBalance,
				gf10.begin[y],
				[SRC.s1, SRC.s10]
			);
			check(
				`gf-s10-end-${y}`,
				`${yl}: GF ending balance, Schedule 1 = Schedule 10`,
				g.endingBalance,
				gf10.end[y],
				[SRC.s1, SRC.s10]
			);
		}
		const sf = s1y(y).sf;
		check(
			`sf-identity-${y}`,
			`${yl}: special funds beginning + revenues − expenditures = ending (Schedule 10 totals)`,
			specialFunds.end[y],
			sum(specialFunds.begin[y], specialFunds.revenues[y], -(specialFunds.expenditures[y] ?? 0)),
			[SRC.s10]
		);
		check(
			`sf-s1-${y}`,
			`${yl}: special funds ending balance, Schedule 1 = Schedule 10`,
			sf.end,
			specialFunds.end[y],
			[SRC.s1, SRC.s10]
		);
		check(
			`sf-reu-${y}`,
			`${yl}: special-fund Reserves for Economic Uncertainties = special-fund ending balance`,
			sf.end,
			sf.reu,
			[SRC.s1]
		);
		check(
			`state-total-${y}`,
			`${yl}: GF + special + bond expenditures = Schedule 1 expenditure total`,
			s1y(y).total.expenditures,
			sum(g.expenditures, sf.expenditures, s1y(y).bond.expenditures),
			[SRC.s1]
		);
		if (bsa10) {
			check(
				`bsa-s10-${y}`,
				`${yl}: BSA balance, Schedule 1 = Schedule 10 (fund 1011)`,
				s1y(y).gf.bsa,
				bsa10.end[y],
				[SRC.s1, SRC.s10]
			);
			check(
				`bsa-flow-${y}`,
				`${yl}: BSA beginning + transfers in − expenditures = ending (Schedule 10)`,
				bsa10.end[y],
				bsa10.begin[y] + bsa10.revenues[y] - bsa10.expenditures[y],
				[SRC.s10]
			);
		}
		if (ps10)
			check(
				`psssa-s10-${y}`,
				`${yl}: PSSSA balance, Schedule 1 = Schedule 10 (fund 1029)`,
				s1y(y).gf.psssa,
				ps10.end[y],
				[SRC.s1, SRC.s10]
			);
		if (y !== 'py')
			check(
				`continuity-${y}`,
				`${yl}: GF beginning balance = prior year’s ending balance`,
				gfYears[y === 'cy' ? 'py' : 'cy'].endingBalance,
				g.beginningBalance,
				[SRC.s1]
			);
	}
	// net transfers across all state funds (GF + special)
	check(
		'transfers-net-by',
		`${Y.by}: GF transfers out ≈ special-fund transfers in (net across state funds shown by Schedule 8 total)`,
		transfers?.total?.total.by,
		sum(transfers?.total?.gf.by, transfers?.total?.sf.by),
		[SRC.s8]
	);
	// Summary Charts transcription vs Schedule 1 (millions)
	if (chartE) {
		const map: [string, (y: 'cy' | 'by') => number][] = [
			['begin', (y) => gfYears[y].beginningBalance],
			['revenues', (y) => gfYears[y].revenuesAndTransfers],
			['expenditures', (y) => gfYears[y].expenditures],
			['end', (y) => gfYears[y].endingBalance],
			['encumbrances', (y) => gfYears[y].encumbrances],
			['sfeu', (y) => gfYears[y].sfeu],
			['bsa', (y) => s1y(y).gf.bsa],
			['psssa', (y) => s1y(y).gf.psssa]
		];
		for (const y of ['cy', 'by'] as const) {
			for (const [k, fn] of map)
				check(
					`chart-${k}-${y}`,
					`${Y[y]}: Summary Charts “General Fund Budget Summary” ${k} (millions) = Schedule 1 rounded`,
					chartE.gfSummary[y][k] * 1000,
					Math.round(fn(y) / 1000) * 1000,
					[chartSrc(chartE.page), SRC.s1],
					0
				);
			check(
				`chart-prop98-${y}`,
				`${Y[y]}: Prop 98 + non-Prop 98 (chart, millions) = total GF expenditures`,
				chartE.gfSummary[y].expenditures * 1000,
				(chartE.gfSummary[y].prop98 + chartE.gfSummary[y].nonProp98) * 1000,
				[chartSrc(chartE.page)],
				1000,
				'Chart figures are rounded to millions.'
			);
			check(
				`chart-revsub-${y}`,
				`${Y[y]}: chart GF revenue subtotal + BSA transfer = revenues & transfers`,
				gfYears[y].revenuesAndTransfers,
				(chartE.gfRevenueSubtotal[y] + chartE.bsaTransfer[y]) * 1000,
				[chartSrc(chartE.revenueSourcesPage), SRC.s1],
				1000,
				'Chart figures are rounded to millions.'
			);
			check(
				`chart-bsa-transfer-${y}`,
				`${Y[y]}: chart BSA transfer = Schedule 10 BSA transfers (sign flipped)`,
				chartE.bsaTransfer[y] * 1000,
				Math.round((gfYears[y].transfers.bsa ?? 0) / 1000) * 1000,
				[chartSrc(chartE.revenueSourcesPage), SRC.s10],
				0
			);
		}
	}
	// narrative vs schedules (narrative rounds to $0.1B)
	const B = 50_000; // half of $0.1B in thousands
	const narr = (
		id: string,
		nf: NarrativeFact | null,
		actual: number | null | undefined,
		label: string,
		srcs: SourceRef[],
		tol = B,
		note?: string
	) => {
		if (!nf) return;
		const q = quotes.find((x) => x.id === nf.quoteId);
		check(
			id,
			label,
			nf.amount,
			actual,
			[...(q ? [q.source] : []), ...srcs],
			tol,
			note ?? `Narrative prints ${nf.printed}.`
		);
	};
	narr('narr-sfeu', fSfeu, gfYears.by.sfeu, `Narrative SFEU = Schedule 1 SFEU (${Y.by})`, [SRC.s1]);
	narr('narr-bsa', fBsaBal, s1y('by').gf.bsa, `Narrative BSA balance = Schedule 1 (${Y.by})`, [
		SRC.s1
	]);
	narr('narr-psssa', fPsssa, s1y('by').gf.psssa, `Narrative PSSSA = Schedule 1 (${Y.by})`, [
		SRC.s1
	]);
	narr(
		'narr-bsa-deposit',
		fBsaDep,
		bsa10?.revenues.by,
		`Narrative BSA deposit = Schedule 10 BSA transfer in (${Y.by})`,
		[SRC.s10]
	);
	narr(
		'narr-sha',
		fSha,
		sha10?.revenues.by,
		`Narrative Surplus Holding transfer = Schedule 10 fund 1032 (${Y.by})`,
		[SRC.s10]
	);
	narr(
		'narr-combined',
		fCombined,
		sum(s1y('by').gf.bsa, gfYears.by.sfeu, s1y('by').gf.psssa),
		`Narrative combined reserves = BSA + SFEU + PSSSA (${Y.by})`,
		[SRC.s1]
	);
	narr(
		'narr-set-aside',
		fSetAside,
		withHolding.by,
		`Narrative “set aside” = combined reserves + Surplus Holding Account (${Y.by})`,
		[SRC.s1, SRC.s10]
	);
	// Like with like: the narrative counts withdrawals only; Schedule 10's BSA "revenues" are the
	// net of withdrawals, deposits, true-ups and suspensions. Use the FCS withdrawal lines.
	if (bsa10 && bsaFcs)
		check(
			'bsa-fcs-net',
			`${Y.py} + ${Y.cy}: Schedule 10 BSA net transfers = BSA fund condition statement total (withdrawals + deposits + true-ups + suspensions)`,
			bsa10.revenues.py + bsa10.revenues.cy,
			bsaFcs.total.py + bsaFcs.total.cy,
			[SRC.s10, bsaFcsSrc]
		);
	narr(
		'narr-bsa-withdrawn',
		fWithdrawn,
		bsaFcs ? -(bsaFcs.withdrawals.py + bsaFcs.withdrawals.cy) : null,
		`Narrative “withdrawn from the BSA over the last two fiscal years” = BSA withdrawals, Art. XVI §22(a)(2)(A) lines of the BSA fund condition statement (${Y.py} + ${Y.cy})`,
		[bsaFcsSrc],
		B,
		bsaFcs && bsa10
			? `Narrative prints ${fWithdrawn?.printed}. Compared with gross withdrawals (${fmtB(-bsaFcs.withdrawals.py)} + ${fmtB(-bsaFcs.withdrawals.cy)}); Schedule 10’s net ${fmtB(-(bsa10.revenues.py + bsa10.revenues.cy))} also nets ${fmtB(bsa10.revenues.py + bsa10.revenues.cy - bsaFcs.withdrawals.py - bsaFcs.withdrawals.cy)} of true-up deposits.`
			: undefined
	);
	if (bsaFcs && FY === '2026-27') {
		// Documented: the $12.2B is the 2024 Budget Act's authorization ($5.1B + $7.1B).
		const AUTH = { py: 5_100_000, cy: 7_100_000 };
		const intro = (fy: string, page: number): SourceRef => ({
			label: `California State Budget ${fy} (Enacted Budget Summary) — Introduction`,
			url: `${EBUDGET}/${fy}/pdf/Enacted/BudgetSummary/Introduction.pdf`,
			page
		});
		explain(
			'narr-bsa-withdrawn',
			`The narrative’s “approximately $12.2 billion” is the 2024 Budget Act’s authorization — $5.1 billion in ${Y.py} and $7.1 billion in ${Y.cy} (2024-25 Enacted Budget Summary, Introduction p. 3; restated in the 2025-26 Enacted Budget Summary, Introduction p. 3). The amounts booked as withdrawals in the BSA fund condition statement are ${fmtB(-bsaFcs.withdrawals.py)} and ${fmtB(-bsaFcs.withdrawals.cy)}. (The rest of the gap to Schedule 10’s net figure is the 2024-25 true-up deposits, which Schedule 10 nets against the withdrawals — see the “BSA net transfers” check.)`,
			[
				{
					label: `${Y.py} BSA withdrawal: booked vs. authorized`,
					amount: -bsaFcs.withdrawals.py - AUTH.py,
					cause: `The 2024 Budget Act summary describes a $5.1 billion ${Y.py} withdrawal; every BSA fund condition statement since the 2024 Budget Act books it at ${(-bsaFcs.withdrawals.py).toLocaleString('en-US')}K (2024-25 Enacted 9658 FCS p. 1, “(BSA Withdrawal) … -4,926,000”; 2026-27 Enacted 9658 FCS p. 1). The narrative carries the rounded authorization forward.`,
					sources: [
						intro('2024-25', 3),
						intro('2025-26', 3),
						{
							label:
								'9658 Budget Stabilization Account — Fund Condition Statement (2024 Budget Act)',
							url: `${EBUDGET}/2024-25/pdf/Enacted/GovernorsBudget/8000/9658FCS.pdf`,
							page: 1
						},
						bsaFcsSrc
					]
				},
				{
					label: `${Y.cy} BSA withdrawal: booked vs. authorized`,
					amount: -bsaFcs.withdrawals.cy - AUTH.cy,
					cause: `Booked at the authorized $7.1 billion.`,
					sources: [intro('2025-26', 3), bsaFcsSrc]
				}
			].filter((i) => i.amount !== 0 || i.label.startsWith(Y.py))
		);
	}
	if (fShort && docs.m) {
		const mr = facts.find((x) => x.id === 'mr-gb-shortfall');
		if (mr)
			check(
				'narr-shortfall',
				'January shortfall: Governor’s Budget = as restated in May Revision',
				fShort.amount,
				mr.amount,
				[docs.p!.src(), docs.m.src()],
				0
			);
	}
	// flows.json fund-balance node vs Schedule 1
	const ftb = flows?.extra?.fundTypeBalance;
	if (ftb?.general != null)
		check(
			'flows-gf-balance',
			`${Y.by}: flows.json “drawn from fund balances” (General Fund) = Schedule 1 change in fund balance`,
			gfYears.by.endingBalance - gfYears.by.beginningBalance,
			ftb.general,
			[SRC.s1]
		);
	if (ftb?.special != null)
		check(
			'flows-sf-balance',
			`${Y.by}: flows.json special-fund balance change = Schedule 10 change`,
			sum(specialFunds.end.by, -(specialFunds.begin.by ?? 0)),
			ftb.special,
			[SRC.s10]
		);
	// all funds decomposition
	if (allFunds.ebudgetAllFunds != null) {
		check(
			'stats-state',
			`${Y.by}: ebudget statistics state funds total = Schedule 9 budget total`,
			gt9?.total.by,
			stats.reduce((a, s) => a + (s.stateBudgetYearDols ?? 0), 0),
			[SRC.stats, SRC.s9]
		);
		check(
			'all-funds',
			`${Y.by}: ebudget “all funds” = state + federal + reimbursements + nongovernmental cost funds + loan-financed interim payments`,
			allFunds.ebudgetAllFunds,
			sum(
				allFunds.state,
				allFunds.federal,
				allFunds.reimbursements,
				allFunds.nongovernmental,
				allFunds.interimLoans
			),
			allFunds.sources,
			1,
			'Reimbursement and nongovernmental totals come from the explorer’s expenditure ETL (meta.json), summed from ebudget’s per-department fund detail.'
		);
	}
	// explorer spending totals vs Schedule 9, then department by department: every difference is
	// itemized and either matched to a documented cause (lib/recon-explained.ts) or left unexplained.
	const mft = meta?.totals?.expendituresByFundType;
	const reconNotes: string[] = [];
	if (mft && gt9) {
		const FT = [
			['general', 'gf'],
			['special', 'sf'],
			['bond', 'bond'],
			['federal', 'federal']
		] as const;
		type ExpNode = {
			code?: string;
			name: string;
			byFundType?: Record<string, Tri>;
			children?: ExpNode[];
		};
		const expTree = readJSON<ExpNode>(path.join(args.out!, FY, PIT, 'expenditures.json'));
		const expDept = new Map<string, ExpNode>();
		for (const a of expTree?.children ?? [])
			for (const d of a.children ?? []) if (d.code) expDept.set(d.code, d);
		const s9Dept = new Map(s9.agencies.flatMap((a) => a.depts.map((d) => [d.code, d] as const)));
		const helpers: SourceHelpers = {
			s9: (page) => ({ ...SRC.s9, page }),
			dept: (ag, org, page, what) => ({
				label: `${org} department budget detail${what ? ` — ${what}` : ''} (${pub})`,
				url: `${f.pdfRoot}GovernorsBudget/${ag}/${org}.pdf`,
				page
			}),
			fcs: (ag, org, page, what) => ({
				label: `${org} fund condition statements${what ? ` — ${what}` : ''} (${pub})`,
				url: f.fcsPdfUrl(ag, org),
				page
			}),
			api: (p) => ({ label: `ebudget.ca.gov API: ${p}`, url: f.apiUrl(p) })
		};
		const known = departmentDifferences(FY, PIT, helpers);
		const codes = [...new Set([...expDept.keys(), ...s9Dept.keys()])].sort();
		for (const y of YK)
			for (const [k, s9k] of FT) {
				if (mft[k]?.[y] == null) continue;
				const id = `explorer-${k}-${y}`;
				check(
					id,
					`${Y[y]}: explorer ${k} spending total (meta.json) = Schedule 9`,
					gt9[s9k][y],
					mft[k][y],
					[SRC.s9],
					1,
					'Explorer totals are summed from ebudget department detail (expenditures by fund); Schedule 9 is DOF’s statewide summary by department.'
				);
				const c = checks.find((x) => x.id === id);
				if (!expTree || !c || c.ok) continue;
				const items: CheckExplanationItem[] = [];
				const unknown: string[] = [];
				for (const code of codes) {
					const e = expDept.get(code);
					const sd = s9Dept.get(code);
					const ours = e?.byFundType?.[k]?.[y] ?? 0;
					const theirs = sd?.totals[s9k][y] ?? 0;
					const diff = ours - theirs;
					if (Math.abs(diff) <= 1) continue;
					const label = `${code} ${e?.name ?? sd?.name ?? ''} — ${k} funds, ${Y[y]}: department detail ${fmtK(ours)} vs. Schedule 9 ${fmtK(theirs)}`;
					const kn = known.find(
						(x) =>
							x.orgCd === code && x.fundType === k && x.year === y && Math.abs(x.amount - diff) <= 1
					);
					if (kn) items.push({ label, amount: diff, cause: kn.cause, sources: kn.sources });
					else unknown.push(`${label} (${fmtK(diff, true)})`);
				}
				if (unknown.length)
					c.note = `${c.note} Unexplained department differences: ${unknown.join('; ')}.`;
				if (!items.length) continue;
				explain(
					id,
					`Department by department, the explorer’s ${k}-fund total for ${Y[y]} matches Schedule 9 except in ${items.length + unknown.length} department(s). ${unknown.length ? `${unknown.length} of them are not explained yet.` : 'Each difference is a documented disagreement between official DOF publications (department budget detail vs. the statewide summary schedule). The explorer keeps the department detail so every tree adds up; Schedule 9’s figure is the official statewide total.'}`,
					items
				);
				if (c.status === 'explained')
					reconNotes.push(
						`${Y[y]} ${k} funds: explorer ${fmtK(c.actual)} vs. DOF Schedule 9 ${fmtK(c.expected)} (official statewide total), difference ${fmtK(c.difference, true)} — ${items
							.map(
								(i) =>
									`${i.label.split(' — ')[0]} ${fmtK(i.amount, true)} (${i.sources
										.filter((s) => s.page)
										.map((s) => `${s.label.split(' (')[0]} p. ${s.page}`)
										.join('; ')})`
							)
							.join('; ')}. Details: reconciliation page, check ${id}.`
					);
			}
	}

	// ───────────────────────── "why the numbers differ" ─────────────────────────
	const by = gfYears.by;
	const revUp = facts.find((x) => x.id === 'gb-revenue-up');
	const differences: DiffItem[] = [];
	const add = (d: DiffItem) => differences.push(d);
	add({
		id: 'transfers',
		title: 'Transfers & loans move money between funds',
		body: `Schedule 8 lists General Fund revenue of ${fmtB(by.revenues)} before transfers. Net transfers and loans of ${fmtB(by.transfers.total)} — mostly deposits into reserve accounts that are legally separate funds — bring “revenues and transfers” to ${fmtB(by.revenuesAndTransfers)}. Across all state funds the transfers net to almost nothing (${fmtB(transfers?.total?.total.by)}): what leaves the General Fund shows up as special-fund revenue.`,
		amount: by.transfers.total,
		tone: 'moves',
		sources: [SRC.s8, SRC.s10]
	});
	add({
		id: 'balance',
		title: 'Spending is partly paid from last year’s balance',
		body: `The General Fund starts ${Y.by} with ${fmtB(by.beginningBalance)} carried in: ${fmtB(gfYears.cy.encumbrances)} already committed (encumbrances) and ${fmtB(gfYears.cy.sfeu)} in the discretionary reserve${revUp ? `, built up as revenue ran ${revUp.printed.replace('$', 'more than $')} above the 2025 Budget Act forecast from ${Y.py} through ${Y.by} (Governor’s Budget estimate)` : ''}. Spending of ${fmtB(by.expenditures)} exceeds revenues and transfers by ${fmtB(by.expenditures - by.revenuesAndTransfers)}, and that gap is covered by drawing the balance down to ${fmtB(by.endingBalance)}. The State measures a balanced budget by a positive SFEU at year end (${fmtB(by.sfeu)}), so a planned draw on the carry-in is consistent with a balanced budget.`,
		amount: by.endingBalance - by.beginningBalance,
		tone: 'removes',
		sources: [
			SRC.s1,
			...(revUp ? [docs.p!.src(quotes.find((q) => q.id === revUp.quoteId)?.source.page)] : [])
		]
	});
	add({
		id: 'reserves',
		title: 'Reserves sit outside the General Fund',
		body: `The Rainy Day Fund (${fmtB(s1y('by').gf.bsa)}), the school reserve (${fmtB(s1y('by').gf.psssa)})${sha10?.end.by ? ` and the Surplus Holding Account (${fmtB(sha10.end.by)})` : ''} are special funds. A deposit is a General Fund transfer out (it lowers “revenues and transfers”) and special-fund revenue in, so it inflates special-fund revenue (${fmtB(specialFunds.revenues.by)}) and balances (${fmtB(specialFunds.end.by)}, of which ${fmtB(specialFunds.reserveAccounts.by)} are these reserves).`,
		amount: specialFunds.reserveAccounts.by,
		tone: 'moves',
		sources: [SRC.s1, SRC.s10]
	});
	add({
		id: 'encumbrances',
		title: 'Not all of the fund balance is available',
		body: `Of the ${fmtB(by.endingBalance)} General Fund ending balance, ${fmtB(by.encumbrances)} is the Reserve for Liquidation of Encumbrances — money already committed to contracts and orders not yet paid (an accrual/timing item under GAAP). Only the SFEU (${fmtB(by.sfeu)}) is a true discretionary reserve.`,
		amount: by.encumbrances,
		tone: 'neutral',
		sources: [SRC.s1]
	});
	add({
		id: 'federal-bond',
		title: 'Federal funds and bonds aren’t state revenue',
		body: `${fmtB(federalAndBond.federal.by)} of federal funds and ${fmtB(federalAndBond.bond.by)} of bond-financed spending are in total spending but not in Schedule 8 revenue: federal grants arrive for specific programs and bond proceeds are borrowing, repaid later through General Fund debt service.`,
		amount: sum(federalAndBond.federal.by, federalAndBond.bond.by),
		tone: 'adds',
		sources: [SRC.s9, SRC.s1]
	});
	if (allFunds.ebudgetAllFunds != null && allFunds.reimbursements != null)
		add({
			id: 'all-funds',
			title: '“All funds” counts some dollars twice',
			body: `ebudget’s ${fmtB(allFunds.ebudgetAllFunds)} “all funds” figure adds ${fmtB(allFunds.reimbursements)} of reimbursements (one department paying another — already counted where the money started) and ${fmtB(allFunds.nongovernmental)} of nongovernmental cost funds (pension trusts, university own funds, local property tax and similar pass-throughs). This explorer leaves both out, so total spending is ${fmtB(sum(allFunds.state, allFunds.federal))} (state ${fmtB(allFunds.state)} + federal ${fmtB(allFunds.federal)}).`,
			amount: sum(allFunds.reimbursements, allFunds.nongovernmental),
			tone: 'removes',
			sources: allFunds.sources
		});
	add({
		id: 'gaap',
		title: 'Budget basis isn’t accounting basis',
		body: 'Budget-year and current-year figures are estimates. Schedule 1 notes that the encumbrance reserve follows Generally Accepted Accounting Principles and Government Code sections 13306–13307, but the budget is a plan, not an audit: actual results are reported later (the past-year column already reflects them) and accrual and timing adjustments mean the State’s audited financial statements will not match these figures exactly.',
		amount: null,
		tone: 'neutral',
		sources: [SRC.s1]
	});
	add({
		id: 'rounding',
		title: 'Thousands vs. millions vs. billions',
		body: 'Schedules print thousands of dollars; Summary Charts print millions; the narrative rounds to tenths of a billion. Each rounding step can shift a total by a few units — e.g. the Introduction’s “$28.8 billion” combined reserves is the rounded sum of three schedule lines. Every figure on this page is checked against its source within the rounding of the printed unit.',
		amount: null,
		tone: 'neutral',
		sources: [SRC.s1, SRC.charts]
	});

	// ───────────────────────── output ─────────────────────────
	const shortfall = facts.find((x) => x.id === 'gb-shortfall');
	const outyear = facts.find((x) => x.id === 'gb-outyear-deficit');
	const summary =
		shortfall && docs.e
			? `In January the Governor’s Budget projected a ${shortfall.printed} shortfall for ${Y.by}${outyear ? ` and a deficit of roughly ${outyear.printed} in ${outyear.year ?? 'the following year'}` : ''}. Higher revenue at the May Revision plus new revenue, spending reductions and fund shifts balanced both years; the Enacted Budget keeps that framework, ends ${Y.by} with ${fmtB(by.sfeu)} in the SFEU and rebuilds the Rainy Day Fund to ${fmtB(s1y('by').gf.bsa)}.`
			: `General Fund spending of ${fmtB(by.expenditures)} versus revenues and transfers of ${fmtB(by.revenuesAndTransfers)}; the difference is drawn from the fund balance.`;

	const out: Reconciliation = {
		fiscalYear: FY,
		pit: PIT,
		publication: pub,
		publicationDate: ai.publicationDate,
		years: Y,
		units: 'thousands',
		generatedAt: new Date().toISOString(),
		generalFund: { years: gfYears, sources: [SRC.s1, SRC.s8, SRC.s9, SRC.s10, SRC.charts] },
		reserves: { accounts, combined, withHolding },
		specialFunds,
		federalAndBond,
		allFunds,
		plan: { stages: planStages },
		problem: {
			summary,
			facts,
			solutions,
			solutionsNote:
				'The Enacted Budget Summary does not print a single table of budget solutions. Categories are the May Revision’s, which the 2026 Budget Act “largely maintains”; revenue measures are as enacted.',
			revenueMeasures,
			quotes
		},
		differences,
		checks,
		sources: [
			SRC.s1,
			SRC.s8,
			SRC.s9,
			SRC.s10,
			SRC.charts,
			...Object.values(docs).map((d) => d.src()),
			...planStages.filter((s) => s.transcribed).map((s) => s.source),
			SRC.stats,
			{
				label: 'ebudget.ca.gov API: budgetSummaryChapter (chapter index)',
				url: f.apiUrl('budgetSummaryChapter')
			}
		],
		notes: [
			'Amounts are in thousands of dollars as printed in DOF Summary Schedules; narrative figures are converted from “$X billion/million”.',
			'Figures marked “transcribed” come from Summary Charts printed as images and were keyed by hand (millions); each is cross-checked against Schedule 1 where both exist.',
			'Transfers to the BSA, Safety Net Reserve and Surplus Holding Account are taken from those funds’ Schedule 10 rows (revenues = transfers in); “other transfers” is the remainder of Schedule 8 net transfers & loans.',
			'Check status: “ties” = within tolerance; “explained” = the sources genuinely differ and documented, cited causes account for the whole difference; “differs” = unexplained.',
			...(FY === '2026-27' && PIT === 'e'
				? [
						'Explorer spending excludes fund 0201 Medical Providers Interim Payment Fund (Health Care Services; ebudget class “federal”): it is financed by General Fund / Federal Trust Fund loans and its expenditures are moved to the regular Budget Act items (Gov. Code 16531.1; DOF Manual of State Funds, fund 0201), and Schedule 9 does not count it. Where ebudget’s expenditures-by-fund API differs from a department’s printed Detail of Appropriations (2026-27 Enacted: 9889 PSSSA, 2025-26 −$3,370,962K in the API vs. −$3,870,962K printed, which matches Schedule 9), the explorer uses the printed figure.'
					]
				: []),
			...reconNotes
		],
		warnings
	};
	const outDir = path.join(args.out!, FY, PIT);
	fs.mkdirSync(outDir, { recursive: true });
	fs.writeFileSync(
		path.join(outDir, 'reconciliation.json'),
		JSON.stringify(out, null, '\t') + '\n'
	);
	// meta.json: replace this step's notes (prefixed "Reconciliation: ") so the explorer shows them
	if (meta) {
		const m = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as { notes?: string[] };
		m.notes = [
			...(m.notes ?? []).filter((n) => !n.startsWith('Reconciliation: ')),
			...reconNotes.map((n) => `Reconciliation: ${n}`)
		];
		fs.writeFileSync(metaPath, JSON.stringify(m));
	}
	for (const c of checks)
		if (c.status !== 'ties')
			log(
				`    ${c.status}: ${c.id} expected ${c.expected} actual ${c.actual} (diff ${c.difference})${c.explanation ? ` — ${c.explanation.items.length} cited cause(s), unexplained ${c.explanation.unexplained}` : ''}`
			);
	const bad = checks.filter((c) => c.status === 'differs');
	const expl = checks.filter((c) => c.status === 'explained');
	log(`  wrote ${path.join(outDir, 'reconciliation.json')}`);
	log(
		`  checks: ${checks.length - bad.length - expl.length}/${checks.length} tie, ${expl.length} explained, ${bad.length} differ; facts ${facts.length}, solutions ${solutions.length}, measures ${revenueMeasures.length}, quotes ${quotes.length}`
	);
	log(`  http: ${JSON.stringify(f.stats)}`);
	if (warnings.length) log(`  ${warnings.length} warning(s)`);
}

function fmtK(t: number, sign = false): string {
	return `${sign && t > 0 ? '+' : t < 0 ? '−' : ''}$${Math.abs(t).toLocaleString('en-US')}K`;
}

function fmtB(t: number | null | undefined): string {
	if (t == null) return '—';
	const b = t / 1e6;
	const s = Math.abs(b) >= 1 ? b.toFixed(1) : b.toFixed(2);
	return (b < 0 ? '−$' : '$') + s.replace('-', '') + 'B';
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
