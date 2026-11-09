/**
 * Parser for ebudget "Governor's Budget detail" department PDFs
 * (https://ebudget.ca.gov/{fy}/pdf/{pub}/GovernorsBudget/{agency}/{org}.pdf).
 *
 * The PDFs are DOF-generated with a very regular layout: labels on the left
 * (x≈67-200), three right-aligned money columns (PY/CY/BY, x≈360-540), and for the
 * category table three extra position columns (x≈260-380). We rebuild visual lines
 * from pdf.js text items, cluster wrapped lines, then run small state machines per
 * section:
 *   - DETAILED EXPENDITURES BY PROGRAM  -> program/subprogram/element x fund x (SO/LA/CO)
 *   - EXPENDITURES BY CATEGORY          -> category -> object lines (+ positions)
 *   - DETAIL OF APPROPRIATIONS AND ADJUSTMENTS -> (SO/LA/CO) x fund x item/authority (+ adjustments)
 *   - FUND CONDITION STATEMENTS         -> per fund beginning balance / revenues / transfers / expenditures / ending
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export type Tri = [number | null, number | null, number | null];

interface Tok {
	x: number;
	xr: number;
	s: string;
}
export interface Line {
	page: number;
	y: number;
	label: string;
	labelX: number;
	nums: Tok[];
	labelToks: Tok[];
}

const SECTION_TITLES = [
	'DETAILED EXPENDITURES BY PROGRAM',
	'EXPENDITURES BY CATEGORY',
	'DETAIL OF APPROPRIATIONS AND ADJUSTMENTS',
	'FUND CONDITION STATEMENTS',
	'CHANGES IN AUTHORIZED POSITIONS',
	'SUMMARY OF PROJECTS',
	'INFRASTRUCTURE OVERVIEW',
	'DETAILED BUDGET ADJUSTMENTS',
	'PROGRAM DESCRIPTIONS',
	'LEGAL CITATIONS AND AUTHORITY',
	'DEPARTMENT AUTHORITY',
	'PROGRAM AUTHORITY',
	'3-YEAR EXPENDITURES AND POSITIONS',
	'3-YR EXPENDITURES AND POSITIONS',
	'MAJOR PROGRAM CHANGES',
	'DEPARTMENTAL MISSION',
	'SUMMARY OF PROGRAM REQUIREMENTS'
];

const NUM_RE = /^\(?-?\$?\s*-?\s*(\d{1,3}(,\d{3})*|\d+)?(\.\d+)?\s*\)?$/;
function isNumTok(s: string): boolean {
	const t = s.trim();
	if (!t || !/[\d-]/.test(t)) return false;
	return NUM_RE.test(t);
}

/** Parse a money/position token: "$1,234" "-$3,756" "-" "$ -" "(3,178)" "(-)" "1,832.6". */
export function parseNum(s: string): { v: number; nonAdd: boolean } {
	let t = s.trim();
	const nonAdd = t.startsWith('(') && t.endsWith(')');
	if (nonAdd) t = t.slice(1, -1);
	t = t.replace(/\$/g, '').replace(/\s/g, '');
	const neg = t.startsWith('-') && /\d/.test(t);
	t = t.replace(/^-/, '').replace(/,/g, '');
	if (!t || t === '-') return { v: 0, nonAdd };
	const v = Number(t);
	return { v: neg ? -v : v, nonAdd };
}

