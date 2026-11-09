/**
 * Parsers for DOF Summary Schedules (8, 9, 10) and departmental Fund Condition
 * Statement (FCS) PDFs, as published on ebudget.ca.gov. All amounts are in thousands.
 */
import { type Row, splitRow, isUpper, titleCase, slugify } from './rev-pdf.ts';

export type Tri = { py: number; cy: number; by: number };
const tri = (a: number[], i0: number, step: number): Tri => ({
	py: a[i0],
	cy: a[i0 + step],
	by: a[i0 + 2 * step]
});

/** Drop page headers (everything at/above the column-header row) and footers. */
function bodyRows(rows: Row[], headerMarker: (r: Row) => boolean): Row[] {
	const out: Row[] = [];
	const pages = [...new Set(rows.map((r) => r.page))];
	for (const p of pages) {
		const pr = rows.filter((r) => r.page === p);
		const hdr = pr.find(headerMarker);
		const foot = pr.find((r) => r.toks.some((t) => /^Page\b/.test(t.s)));
		const hdrY = hdr ? hdr.y : Infinity;
		const footY = foot ? foot.y + 1 : -Infinity;
		for (const r of pr) {
			if (r.y >= hdrY - 1 || r.y <= footY) continue;
			if (
				r.toks.every((t) =>
					/^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/.test(
						t.s
					)
				)
			)
				continue;
			out.push(r);
		}
	}
	return out;
}

interface Ev {
	type: 'code' | 'total' | 'line' | 'text';
	label: string;
	vals: number[];
	page: number;
	y: number;
}

/**
 * Turn rows into events, merging wrapped label lines into the preceding event.
 * A value-less text row is a continuation when it sits within `gap` points of the
 * previous row on the same page, or (across a page break) when it isn't all-caps.
 */
function events(
	rows: Row[],
	minX: number,
	nVals: number,
	codeRe: RegExp,
	warn: (m: string) => void,
	gap = 12.5
) {
	const evs: Ev[] = [];
	let prev: Row | null = null;
	for (const r of rows) {
		const { label, vals } = splitRow(r, minX);
		if (!label && !vals.length) continue;
		const last = evs[evs.length - 1];
		if (!vals.length) {
			const samePage = prev && prev.page === r.page;
			const cont = last && ((samePage && prev!.y - r.y <= gap) || (!samePage && !isUpper(label)));
			if (cont) last.label += ' ' + label;
			else evs.push({ type: 'text', label, vals: [], page: r.page, y: r.y });
		} else if (!label && last && !last.vals.length) {
			last.vals = vals; // values printed on a separate visual line
		} else {
			const type = codeRe.test(label) ? 'code' : /^totals?\b/i.test(label) ? 'total' : 'line';
			if (vals.length !== nVals)
				warn(
					`p${r.page} y${Math.round(r.y)}: expected ${nVals} values, got ${vals.length}: "${label}"`
				);
			evs.push({ type, label, vals, page: r.page, y: r.y });
		}
		prev = r;
	}
	for (const e of evs) e.label = e.label.replace(/\s+/g, ' ').trim();
	return evs;
}

const norm = (s: string) =>
	s
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, ' ')
		.trim();

// ───────────────────────────── Schedule 8 ─────────────────────────────

export interface S8Source {
	code: string;
	name: string;
	gf: Tri;
	sf: Tri;
	total: Tri;
}
export interface S8Group {
	slug: string;
	name: string;
	sources: S8Source[];
	/** official subtotal row */
	total?: { gf: Tri; sf: Tri; total: Tri };
	subgroups: S8Group[];
}
export interface Schedule8 {
	categories: S8Group[]; // major, minor, transfers
	totalRevenues?: { gf: Tri; sf: Tri; total: Tri };
	totalAll?: { gf: Tri; sf: Tri; total: Tri };
	title: string;
}

const s8vals = (v: number[]) => ({ gf: tri(v, 0, 3), sf: tri(v, 1, 3), total: tri(v, 2, 3) });