export async function pdfLines(buf: Buffer): Promise<Line[]> {
	const task = getDocument({ data: new Uint8Array(buf), verbosity: 0 });
	const doc = await task.promise;
	const out: Line[] = [];
	for (let p = 1; p <= doc.numPages; p++) {
		const page = await doc.getPage(p);
		const tc = await page.getTextContent();
		const rows = new Map<number, Tok[]>();
		for (const it of tc.items as { str: string; transform: number[]; width: number }[]) {
			if (!it.str || !it.str.trim()) continue;
			const y = Math.round(it.transform[5]);
			// merge rows within 1pt
			let key = y;
			for (const k of [y - 1, y + 1]) if (rows.has(k)) key = k;
			const r = rows.get(key) ?? [];
			r.push({ x: it.transform[4], xr: it.transform[4] + it.width, s: it.str });
			rows.set(key, r);
		}
		const ys = [...rows.keys()].filter((y) => y > 55 && y < 740).sort((a, b) => b - a);
		// cluster rows closer than normal line pitch (~12pt) into one logical line
		let cluster: { y: number; toks: Tok[] }[] = [];
		const flush = () => {
			if (!cluster.length) return;
			const labelToks: Tok[] = [];
			const nums: Tok[] = [];
			for (const row of cluster) {
				for (const t of row.toks.sort((a, b) => a.x - b.x)) {
					if (t.x >= 250 && isNumTok(t.s)) nums.push(t);
					else labelToks.push(t);
				}
			}
			nums.sort((a, b) => a.x - b.x);
			// Wrapped names put the code (x≈76) on the middle row; move it to the front.
			const ci = labelToks.findIndex((t) => /^\d{4,}$/.test(t.s.trim()) && t.x < 110);
			if (ci > 0 && labelToks[0].x > labelToks[ci].x + 10)
				labelToks.unshift(...labelToks.splice(ci, 1));
			out.push({
				page: p,
				y: cluster[0].y,
				label: labelToks
					.map((t) => t.s.trim())
					.join(' ')
					.replace(/\s+/g, ' ')
					.trim(),
				labelX: labelToks.length ? Math.round(Math.min(...labelToks.map((t) => t.x))) : -1,
				nums,
				labelToks
			});
			cluster = [];
		};
		let prevY: number | null = null;
		for (const y of ys) {
			if (prevY !== null && prevY - y >= 9.5) flush();
			cluster.push({ y, toks: rows.get(y)! });
			prevY = y;
		}
		flush();
	}
	await task.destroy();
	return out;
}

/** Split lines into sections keyed by title (a title may occur more than once). */
export function sections(lines: Line[]): { title: string; lines: Line[] }[] {
	const out: { title: string; lines: Line[] }[] = [];
	let cur: { title: string; lines: Line[] } | null = null;
	for (const l of lines) {
		// titles may carry a footnote marker, e.g. "† DETAILED EXPENDITURES BY PROGRAM"
		const title = l.label
			.replace(/^[^A-Za-z0-9]+\s*/, '')
			.replace(/\s*[^A-Za-z0-9)]+$/, '')
			.toUpperCase();
		if (l.labelX >= 60 && l.labelX < 72 && !l.nums.length && SECTION_TITLES.includes(title)) {
			cur = { title, lines: [] };
			out.push(cur);
			continue;
		}
		cur?.lines.push(l);
	}
	return out;
}

const isYearHeader = (l: Line) =>
	/^(\d{4}-\d{2}\*?\s*)+$/.test(l.label) || (l.nums.length === 0 && /^\d{4}-\d{2}\*/.test(l.label));

function tri(nums: Tok[]): { amt: Tri; nonAdd: boolean; pos?: Tri } | null {
	if (!nums.length) return null;
	const vals = nums.map((t) => parseNum(t.s));
	const nonAdd = vals.some((v) => v.nonAdd);
	if (vals.length >= 6) {
		const a = vals.slice(-3).map((v) => v.v) as Tri;
		const p = vals.slice(-6, -3).map((v) => v.v) as Tri;
		return { amt: a, pos: p, nonAdd };
	}
	if (vals.length === 3) return { amt: vals.map((v) => v.v) as Tri, nonAdd };
	// Fewer than three columns: right-align (rare; DOF prints "-" for zero cells).
	const a: Tri = [null, null, null];
	const off = 3 - vals.length;
	vals.forEach((v, i) => (a[off + i] = v.v));
	return { amt: a, nonAdd };
}

export const addTri = (a: Tri, b: Tri): Tri => a.map((v, i) => (v ?? 0) + (b[i] ?? 0)) as Tri;
export const zeroTri = (): Tri => [0, 0, 0];
export const eqTri = (a: Tri, b: Tri, tol = 2) =>
	a.every((v, i) => Math.abs((v ?? 0) - (b[i] ?? 0)) <= tol);

// ----------------------------------------------------------------------------------
// DETAILED EXPENDITURES BY PROGRAM
// ----------------------------------------------------------------------------------
export interface PdfProgram {
	level: string; // PROGRAM | SUBPROGRAM | ELEMENT | COMPONENT ...
	code: string;
	name: string;
	funds: { fundCd: string; fundName: string; appType: string; amt: Tri }[];
	typeTotals: Record<string, Tri>;
	children: PdfProgram[];
	page: number;
}
export interface PdfProgramsResult {
	programs: PdfProgram[];
	totals: Record<string, Tri>;
	warnings: string[];
}

const LEVELS = ['PROGRAM', 'SUBPROGRAM', 'ELEMENT', 'COMPONENT', 'TASK'];

export function parsePrograms(lines: Line[]): PdfProgramsResult {
	const programs: PdfProgram[] = [];
	const warnings: string[] = [];
	const totals: Record<string, Tri> = {};
	const stack: PdfProgram[] = [];
	let pendingLevel: string | null = null;
	let appType = '';
	let inTotals = false;
	for (const l of lines) {
		if (isYearHeader(l)) continue;
		const lab = l.label;
		const m = lab.match(/^([A-Z]+) REQUIREMENTS$/);
		if (m && !l.nums.length) {
			pendingLevel = m[1];
			continue;
		}
		if (/^TOTALS, EXPENDITURES$/i.test(lab) && !l.nums.length) {
			inTotals = true;
			continue;
		}
		const t = tri(l.nums);
		if (inTotals) {
			if (t) totals[lab.replace(/:$/, '')] = t.amt;
			continue;
		}
		const typ = lab.match(
			/^(State Operations|Local Assistance|Capital Outlay|Unclassified)( - .+)?:$/i
		);
		if (typ && !t) {
			appType = typ[1].replace(/\b\w/g, (c) => c.toUpperCase()).replace(/ (\w)/g, (s) => s);
			continue;
		}
		const code = lab.match(/^(\d{4,})\s+(.+)$/);
		if (pendingLevel && code && !t) {
			const lvl = Math.max(0, LEVELS.indexOf(pendingLevel));
			const node: PdfProgram = {
				level: pendingLevel,
				code: code[1],
				name: code[2].trim(),
				funds: [],
				typeTotals: {},
				children: [],
				page: l.page
			};
			while (stack.length > lvl) stack.pop();
			// Parent must be a code prefix (0150 -> 0150010). DOF prints e.g. "9900100 Administration"
			// as SUBPROGRAM REQUIREMENTS after the last program although it belongs to no program.
			while (stack.length && !node.code.startsWith(stack[stack.length - 1].code)) stack.pop();
			if (stack.length && lvl > 0) stack[stack.length - 1].children.push(node);
			else {
				if (lvl > 0) node.level = 'PROGRAM';
				programs.push(node);
			}
			stack.push(node);
			pendingLevel = null;
			appType = '';
			continue;
		}
		const cur = stack[stack.length - 1];
		if (!cur) continue;
		if (code && t && /^\d{4}$/.test(code[1])) {
			cur.funds.push({
				fundCd: code[1],
				fundName: code[2].trim(),
				appType: appType || 'State Operations',
				amt: t.amt
			});
			continue;
		}
		const tot = lab.match(/^Totals, (.+)$/);
		if (tot && t) {
			cur.typeTotals[tot[1]] = t.amt;
			continue;
		}
		if (t) warnings.push(`programs p${l.page}: unparsed line "${lab}"`);
	}
	// sanity: fund lines vs printed totals
	const walk = (n: PdfProgram) => {
		for (const [typ, tt] of Object.entries(n.typeTotals)) {
			const s = n.funds
				.filter((f) => f.appType.toLowerCase() === typ.toLowerCase())
				.reduce((a, f) => addTri(a, f.amt), zeroTri());
			if (!eqTri(s, tt)) warnings.push(`programs: ${n.code} ${typ} funds ${s} != printed ${tt}`);
		}
		n.children.forEach(walk);
	};
	programs.forEach(walk);
	return { programs, totals, warnings };
}

// ----------------------------------------------------------------------------------
// EXPENDITURES BY CATEGORY
// ----------------------------------------------------------------------------------
export interface PdfCatLine {
	name: string;
	amt: Tri;
	pos?: Tri;
	children: PdfCatLine[];
	isGroup?: boolean;
}
export interface PdfCategoriesResult {
	types: { appType: string; lines: PdfCatLine[]; total?: Tri; totalPositions?: Tri }[];
	warnings: string[];
}

const isUpper = (s: string) => s === s.toUpperCase() && /[A-Z]/.test(s);