export function parseSchedule8(rows: Row[], warn: (m: string) => void): Schedule8 {
	const title = rows
		.filter((r) => r.page === 1)
		.slice(0, 3)
		.map((r) => r.toks.map((t) => t.s).join(' '))
		.join(' / ');
	const body = bodyRows(rows, (r) => r.toks.some((t) => t.s === 'Sources'));
	const evs = events(body, 170, 9, /^\d{7}\s*-/, warn);
	const cats: S8Group[] = [];
	let cat: S8Group | null = null;
	let sub: S8Group | null = null;
	const out: Schedule8 = { categories: cats, title };
	for (const e of evs) {
		if (e.type === 'text') {
			const name = e.label;
			const n = norm(name);
			const top = /^MAJOR TAXES/.test(n)
				? 'major'
				: /^MINOR REVENUES/.test(n)
					? 'minor'
					: /^TRANSFERS AND LOANS/.test(n)
						? 'transfers'
						: null;
			if (top) {
				cat = { slug: top, name: titleCase(name), sources: [], subgroups: [] };
				cats.push(cat);
				sub = null;
			} else if (cat) {
				sub = { slug: slugify(name), name: titleCase(name), sources: [], subgroups: [] };
				cat.subgroups.push(sub);
			} else warn(`schedule 8: stray text "${name}"`);
			continue;
		}
		if (e.vals.length !== 9) continue;
		const v = s8vals(e.vals);
		if (e.type === 'code') {
			const m = e.label.match(/^(\d{7})\s*-\s*(.*)$/)!;
			const src: S8Source = { code: m[1], name: m[2].trim(), ...v };
			(sub ?? cat)?.sources.push(src);
		} else if (e.type === 'total') {
			const what = norm(e.label.replace(/^totals?,?\s*/i, ''));
			if (what === 'REVENUES') out.totalRevenues = v;
			else if (/^REVENUES TRANSFERS AND LOANS/.test(what)) out.totalAll = v;
			else if (sub && norm(sub.name) === what) {
				sub.total = v;
				sub = null;
			} else if (cat && norm(cat.name) === what) {
				cat.total = v;
				sub = null;
			} else warn(`schedule 8: unmatched total "${e.label}"`);
		} else {
			// uncoded line (e.g. "Loans", "Revenue Transfers") — keep as a source with a slug code
			const src: S8Source = { code: slugify(e.label), name: e.label, ...v };
			(sub ?? cat)?.sources.push(src);
		}
	}
	return out;
}

// ───────────────────────────── Schedule 10 ────────────────────────────

export interface S10Fund {
	code: string;
	name: string;
	section: string; // "general" | "special" | other section slug
	begin: Tri;
	revenues: Tri;
	expenditures: Tri;
	end: Tri;
}
export interface Schedule10 {
	funds: S10Fund[];
	totals: Record<string, Omit<S10Fund, 'code' | 'name' | 'section'>>;
}

export function parseSchedule10(rows: Row[], warn: (m: string) => void): Schedule10 {
	const body = bodyRows(rows, (r) => r.toks.some((t) => /^\d{4}-\d{2}$/.test(t.s)));
	const evs = events(body, 160, 10, /^\d{4}\s*-/, warn);
	const funds: S10Fund[] = [];
	const totals: Schedule10['totals'] = {};
	let section = 'special';
	const fromVals = (v: number[]) => ({
		begin: tri(v, 0, 3),
		revenues: tri(v, 1, 3),
		expenditures: tri(v, 2, 3),
		end: { py: v[3], cy: v[6], by: v[9] }
	});
	for (const e of evs) {
		if (e.type === 'text') {
			section = /SPECIAL FUNDS/i.test(e.label) ? 'special' : slugify(e.label);
			continue;
		}
		if (e.vals.length !== 10) continue;
		if (e.type === 'code') {
			const m = e.label.match(/^(\d{4})\s*-\s*(.*)$/)!;
			funds.push({ code: m[1], name: m[2].trim(), section, ...fromVals(e.vals) });
		} else if (/^GENERAL FUND$/i.test(e.label)) {
			funds.push({ code: '0001', name: 'General Fund', section: 'general', ...fromVals(e.vals) });
		} else {
			totals[slugify(e.label.replace(/^totals?,?\s*/i, ''))] = fromVals(e.vals);
		}
	}
	return { funds, totals };
}