export function parseCategories(lines: Line[]): PdfCategoriesResult {
	const types: PdfCategoriesResult['types'] = [];
	const warnings: string[] = [];
	let cur: PdfCategoriesResult['types'][number] | null = null;
	let group: PdfCatLine | null = null;
	let sw: PdfCatLine | null = null; // Salaries & Wages sub-group inside Personal Services
	for (const l of lines) {
		if (isYearHeader(l)) continue;
		const lab = l.label;
		const typ = lab.match(
			/^(\d) (State Operations|Local Assistance|Capital Outlay|Unclassified)\b/i
		);
		if (typ && !l.nums.length) {
			const name = typ[2].replace(/\b\w/g, (c) => c.toUpperCase());
			cur = types.find((t) => t.appType === name) ?? null;
			if (!cur) {
				cur = { appType: name, lines: [] };
				types.push(cur);
				group = null;
				sw = null;
			}
			continue;
		}
		if (!cur) continue;
		const t = tri(l.nums);
		if (/^TOTALS, (POSITIONS AND )?EXPENDITURES/i.test(lab)) {
			if (t) {
				cur.total = t.amt;
				if (t.pos) cur.totalPositions = t.pos;
			}
			group = null;
			sw = null;
			continue;
		}
		if (!t) {
			if (isUpper(lab)) {
				group = { name: lab, amt: zeroTri(), children: [], isGroup: true };
				cur.lines.push(group);
				sw = null;
			}
			continue;
		}
		if (/^Totals?, /i.test(lab) && group) {
			group.amt = t.amt;
			if (t.pos) group.pos = t.pos;
			group = null;
			sw = null;
			continue;
		}
		if (/^Net Totals, Salaries and Wages/i.test(lab) && group) {
			const kids = group.children.splice(0);
			sw = { name: 'Salaries and Wages', amt: t.amt, pos: t.pos, children: kids };
			group.children.push(sw);
			continue;
		}
		if (isUpper(lab)) {
			// category with its own amount (e.g. OPERATING EXPENSES AND EQUIPMENT)
			const c: PdfCatLine = { name: lab, amt: t.amt, pos: t.pos, children: [] };
			cur.lines.push(c);
			group = null;
			sw = null;
			continue;
		}
		const obj: PdfCatLine = { name: lab, amt: t.amt, pos: t.pos, children: [] };
		if (group) group.children.push(obj);
		else cur.lines.push(obj);
	}
	void sw;
	// Categories that have an amount and object children: check
	for (const ty of types) {
		for (const c of ty.lines) {
			if (c.children.length && !c.isGroup) {
				const s = c.children.reduce((a, k) => addTri(a, k.amt), zeroTri());
				if (!eqTri(s, c.amt)) warnings.push(`categories: ${c.name} objects ${s} != ${c.amt}`);
			}
		}
		if (ty.total) {
			const s = ty.lines.reduce((a, k) => addTri(a, k.amt), zeroTri());
			if (!eqTri(s, ty.total, 3))
				warnings.push(`categories: ${ty.appType} lines ${s} != total ${ty.total}`);
		}
	}
	return { types, warnings };
}

// ----------------------------------------------------------------------------------
// DETAIL OF APPROPRIATIONS AND ADJUSTMENTS
// ----------------------------------------------------------------------------------
export interface PdfApprLine {
	kind: 'item' | 'authority' | 'priorYear' | 'adjustment' | 'nonAdd';
	label: string;
	item?: string; // e.g. 0250-001-0001
	amt: Tri;
	base?: Tri;
	adjustments: { label: string; amt: Tri }[];
}
export interface PdfApprFund {
	appType: string;
	fundCd: string;
	fundName: string;
	lines: PdfApprLine[];
	totalsAvailable?: Tri;
	total?: Tri;
	netTotal?: Tri;
}
export interface PdfApprResult {
	funds: PdfApprFund[];
	typeTotals: Record<string, Tri>;
	grandTotal?: Tri;
	warnings: string[];
}

const FUND_REDUCTION_RE =
	/^(Less funding provided by|Offset from|Unexpended balance|Balance available in subsequent years|Less )/i;