// ───────────────────────────── Schedule 9 ─────────────────────────────

export interface S9Amounts {
	gf: Tri;
	sf: Tri;
	bond: Tri;
	total: Tri;
	federal: Tri;
}
/** Schedule 9 character of expenditure rows printed under each department. */
export type S9Character = 'State Operations' | 'Local Assistance' | 'Capital Outlay';
export const S9_CHARACTERS: readonly S9Character[] = [
	'State Operations',
	'Local Assistance',
	'Capital Outlay'
];
export interface S9Dept {
	code: string;
	name: string;
	totals: S9Amounts;
	/** Amounts by character of expenditure (the rows above the department's "Totals," line). */
	byCharacter: Partial<Record<S9Character, S9Amounts>>;
	/** PDF page of the department's "Totals," line. */
	page: number;
}
export interface S9Agency {
	name: string;
	deptCodes: string[];
	/** "Totals,{code}-{name}" rows (one per department/statewide item) */
	depts: S9Dept[];
	totals?: S9Amounts;
}
export interface Schedule9 {
	agencies: S9Agency[];
	grandTotal?: S9Amounts;
}

const s9vals = (v: number[]): S9Amounts => ({
	gf: tri(v, 0, 5),
	sf: tri(v, 1, 5),
	bond: tri(v, 2, 5),
	total: tri(v, 3, 5),
	federal: tri(v, 4, 5)
});

export function parseSchedule9(rows: Row[], warn: (m: string) => void): Schedule9 {
	const body = bodyRows(
		rows,
		(r) => r.toks.some((t) => /^Fund$/.test(t.s)) && r.toks.some((t) => /^Total$/.test(t.s))
	);
	const agencies: S9Agency[] = [];
	const out: Schedule9 = { agencies };
	let cur: S9Agency | null = null;
	// character rows seen since the last department header, attached at its "Totals," line
	let chars: S9Dept['byCharacter'] = {};
	for (const r of body) {
		const { label, vals } = splitRow(r, 200);
		const lead = r.toks[0];
		if (!label) continue;
		if (vals.length && (S9_CHARACTERS as readonly string[]).includes(label)) {
			if (vals.length !== 15) warn(`schedule 9: ${vals.length} values for "${label}"`);
			else chars[label as S9Character] = s9vals(vals);
			continue;
		}
		if (
			!vals.length &&
			isUpper(label) &&
			lead.x < 60 &&
			!/^\d{4}-/.test(label) &&
			!/^TOTALS?\b/.test(label)
		) {
			cur = { name: label, deptCodes: [], depts: [] };
			agencies.push(cur);
			chars = {};
			continue;
		}
		const dm = label.match(/^(\d{4})-/);
		if (dm && cur && !vals.length) cur.deptCodes.push(dm[1]);
		const tm = label.match(/^Totals,\s*(\d{4})-\s*(.*)$/);
		if (tm && cur && vals.length) {
			if (vals.length !== 15) warn(`schedule 9: ${vals.length} values for "${label}"`);
			else
				cur.depts.push({
					code: tm[1],
					name: tm[2].trim(),
					totals: s9vals(vals),
					byCharacter: chars,
					page: r.page
				});
		}
		// any header or totals line closes the current block of character rows
		chars = {};
		if (/^TOTALS,/.test(label) && vals.length) {
			if (vals.length !== 15) warn(`schedule 9: ${vals.length} values for "${label}"`);
			const what = norm(label.replace(/^TOTALS,\s*/, ''));
			const ag = agencies.find((a) => norm(a.name) === what);
			if (ag) ag.totals = s9vals(vals);
			else warn(`schedule 9: unmatched agency total "${label}"`);
		} else if (/^GRAND TOTAL/.test(label) && vals.length === 15) out.grandTotal = s9vals(vals);
	}
	return out;
}

// ─────────────────────── Fund Condition Statements ───────────────────────

export interface FcsFund {
	code: string;
	name: string;
	revenues: { code: string; name: string; amounts: Tri }[];
	hasBalance?: boolean;
	/** "Total Revenues, Transfers, and Other Adjustments" */
	totalRevTransfers?: Tri;
}