export function parseAppropriations(lines: Line[], orgCd: string): PdfApprResult {
	const funds: PdfApprFund[] = [];
	const warnings: string[] = [];
	const typeTotals: Record<string, Tri> = {};
	let grandTotal: Tri | undefined;
	let appType = '';
	let fund: PdfApprFund | null = null;
	let mode: 'appr' | 'pyb' | 'after' = 'appr';
	let last: PdfApprLine | null = null;
	for (let li = 0; li < lines.length; li++) {
		const l = lines[li];
		let nj = li + 1;
		while (
			nj < lines.length &&
			(isYearHeader(lines[nj]) ||
				/^\d (STATE OPERATIONS|LOCAL ASSISTANCE|CAPITAL OUTLAY|UNCLASSIFIED)\b/.test(
					lines[nj].label
				))
		)
			nj++;
		const nextLab = lines[nj]?.label ?? '';
		if (isYearHeader(l)) continue;
		const lab = l.label;
		const typ = lab.match(
			/^(\d) (STATE OPERATIONS|LOCAL ASSISTANCE|CAPITAL OUTLAY|UNCLASSIFIED)\b/
		);
		if (typ) {
			const name = typ[2].toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
			if (name !== appType) {
				appType = name;
				fund = null;
			}
			continue;
		}
		const t = tri(l.nums);
		const fh = lab.match(/^(\d{4}) (.+)$/);
		if (
			fh &&
			!t &&
			(l.labelX >= 78 ||
				/^(APPROPRIATIONS|Prior Year Balances Available:?|TOTALS, EXPENDITURES)$/i.test(nextLab))
		) {
			fund = {
				appType: appType || 'State Operations',
				fundCd: fh[1],
				fundName: fh[2].trim(),
				lines: []
			};
			funds.push(fund);
			mode = 'appr';
			last = null;
			continue;
		}
		if (/^TOTALS, EXPENDITURES, ALL FUNDS/i.test(lab)) {
			if (t) grandTotal = t.amt;
			continue;
		}
		const tt = lab.match(/^Total Expenditures, All Funds,? \((.+)\)$/i);
		if (tt) {
			if (t) typeTotals[tt[1]] = t.amt;
			fund = null;
			continue;
		}
		if (!fund) continue;
		if (/^APPROPRIATIONS$/i.test(lab)) {
			mode = 'appr';
			continue;
		}
		if (/^Prior Year Balances Available:?$/i.test(lab)) {
			mode = 'pyb';
			continue;
		}
		if (!t) continue;
		if (/^Totals Available$/i.test(lab)) {
			fund.totalsAvailable = t.amt;
			mode = 'after';
			continue;
		}
		if (/^NET TOTALS, EXPENDITURES$/i.test(lab)) {
			fund.netTotal = t.amt;
			continue;
		}
		if (/^TOTALS, EXPENDITURES$/i.test(lab)) {
			fund.total = t.amt;
			mode = 'after';
			continue;
		}
		if (t.nonAdd) {
			fund.lines.push({ kind: 'nonAdd', label: lab, amt: t.amt, adjustments: [] });
			last = null;
			continue;
		}
		if (FUND_REDUCTION_RE.test(lab)) {
			fund.lines.push({ kind: 'adjustment', label: lab, amt: t.amt, adjustments: [] });
			last = null;
			continue;
		}
		const indented = l.labelX >= 80;
		if (mode === 'pyb') {
			fund.lines.push({ kind: 'priorYear', label: lab, amt: t.amt, adjustments: [] });
			last = null;
			continue;
		}
		if (indented && last && mode === 'appr') {
			last.adjustments.push({ label: lab, amt: t.amt });
			last.amt = addTri(last.amt, t.amt);
			continue;
		}
		const im = lab.match(/^(\d{3}) Budget Act appropriation/i);
		const line: PdfApprLine = {
			kind: im ? 'item' : 'authority',
			label: lab,
			item: im ? `${orgCd}-${im[1]}-${fund.fundCd}` : undefined,
			amt: t.amt,
			base: t.amt,
			adjustments: []
		};
		fund.lines.push(line);
		last = line;
	}
	for (const f of funds) {
		const expect = f.netTotal ?? f.total;
		if (!expect) continue;
		const s = f.lines
			.filter((x) => x.kind !== 'nonAdd')
			.reduce((a, x) => addTri(a, x.amt), zeroTri());
		if (!eqTri(s, expect, 3))
			warnings.push(`appropriations: ${f.appType} ${f.fundCd} lines ${s} != printed ${expect}`);
	}
	return { funds, typeTotals, grandTotal, warnings };
}

// ----------------------------------------------------------------------------------
// FUND CONDITION STATEMENTS
// ----------------------------------------------------------------------------------
export interface PdfFcs {
	fundCd: string;
	fundName: string;
	fundClass?: string;
	beginningBalance?: Tri;
	adjustedBeginningBalance?: Tri;
	revenues: Tri;
	revenueLines: { code?: string; label: string; amt: Tri }[];
	totalRevenuesTransfers?: Tri;
	totalResources?: Tri;
	expenditures?: Tri;
	fundBalance?: Tri;
	page: number;
}

export function parseFcs(lines: Line[]): { funds: PdfFcs[]; warnings: string[] } {
	const funds: PdfFcs[] = [];
	const warnings: string[] = [];
	let cur: PdfFcs | null = null;
	let pendingClass: string | undefined;
	let inRev = false;
	for (let li = 0; li < lines.length; li++) {
		const l = lines[li];
		let nj = li + 1;
		while (nj < lines.length && isYearHeader(lines[nj])) nj++;
		const nextLab = lines[nj]?.label ?? '';
		if (isYearHeader(l)) continue;
		const lab = l.label;
		const t = tri(l.nums);
		if (/^[A-Z]$/.test(lab) && !t) {
			pendingClass = lab;
			continue;
		}
		const fh = lab.match(/^(?:([A-Z]) )?(\d{4}) (.+)$/);
		if (fh && !t && (l.labelX >= 78 || /^BEGINNING BALANCE$/i.test(nextLab))) {
			cur = {
				fundCd: fh[2],
				fundName: fh[3].trim(),
				fundClass: fh[1] ?? pendingClass,
				revenues: zeroTri(),
				revenueLines: [],
				page: l.page
			};
			funds.push(cur);
			pendingClass = undefined;
			inRev = false;
			continue;
		}
		if (!cur) continue;
		if (/^Revenues:$/i.test(lab)) {
			inRev = true;
			continue;
		}
		if (/^Transfers and Other Adjustments/i.test(lab) || /^Total Revenues/i.test(lab))
			inRev = false;
		if (!t) continue;
		if (/^BEGINNING BALANCE$/i.test(lab)) cur.beginningBalance = t.amt;
		else if (/^Adjusted Beginning Balance$/i.test(lab)) cur.adjustedBeginningBalance = t.amt;
		else if (/^Total Revenues, Transfers, and Other Adjustments$/i.test(lab))
			cur.totalRevenuesTransfers = t.amt;
		else if (/^Total Resources$/i.test(lab)) cur.totalResources = t.amt;
		else if (/^Total Expenditures and Expenditure Adjustments$/i.test(lab))
			cur.expenditures = t.amt;
		else if (/^FUND BALANCE$/i.test(lab)) cur.fundBalance = t.amt;
		else if (inRev) {
			const m = lab.match(/^(\d{7}) (.+)$/);
			cur.revenueLines.push({ code: m?.[1], label: m ? m[2] : lab, amt: t.amt });
			cur.revenues = addTri(cur.revenues, t.amt);
		}
	}
	return { funds, warnings };
}

export interface ParsedDeptPdf {
	programs?: PdfProgramsResult;
	categories?: PdfCategoriesResult;
	appropriations?: PdfApprResult;
	fcs?: { funds: PdfFcs[]; warnings: string[] };
	sectionTitles: string[];
	pages: number;
}

export async function parseDeptPdf(buf: Buffer, orgCd: string): Promise<ParsedDeptPdf> {
	const lines = await pdfLines(buf);
	const secs = sections(lines);
	const res: ParsedDeptPdf = {
		sectionTitles: secs.map((s) => s.title),
		pages: lines.length ? lines[lines.length - 1].page : 0
	};
	const join = (title: string) => secs.filter((s) => s.title === title).flatMap((s) => s.lines);
	const prog = join('DETAILED EXPENDITURES BY PROGRAM');
	if (prog.length) res.programs = parsePrograms(prog);
	const cat = join('EXPENDITURES BY CATEGORY');
	if (cat.length) res.categories = parseCategories(cat);
	const appr = join('DETAIL OF APPROPRIATIONS AND ADJUSTMENTS');
	if (appr.length) res.appropriations = parseAppropriations(appr, orgCd);
	const fcs = join('FUND CONDITION STATEMENTS');
	if (fcs.length) res.fcs = parseFcs(fcs);
	return res;
}