/** Parse a departmental "{orgCd}FCS.pdf" into funds with their itemized revenue lines. */
export function parseFcs(rows: Row[], warn: (m: string) => void): FcsFund[] {
	const funds: FcsFund[] = [];
	let fund: FcsFund | null = null;
	let state: 'none' | 'rev' | 'xfer' | 'total' = 'none';
	let pending: FcsFund['revenues'][number] | null = null;
	let pendingVals: number[] | null = null;
	let cols: number[] = []; // right edges of the year column headers on the current page
	let page = 0;
	let hdrY = Infinity;
	const assign = (r: Row): Tri | null => {
		const { valToks } = splitRow(r, 380);
		if (!valToks.length) return null;
		const t: Tri = { py: 0, cy: 0, by: 0 };
		const keys = ['py', 'cy', 'by'] as const;
		for (const tok of valToks) {
			let best = 0;
			for (let i = 1; i < cols.length; i++)
				if (Math.abs(cols[i] - tok.r) < Math.abs(cols[best] - tok.r)) best = i;
			const v = splitRow({ page: r.page, y: r.y, toks: [tok] }, 0).vals[0] ?? 0;
			t[keys[Math.min(best, 2)]] += v;
		}
		return t;
	};
	for (const r of rows) {
		if (r.page !== page) {
			page = r.page;
			const hdr = rows.find(
				(x) => x.page === page && x.toks.filter((t) => /^\d{4}-\d{2}\*?$/.test(t.s)).length >= 3
			);
			if (hdr) cols = hdr.toks.filter((t) => /^\d{4}-\d{2}\*?$/.test(t.s)).map((t) => t.r);
			hdrY = hdr ? hdr.y : Infinity;
		}
		if (cols.length < 3 || r.y >= hdrY - 1) continue; // skip page/org headers
		const { label, vals } = splitRow(r, 380);
		// fund header: "0041" + "Aeronautics Account, ..." as two separate tokens, no values
		const t0 = r.toks[0];
		if (!vals.length && r.toks.length >= 2 && /^\d{4}$/.test(t0.s) && !/^\d/.test(r.toks[1].s)) {
			fund = {
				code: t0.s,
				name: r.toks
					.slice(1)
					.map((t) => t.s)
					.join(' '),
				revenues: []
			};
			funds.push(fund);
			state = 'none';
			pending = null;
			continue;
		}
		if (!fund) continue;
		if (/^BEGINNING BALANCE/i.test(label)) fund.hasBalance = true;
		if (/^REVENUES, TRANSFERS/i.test(label)) {
			state = 'rev';
			continue;
		}
		if (/^Transfers and Other Adjustments/i.test(label)) {
			state = 'xfer';
			pending = null;
			continue;
		}
		if (/^Total Revenues, Transfers/i.test(label)) {
			const v = assign(r);
			if (v) fund.totalRevTransfers = v;
			state = v ? 'none' : 'total';
			pending = null;
			continue;
		}
		if (state === 'total') {
			const v = assign(r);
			if (v && !label) fund.totalRevTransfers = v;
			state = 'none';
			continue;
		}
		if (state !== 'rev') continue;
		const m = label.match(/^(4\d{6})\s+(.*)$/);
		if (m) {
			const v = assign(r);
			const item = { code: m[1], name: m[2].trim(), amounts: v ?? { py: 0, cy: 0, by: 0 } };
			fund.revenues.push(item);
			pending = v ? null : item;
			pendingVals = null;
		} else if (pending && label && !/^Revenues:?$/i.test(label)) {
			pending.name += ' ' + label;
			const v = assign(r);
			if (v) {
				pending.amounts = v;
				pending = null;
			}
		} else if (pending && !label) {
			const v = assign(r);
			if (v) {
				pending.amounts = v;
				pending = null;
			}
		}
	}
	void pendingVals;
	const real = funds.filter((f) => f.hasBalance);
	for (const f of real)
		if (!f.totalRevTransfers && f.revenues.length)
			warn(`FCS ${f.code}: no "Total Revenues, Transfers" row found`);
	return real;
}
