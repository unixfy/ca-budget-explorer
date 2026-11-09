/**
 * SOURCES CATALOG: a tree of every data source behind (and around) one dataset.
 *
 *   node scripts/etl/sources-catalog.ts --fy 2026-27 --pit e [--out static/data] [--raw data-raw] [--no-pages]
 *
 * Run after the other ETLs. Reads, never fetches:
 *   - static/data/{fy}/{pit}/*.json (+ departments/*.json): every `sources` array (SourceRef) is
 *     matched to a catalog node, giving "how many nodes/figures cite this source", per data file;
 *   - data-raw/{fy}/{pit}/** and data-raw/{fy}/{p,m}/rev/** (what the ETLs actually downloaded):
 *     file counts, bytes and PDF page counts (pdfjs; --no-pages skips page counting);
 *   - data-raw/{fy}/{pit}/exp-validation.json and reconciliation.json for pain-point examples;
 *   - scripts/etl/reconciliation.ts (text only) to count hand-transcribed chart figures;
 *   - scripts/etl/sources-catalog.static.ts: hand-curated sources the explorer does not use.
 *
 * Output: static/data/{fy}/{pit}/sources-catalog.json (see src/lib/data/sources-catalog.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import type {
	CatalogFormat,
	CatalogNode,
	CatalogPainPoint,
	CatalogStats,
	Product,
	SourcesCatalog
} from '../../src/lib/data/sources-catalog.ts';
import type { SourceRef } from '../../src/lib/data/schema.ts';
import { externalPublishers } from './sources-catalog.static.ts';

const { values: args } = parseArgs({
	options: {
		fy: { type: 'string', default: '2026-27' },
		pit: { type: 'string', default: 'e' },
		out: { type: 'string', default: 'static/data' },
		raw: { type: 'string', default: 'data-raw' },
		'no-pages': { type: 'boolean', default: false }
	}
});
const FY = args.fy!;
const PIT = args.pit as 'p' | 'm' | 'e';
const OUT_DIR = path.join(args.out!, FY, PIT);
const RAW = args.raw!;
const EB = 'https://ebudget.ca.gov';
const log = (m: string) => console.log('[sources] ' + m);

if (!fs.existsSync(path.join(OUT_DIR, 'meta.json'))) {
	console.error(`sources-catalog: ${OUT_DIR}/meta.json not found — run the other ETLs first.`);
	process.exit(1);
}
const readJson = <T>(p: string): T | null => {
	try {
		return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
	} catch {
		return null;
	}
};

// ───────────────────────────── publications ─────────────────────────────

interface AppInfo {
	publication: string;
	publicationTitle?: string;
	publicationDate: string;
	previousYear: string;
	currentYear: string;
	budgetYear: string;
}
const PITS = (['p', 'm', 'e'] as const).filter((_, i, a) => i <= a.indexOf(PIT));
const PIT_NAME = { p: "Governor's Budget", m: 'May Revision', e: 'Enacted Budget' } as const;
/** PDF folder per publication, mirrors ebudget's pdfRootDir ("" for the Governor's Budget). */
const PDF_FOLDER: Record<string, string> = { p: '', m: 'Revised', e: 'Enacted' };
const appInfo: Partial<Record<'p' | 'm' | 'e', AppInfo>> = {};
for (const p of PITS) {
	const ai =
		readJson<AppInfo>(path.join(RAW, FY, p, 'api', 'appInfo.json')) ??
		readJson<AppInfo>(path.join(RAW, FY, p, 'rev', 'api', 'appInfo.json'));
	if (ai) {
		appInfo[p] = ai;
		if (p !== 'p' && ai.publication) PDF_FOLDER[p] = ai.publication;
	}
}
const folderPit = new Map(Object.entries(PDF_FOLDER).map(([p, f]) => [f, p]));
const meta = readJson<{
	publication: string;
	publicationDate: string;
	years: { py: string; cy: string; by: string };
}>(path.join(OUT_DIR, 'meta.json'))!;
const Y = meta.years;

// ───────────────────────────── URL → catalog node id ─────────────────────────────

/** Strip per-entity codes from an API path: "rwaCntl/support/0250" -> "rwaCntl/support/{org}". */
function apiFamily(p: string): string {
	const segs = p.replace(/\.json$/, '').split('/');
	if (segs[0] === 'statistics') {
		if (segs[1] === 'revised')
			return segs[2] ? 'statistics/revised/{agency}' : 'statistics/revised';
		return segs[1] ? 'statistics/{agency}' : 'statistics';
	}
	if (segs[0] === 'org') return segs[1] === 'deptIndex' ? 'org/deptIndex' : 'org/{org}';
	if (segs[0] === 'rwaCntl') return `rwaCntl/${segs[1]}/{org}`;
	if (segs[0] === 'fcsCntl') return segs[1] === 'fundIndex' ? 'fcsCntl/fundIndex' : 'fcsCntl/{org}';
	if (segs.length > 1 && /^\d{4}$/.test(segs[segs.length - 1]))
		return [...segs.slice(0, -1), '{org}'].join('/');
	return segs.join('/');
}
const slug = (s: string) => s.replace(/[{}]/g, '').replace(/[^A-Za-z0-9]+/g, '-');

/** Catalog node id for an official URL, or null when it is not an ebudget source. */
function nodeIdForUrl(url: string): string | null {
	const u = url.replace(/#.*$/, '').replace(/\?.*$/, '');
	if (!u.startsWith(EB)) return null;
	const rest = u.slice(EB.length);
	if (rest === '/api/home/getLink') return 'eb/site/getLink';
	let m = rest.match(/^\/api\/[a-z]+\/([pme])\/[\d-]+\/(.+)$/);
	if (m) return `eb/${m[1]}/api/${slug(apiFamily(m[2]))}`;
	m = rest.match(/^\/[\d-]+\/pdf\/(?:([A-Za-z]+)\/)?(GovernorsBudget|BudgetSummary)\/?(.*)$/);
	if (m) {
		const pit = folderPit.get(m[1] ?? '') ?? (m[1] ? null : 'p');
		if (!pit) return null;
		const file = m[3];
		if (m[2] === 'GovernorsBudget') {
			const d = file.match(/^(\d{4})\/(\d{4})(FCS)?\.pdf$/);
			if (!d) return `eb/${pit}/dept`;
			return d[3] ? `eb/${pit}/fcs/${d[1]}` : `eb/${pit}/dept/${d[1]}`;
		}
		const s = file.match(/^BS_SCH(\w+)\.pdf$/);
		if (s) return `eb/${pit}/sch/${s[1]}`;
		const c = file.match(/^(\w[\w-]*)\.pdf$/);
		if (c) return `eb/${pit}/chap/${c[1]}`;
		return `eb/${pit}/sch`;
	}
	m = rest.match(/^\/[a-z]+\/([pme])\/[\d-]+\/(BudgetDetail|BudgetSummary)/);
	if (m) return `eb/${m[1]}/web`;
	if (rest.startsWith('/reference/')) return 'eb/site/ref';
	return null;
}

// ───────────────────────────── citations in our data files ─────────────────────────────

const backs = new Map<string, Partial<Record<Product, number>>>();
const unmatched = new Map<string, number>();
const productNodes: Partial<Record<Product, number>> = {};
let citations = 0;
const bump = (id: string, prod: Product, n = 1) => {
	const b = backs.get(id) ?? {};
	b[prod] = (b[prod] ?? 0) + n;
	backs.set(id, b);
};
function scanSources(o: unknown, prod: Product) {
	if (Array.isArray(o)) {
		for (const x of o) scanSources(x, prod);
		return;
	}
	if (!o || typeof o !== 'object') return;
	const rec = o as Record<string, unknown>;
	for (const [k, v] of Object.entries(rec)) {
		if (k === 'sources' && Array.isArray(v)) {
			for (const s of v as SourceRef[]) {
				if (!s?.url) continue;
				citations++;
				const id = nodeIdForUrl(s.url);
				if (id) bump(id, prod);
				else unmatched.set(s.url, (unmatched.get(s.url) ?? 0) + 1);
			}
		} else if ((k === 'source' || k === 'ref') && v && typeof v === 'object' && 'url' in v) {
			scanSources({ sources: [v] }, prod);
		} else scanSources(v, prod);
	}
}
const countNodes = (o: unknown): number => {
	if (!o || typeof o !== 'object') return 0;
	const n = o as { children?: unknown[]; excludedChildren?: unknown[] };
	return (
		1 +
		(n.children ?? []).reduce<number>((a, c) => a + countNodes(c), 0) +
		(n.excludedChildren ?? []).reduce<number>((a, c) => a + countNodes(c), 0)
	);
};
const PRODUCTS: { id: Product; label: string; file: string }[] = [
	{ id: 'meta', label: 'Overview & totals', file: 'meta.json' },
	{ id: 'expenditures', label: 'Spending tree', file: 'expenditures.json' },
	{ id: 'departments', label: 'Department detail', file: 'departments/*.json' },
	{ id: 'funds', label: 'Funds', file: 'funds.json' },
	{ id: 'revenues', label: 'Revenue tree', file: 'revenues.json' },
	{ id: 'flows', label: 'Money flows', file: 'flows.json' },
	{ id: 'reconciliation', label: 'Reconciliation', file: 'reconciliation.json' }
];
for (const p of PRODUCTS) {
	if (p.id === 'departments') {
		const dir = path.join(OUT_DIR, 'departments');
		let n = 0;
		for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
			const d = readJson<{ programs?: unknown; categories?: unknown; funding?: unknown }>(
				path.join(dir, f)
			);
			if (!d) continue;
			scanSources(d, 'departments');
			n += countNodes(d.programs) + countNodes(d.categories) + countNodes(d.funding);
		}
		productNodes.departments = n;
		continue;
	}
	const d = readJson<unknown>(path.join(OUT_DIR, p.file));
	if (!d) continue;
	scanSources(d, p.id);
	if (p.id === 'funds') productNodes.funds = Object.keys(d as object).length;
	else if (p.id === 'flows') productNodes.flows = ((d as { nodes?: unknown[] }).nodes ?? []).length;
	else if (p.id === 'expenditures' || p.id === 'revenues') productNodes[p.id] = countNodes(d);
}
// Per-fund revenue nodes ("rev/special/major/{code}/{fund}") come from the departmental
// Fund Condition Statements, but only the tree root cites them: count them as backed by the FCS series.
{
	const rev = readJson<unknown>(path.join(OUT_DIR, 'revenues.json'));
	let n = 0;
	const walk = (x: unknown) => {
		const node = x as { id?: string; children?: unknown[] };
		if (node?.id && /\/\d{7}\/\d{4}$/.test(node.id)) n++;
		for (const c of node?.children ?? []) walk(c);
	};
	if (rev) walk(rev);
	if (n) bump(`eb/${PIT}/fcs`, 'revenues', n);
}
log(`${citations} citations; ${unmatched.size} non-ebudget urls`);

// ───────────────────────────── raw downloads ─────────────────────────────

interface Vol {
	files: number;
	bytes: number;
	pages: number;
	pdfs: string[];
}
const vols = new Map<string, Vol>();
const addVol = (id: string, file: string, bytes: number) => {
	const v = vols.get(id) ?? { files: 0, bytes: 0, pages: 0, pdfs: [] };
	v.files++;
	v.bytes += bytes;
	if (file.endsWith('.pdf')) v.pdfs.push(file);
	vols.set(id, v);
};
const walkFiles = (dir: string): string[] =>
	fs.existsSync(dir)
		? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
				const p = path.join(dir, e.name);
				return e.isDirectory() ? walkFiles(p) : [p];
			})
		: [];
/** Turn a cache path back into the official URL it was downloaded from. */
function urlForRaw(rel: string, pit: string): string | null {
	const r = rel.split(path.sep).join('/');
	let m = r.match(/^(?:rev\/)?api\/(.+)\.json$/);
	if (m) return `${EB}/api/budget/${pit}/${FY}/${m[1]}`;
	m = r.match(/^rev\/pdf\/[\d-]+\/pdf\/(.+)$/) ?? r.match(/^pdf\/(.+)$/);
	if (m) return `${EB}/${FY}/pdf/${m[1]}`;
	if (/(^|\/)getLink\.json$/.test(r)) return `${EB}/api/home/getLink`;
	return null;
}
let rawFiles = 0;
let rawBytes = 0;
const rawUnmatched: string[] = [];
const rawSeen = new Set<string>();
for (const p of PITS) {
	const base = path.join(RAW, FY, p);
	// the dataset's own publication: everything; earlier publications: only what the revenue /
	// reconciliation ETLs pull in for this dataset (their rev/ cache).
	const roots = p === PIT ? [base] : [path.join(base, 'rev')];
	for (const root of roots)
		for (const file of walkFiles(root)) {
			if (/\.(404|missing|tmp)$/.test(file) || file.endsWith('exp-validation.json')) continue;
			const rel = path.relative(base, file);
			const url = urlForRaw(rel, p);
			const id = url ? nodeIdForUrl(url) : null;
			if (!id) {
				rawUnmatched.push(file);
				continue;
			}
			// the same document cached by two ETLs counts once
			const key = `${id}|${url}`;
			const size = fs.statSync(file).size;
			if (rawSeen.has(key)) continue;
			rawSeen.add(key);
			rawFiles++;
			rawBytes += size;
			addVol(id, file, size);
		}
}
{
	const gl = path.join(RAW, 'getLink.json');
	if (fs.existsSync(gl) && !rawSeen.has(`eb/site/getLink|${EB}/api/home/getLink`)) {
		rawFiles++;
		rawBytes += fs.statSync(gl).size;
		addVol('eb/site/getLink', gl, fs.statSync(gl).size);
	}
}
if (rawUnmatched.length)
	log(`${rawUnmatched.length} raw files not catalogued, e.g. ${rawUnmatched[0]}`);
log(`${rawFiles} raw files, ${(rawBytes / 1e6).toFixed(1)} MB`);

// PDF page counts
let pdfPages = 0;
if (!args['no-pages']) {
	const require = createRequire(import.meta.url);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdfjs-dist legacy build is untyped here
	const pdfjs: any = await import(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
	for (const v of vols.values())
		for (const f of v.pdfs) {
			try {
				const doc = await pdfjs.getDocument({
					data: new Uint8Array(fs.readFileSync(f)),
					verbosity: 0,
					isEvalSupported: false
				}).promise;
				v.pages += doc.numPages;
				pdfPages += doc.numPages;
				await doc.destroy();
			} catch {
				/* not a PDF (e.g. cached error page) */
			}
		}
	log(`${pdfPages} PDF pages`);
}

// ───────────────────────────── facts for pain points ─────────────────────────────

const validation = readJson<{ messages?: string[] }>(
	path.join(RAW, FY, PIT, 'exp-validation.json')
);
const vMsgs = validation?.messages ?? [];
const recon = readJson<{
	checks?: { ok: boolean }[];
	allFunds?: {
		ebudgetAllFunds?: number;
		reimbursements?: number;
		nongovernmental?: number;
		state?: number;
		federal?: number;
	};
}>(path.join(OUT_DIR, 'reconciliation.json'));

// hand-transcribed chart figures for this fiscal year (count numeric literals in the FY block)
let transcribed = 0;
{
	const src = fs.existsSync('scripts/etl/reconciliation.ts')
		? fs.readFileSync('scripts/etl/reconciliation.ts', 'utf8')
		: '';
	const start = src.indexOf('const CHART_TRANSCRIPTIONS');
	if (start >= 0) {
		const block = src.slice(start, src.indexOf('\n};', start));
		const fyAt = block.indexOf(`'${FY}'`);
		if (fyAt >= 0) {
			// up to the next fiscal-year key, if any
			const next = block.slice(fyAt + 3).search(/'\d{4}-\d{2}'\s*:/);
			const body = next >= 0 ? block.slice(fyAt, fyAt + 3 + next) : block.slice(fyAt);
			const pits = PIT === 'e' ? ['e', 'm'] : [PIT];
			for (const p of pits) {
				const m = body.match(new RegExp(`\\n\\t\\t${p}: \\{([\\s\\S]*?)\\n\\t\\t\\}`));
				if (!m) continue;
				for (const x of m[1].matchAll(/(\w+):\s*(-?\d+)/g)) if (!/page$/i.test(x[1])) transcribed++;
			}
		}
	}
}

// agency code systems: org records whose web (display) agency differs from the org (PDF folder) agency
let agencyDiff = 0;
let orgRecs = 0;
let agencyExample = '';
/** web agency code -> PDF folder (org agency) codes of its departments */
const webToFolders = new Map<string, Set<string>>();
{
	const dir = path.join(RAW, FY, PIT, 'api', 'org');
	for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
		const raw = readJson<unknown>(path.join(dir, f));
		const o = (Array.isArray(raw) ? raw[0] : raw) as {
			orgCd?: string;
			legalTitl?: string;
			orgAgencyCd?: string;
			webAgencyCd?: string;
		} | null;
		if (!o?.orgCd || !o.webAgencyCd || o.orgCd === o.orgAgencyCd) continue;
		orgRecs++;
		if (o.orgAgencyCd) {
			const set = webToFolders.get(o.webAgencyCd) ?? new Set<string>();
			set.add(o.orgAgencyCd);
			webToFolders.set(o.webAgencyCd, set);
		}
		if (o.webAgencyCd !== o.orgAgencyCd) {
			agencyDiff++;
			if (!agencyExample || /Transportation/.test(o.legalTitl ?? ''))
				agencyExample = `${o.orgCd} ${o.legalTitl}: shown under agency ${o.webAgencyCd}, but its PDF lives in folder GovernorsBudget/${o.orgAgencyCd}/`;
		}
	}
}
// web agencies without a PDF folder (e.g. K-12 6010 and Higher Ed 6013 vs. folder 6000)
const webAgencies = (
	readJson<{ orgCd: string; legalTitl: string }[]>(
		path.join(RAW, FY, PIT, 'api', 'statistics.json')
	) ?? []
).map((r) => r.orgCd);
const pdfAgencyDirs = new Set(
	[...vols.keys()].filter((k) => k.startsWith(`eb/${PIT}/dept/`)).map((k) => k.split('/').pop()!)
);
const webOnly = webAgencies.filter((a) => !pdfAgencyDirs.has(a));
const agencyNames = new Map(
	(
		readJson<{ orgCd: string; legalTitl: string }[]>(
			path.join(RAW, FY, PIT, 'api', 'statistics.json')
		) ?? []
	).map((r) => [r.orgCd, r.legalTitl])
);
// org-level agency records name the PDF folders (e.g. 6000 Education)
for (const a of pdfAgencyDirs)
	if (!agencyNames.has(a)) {
		const raw = readJson<unknown>(path.join(RAW, FY, PIT, 'rev', 'api', 'org', `${a}.json`));
		const o = (Array.isArray(raw) ? raw[0] : raw) as {
			legalTitl?: string;
			webTitl?: string;
		} | null;
		if (o) agencyNames.set(a, o.webTitl ?? o.legalTitl ?? a);
	}

let statewide = 0;
{
	const e = readJson<unknown>(path.join(OUT_DIR, 'expenditures.json'));
	const walk = (x: unknown) => {
		const n = x as { extra?: { statewideItem?: boolean }; children?: unknown[] };
		if (n?.extra?.statewideItem) statewide++;
		for (const c of n?.children ?? []) walk(c);
	};
	walk(e);
}
const sankey = readJson<{ expenditureTotal?: number }>(
	path.join(RAW, FY, PIT, 'api', 'sankey.json')
);
const officialGf = readJson<{ official?: { generalFund?: number } }>(
	path.join(RAW, FY, PIT, 'exp-validation.json')
)?.official?.generalFund;
const chapters = (p: string) =>
	readJson<{ title: string; fileName: string }[]>(
		path.join(RAW, FY, p, 'rev', 'api', 'budgetSummaryChapter.json')
	) ?? [];
const fmtB = (thousands?: number | null) =>
	thousands == null ? '?' : `$${(thousands / 1e6).toFixed(1)} billion`;
const noSection = vMsgs.filter((m) => /has no "Detailed Expenditures by Program"/.test(m));
const apiPdf = vMsgs.filter((m) => /PDF .*!= API|!= /.test(m) && !/has no/.test(m));
const fcsUnbalanced = vMsgs.find((m) => /does not balance/.test(m));
const deptPdfCount = [...vols.entries()]
	.filter(([k]) => k.startsWith(`eb/${PIT}/dept/`))
	.reduce((a, [, v]) => a + v.files, 0);
const deptPdfPages = [...vols.entries()]
	.filter(([k]) => k.startsWith(`eb/${PIT}/dept/`))
	.reduce((a, [, v]) => a + v.pages, 0);
const fcsPdfCount = [...vols.entries()]
	.filter(([k]) => k.startsWith(`eb/${PIT}/fcs/`))
	.reduce((a, [, v]) => a + v.files, 0);

const PAIN: CatalogPainPoint[] = [
	{
		id: 'pdf-only',
		tag: 'format',
		title: 'The detail only exists as PDF',
		body: 'The JSON API stops at program level and fund totals. Subprograms and elements, spending by category and object (salaries, rent, grants…), Budget Act appropriation items and fund condition statements are only printed in the department detail PDFs, so they have to be parsed out of page layouts.',
		example: deptPdfCount
			? `${deptPdfCount.toLocaleString()} department PDFs${deptPdfPages ? ` (${deptPdfPages.toLocaleString()} pages)` : ''} parsed for this dataset.`
			: undefined
	},
	{
		id: 'units',
		tag: 'units',
		title: 'Thousands, millions, billions — and whole dollars',
		body: 'Summary Schedules and most API endpoints print thousands of dollars; the API’s General Fund “sankey”, the Summary Charts, Schedule 5B (cash) and Schedule 12A (spending limit) print millions; the narrative chapters round to tenths of a billion; the Budget Act itself appropriates whole dollars. Every comparison needs a unit conversion and a rounding tolerance.',
		example:
			sankey?.expenditureTotal && officialGf
				? `General Fund spending is ${sankey.expenditureTotal.toLocaleString()} in the sankey endpoint (millions) and ${officialGf.toLocaleString()} in the statistics endpoint (thousands).`
				: undefined
	},
	{
		id: 'image-only',
		tag: 'format',
		title: 'Some figures are only pictures',
		body: 'The Budget Summary “Summary Charts” chapter (e.g. the General Fund Budget Summary table and the Proposition 98 split) is a PDF of images: there is no text layer to extract. Those numbers have to be typed in by hand and cross-checked.',
		example: transcribed
			? `${transcribed} figures in this dataset were transcribed by hand from chart images (millions).`
			: undefined
	},
	{
		id: 'may-gaps',
		tag: 'coverage',
		title: 'The May Revision is published differently',
		body: 'For the May Revision, ebudget publishes department totals only (the statistics/revised endpoint). There are no May department detail PDFs and no May Summary Schedules — its General Fund summary is only in the Summary Charts images; the item-level changes are in DOF’s separate May letters on dof.ca.gov.',
		example: `${EB}/${FY}/pdf/Revised/BudgetSummary/BS_SCH1.pdf answered 404 when checked (Nov 2026); so did the Revised department PDFs.`
	},
	{
		id: 'agency-codes',
		tag: 'codes',
		title: 'Two different agency codes for the same department',
		body: 'Each department record has an org agency code (which folder its PDF is filed under) and a web agency code (which agency it is displayed under, and what the statistics endpoint groups by). They usually match, but not always, and some display agencies have no PDF folder at all.',
		example:
			[
				agencyDiff && orgRecs
					? `${agencyDiff} of ${orgRecs} department records disagree. ${agencyExample}.`
					: '',
				webOnly.length
					? `Display agencies ${webOnly.map((a) => `${a} (${agencyNames.get(a) ?? a})`).join(' and ')} have no PDF folder: their departments are filed under ${[...new Set(webOnly.flatMap((a) => [...(webToFolders.get(a) ?? [])]))].map((f) => `${f}${agencyNames.get(f) ? ` (${agencyNames.get(f)})` : ''}`).join(', ') || 'other folders'}.`
					: ''
			]
				.filter(Boolean)
				.join(' ') || undefined
	},
	{
		id: 'sch9-names',
		tag: 'codes',
		title: 'Schedules identify agencies by name, not code',
		body: 'Schedule 9 (spending by agency and fund type) prints agency names without codes, so it has to be matched to the API by normalized name, falling back to a vote of its department codes.'
	},
	{
		id: 'api-pdf-diff',
		tag: 'consistency',
		title: 'The API and the PDFs don’t always agree',
		body: 'The same department’s totals are published twice — by the JSON API and in its PDF — and occasionally differ (different program roll-ups, capital outlay counted in one but not the other). This explorer uses the API figure for totals and shows any difference as an explicit residual.',
		example: apiPdf.length
			? `${apiPdf.length} mismatches in this dataset, e.g. “${apiPdf[0]}”.`
			: undefined
	},
	{
		id: 'missing-sections',
		tag: 'coverage',
		title: 'Not every PDF has the same sections',
		body: 'Department PDFs follow a common template, but sections are omitted when a department has nothing to report — and sometimes when it does — so every parser has to cope with missing tables.',
		example: noSection.length
			? `${noSection.length} department PDFs have no “Detailed Expenditures by Program” section (${noSection.map((m) => m.split(':')[0]).join(', ')}).`
			: undefined
	},
	{
		id: 'stale-schedules',
		tag: 'consistency',
		title: '“Enacted” documents that are still the January version',
		body: 'Not every schedule is updated at each stage. In the Enacted Budget folder, Schedules 2, 3, 5B and 12B are still titled “at 2026-27 Governor’s Budget”, next to Schedules 1, 4, 6, 8–11 and 12A titled “at 2026 Budget Act”.',
		example: 'Observed in the Enacted BudgetSummary folder, Nov 2026.'
	},
	{
		id: 'all-funds',
		tag: 'consistency',
		title: '“All funds” counts some money twice',
		body: 'ebudget’s “all funds” total includes reimbursements (one department paying another) and nongovernmental cost funds (pension trusts, university own funds, local property tax). Totals that do and don’t include them circulate side by side.',
		example: recon?.allFunds?.ebudgetAllFunds
			? `${fmtB(recon.allFunds.ebudgetAllFunds)} “all funds” includes ${fmtB(recon.allFunds.reimbursements)} of reimbursements and ${fmtB(recon.allFunds.nongovernmental)} of nongovernmental cost funds.`
			: undefined
	},
	{
		id: 'statewide',
		tag: 'coverage',
		title: 'Spending that belongs to no department page',
		body: 'Statewide items (general obligation bond debt service, employee compensation augmentations, Prop 98 reconciliation…) are in agency totals but are hidden from the department listing (displayOnWebFlg = N) and have no detail PDF.',
		example: statewide ? `${statewide} statewide items in this dataset.` : undefined
	},
	{
		id: 'fcs-twice',
		tag: 'consistency',
		title: 'Fund condition statements are published twice',
		body: 'Each special fund’s balance sheet appears inside the administering department’s detail PDF and again in a separate {org}FCS.pdf — and Schedule 10 summarizes them a third time. Printed statements don’t always add up.',
		example: fcsUnbalanced
			? `${fcsPdfCount ? `${fcsPdfCount} separate FCS PDFs fetched. ` : ''}${fcsUnbalanced.replace(/^Reconciliation:\s*/, '')}`
			: fcsPdfCount
				? `${fcsPdfCount} separate FCS PDFs fetched.`
				: undefined
	},
	{
		id: 'undocumented-api',
		tag: 'access',
		title: 'An undocumented API',
		body: 'ebudget’s JSON API has no public documentation; endpoints were reverse-engineered from the site’s JavaScript bundle. Its URL prefix changed between years (“publication” up to 2025-26, “budget” from 2026-27), unknown codes answer with a JSON HTTP 500, and the publication index (home/getLink) returns JSON text split across an array of strings that must be joined and parsed again.'
	},
	{
		id: 'three-years',
		tag: 'consistency',
		title: 'Every number has three versions per publication',
		body: `Each publication restates three fiscal years: past-year actuals (${Y.py}), current-year estimates (${Y.cy}) and the budget year (${Y.by}). The current year is re-estimated in every publication, so “${Y.cy} spending” has a different value in each.`
	},
	{
		id: 'scope',
		tag: 'coverage',
		title: 'Revenue and spending don’t cover the same money',
		body: 'Schedule 8 revenue covers only state funds (General Fund and special funds). Federal funds and bond proceeds are in total spending but not in revenue, and transfers/loans move money between funds without being revenue or spending.'
	},
	{
		id: 'basis',
		tag: 'consistency',
		title: 'Budget basis vs. accounting basis vs. cash',
		body: 'The budget (DOF), the Controller’s audited statements (GAAP), the Controller’s cash reports, FI$Cal transactions and the tax agencies’ collections each use a different basis and classification, so their totals legitimately differ.'
	},
	{
		id: 'narrative',
		tag: 'format',
		title: 'Key facts only exist in prose',
		body: 'The size of the budget problem and how it was solved are only stated in the narrative chapters (“$X billion”), and the Enacted Budget Summary prints no single table of solutions — so figures are quoted from text and cross-checked against the schedules.'
	}
];
const PAIN_IDS = new Set(PAIN.map((p) => p.id));

// ───────────────────────────── tree ─────────────────────────────

interface Def {
	name: string;
	description?: string;
	formats?: CatalogFormat[];
	units?: string;
	granularity?: string;
	feeds?: Product[];
	pain?: string[];
	/** Downloaded at some point but not read by the current ETLs. */
	unused?: boolean;
}
const TH = 'thousands of dollars';
const MI = 'millions of dollars';
const API_DEFS: Record<string, Def> = {
	appInfo: {
		name: 'appInfo — publication name, date and the three fiscal years',
		feeds: ['meta', 'reconciliation'],
		granularity: 'publication'
	},
	statistics: {
		name: 'statistics — agency totals',
		description:
			'State funds, all funds, General/special/bond fund totals and positions for each agency. The official control totals.',
		units: TH,
		granularity: 'agency (web agency code)',
		feeds: ['meta', 'expenditures', 'reconciliation'],
		pain: ['all-funds', 'agency-codes']
	},
	'statistics/{agency}': {
		name: 'statistics/{agency} — departments in an agency',
		description: 'Department totals by agency, including hidden “statewide” items.',
		units: TH,
		granularity: 'department',
		feeds: ['expenditures'],
		pain: ['statewide', 'agency-codes']
	},
	'statistics/revised': {
		name: 'statistics/revised — May Revision changes (agency)',
		units: TH,
		granularity: 'agency',
		feeds: ['meta', 'expenditures'],
		pain: ['may-gaps']
	},
	'statistics/revised/{agency}': {
		name: 'statistics/revised/{agency} — May Revision changes (department)',
		units: TH,
		granularity: 'department',
		feeds: ['expenditures'],
		pain: ['may-gaps']
	},
	'org/{org}': {
		name: 'org/{org} — organization records',
		description: 'Titles, agency/sub-agency codes (two kinds), website, display flags.',
		granularity: 'department',
		feeds: ['expenditures', 'departments', 'flows'],
		pain: ['agency-codes']
	},
	'org/deptIndex': {
		name: 'org/deptIndex — department → agency index',
		granularity: 'department',
		feeds: ['flows'],
		pain: ['agency-codes']
	},
	'orgProgram/{org}': {
		name: 'orgProgram/{org} — programs & positions',
		description:
			'Three-year program-level expenditures and personnel years, plus infrastructure totals.',
		units: TH,
		granularity: 'program',
		feeds: ['expenditures', 'departments'],
		pain: ['api-pdf-diff']
	},
	'rwaCntl/support/{org}': {
		name: 'rwaCntl/support/{org} — support spending by fund',
		description: 'Expenditures by fund with fund class (state operations + local assistance).',
		units: TH,
		granularity: 'department × fund',
		feeds: ['expenditures', 'departments', 'funds'],
		pain: ['all-funds']
	},
	'rwaCntl/capOutlay/{org}': {
		name: 'rwaCntl/capOutlay/{org} — capital outlay by fund',
		units: TH,
		granularity: 'department × fund',
		feeds: ['expenditures', 'departments'],
		pain: ['api-pdf-diff']
	},
	'orgProject/{org}': {
		name: 'orgProject/{org} — capital outlay projects',
		units: TH,
		granularity: 'project / phase',
		feeds: ['departments'],
		pain: ['api-pdf-diff']
	},
	'orgStoryCntl/{org}': {
		name: 'orgStoryCntl/{org} — narratives',
		description:
			'Department and program descriptions, legal citations, infrastructure overview — as HTML fragments inside JSON.',
		formats: ['JSON', 'HTML'],
		granularity: 'department / program',
		feeds: ['departments', 'expenditures']
	},
	'fcsCntl/fundIndex': {
		name: 'fcsCntl/fundIndex — fund index',
		description:
			'Fund code → legal title and administering department (which PDF holds its fund condition statement).',
		granularity: 'fund',
		feeds: ['funds', 'revenues'],
		pain: ['fcs-twice']
	},
	'fcsCntl/{org}': {
		name: 'fcsCntl/{org} — funds administered by a department',
		description:
			'Same rows as fcsCntl/fundIndex, one request per department. In the download cache, but the current ETLs use the single fund index instead.',
		granularity: 'department × fund',
		unused: true
	},
	sankey: {
		name: 'sankey — General Fund summary diagram data',
		description: 'Revenue and expenditure totals behind ebudget’s own General Fund diagram.',
		units: MI,
		granularity: 'major revenue / program area',
		feeds: ['meta', 'flows'],
		pain: ['units']
	},
	budgetSummaryChapter: {
		name: 'budgetSummaryChapter — Budget Summary chapter index',
		feeds: ['reconciliation'],
		granularity: 'chapter'
	}
};
const SCH_DEFS: Record<string, Def & { used?: boolean }> = {
	'1': {
		name: 'Schedule 1 — General Budget Summary',
		description: 'General Fund and special fund resources, expenditures, balances and reserves.',
		units: TH,
		granularity: 'fund type',
		feeds: ['reconciliation', 'revenues']
	},
	'2': {
		name: 'Schedule 2 — Summary of State Tax Collections',
		units: TH,
		pain: ['stale-schedules']
	},
	'3': {
		name: 'Schedule 3 — Comparative Yield of State Taxes (since 1970-71)',
		units: TH,
		pain: ['stale-schedules']
	},
	'4': { name: 'Schedule 4 — Position and Salary Cost Estimates', units: TH },
	'5B': {
		name: 'Schedule 5B — General Fund Cash Flow',
		units: MI,
		pain: ['stale-schedules', 'units']
	},
	'6': {
		name: 'Schedule 6 — Summary of State Population, Employees, and Expenditures',
		units: MI,
		granularity: 'statewide, since 1950s',
		feeds: ['revenues']
	},
	'8': {
		name: 'Schedule 8 — Comparative Statement of Revenues',
		description:
			'Every state revenue source by 7-digit revenue code, General Fund vs special funds.',
		units: TH,
		granularity: 'revenue source',
		feeds: ['revenues', 'flows', 'reconciliation'],
		pain: ['scope']
	},
	'9': {
		name: 'Schedule 9 — Comparative Statement of Expenditures',
		description: 'Spending by agency/department and fund type.',
		units: TH,
		granularity: 'department × fund type',
		feeds: ['flows', 'reconciliation'],
		pain: ['sch9-names']
	},
	'10': {
		name: 'Schedule 10 — Summary of Fund Condition Statements',
		description:
			'Beginning balance, revenues, transfers, expenditures and ending balance of every special fund.',
		units: TH,
		granularity: 'fund',
		feeds: ['revenues', 'reconciliation'],
		pain: ['fcs-twice']
	},
	'11': { name: 'Schedule 11 — General Obligation Bond & Commercial Paper Debt', units: TH },
	'12A': {
		name: 'Schedule 12A — State Appropriations Limit (Gann limit) calculation',
		units: MI,
		pain: ['units']
	},
	'12B': { name: 'Schedule 12B — Revenues to Excluded Funds', units: TH, pain: ['stale-schedules'] }
};
/** Schedules seen on ebudget for the Enacted folder (Nov 2026); used for the "not used" list. */
const SCH_PUBLISHED = ['1', '2', '3', '4', '5B', '6', '8', '9', '10', '11', '12A', '12B'];

const pdfUrl = (pit: string, rel: string) =>
	`${EB}/${FY}/pdf/${PDF_FOLDER[pit] ? PDF_FOLDER[pit] + '/' : ''}${rel}`;
const apiUrl = (pit: string, p: string) => `${EB}/api/budget/${pit}/${FY}/${p}`;

function leaf(id: string, d: Def, extra: Partial<CatalogNode> = {}): CatalogNode {
	const v = vols.get(id);
	const b = backs.get(id);
	const feeds = new Set<Product>([...(d.feeds ?? []), ...(Object.keys(b ?? {}) as Product[])]);
	const used = extra.used ?? (!d.unused && !!(v?.files || b));
	return {
		id,
		name: d.name,
		level: 'document',
		used,
		kind: 'official',
		...(d.description ? { description: d.description } : {}),
		...(d.formats ? { formats: d.formats } : {}),
		...(d.units ? { units: d.units } : {}),
		...(d.granularity ? { granularity: d.granularity } : {}),
		years: `${Y.py} – ${Y.by}`,
		...(used && feeds.size ? { feeds: [...feeds] } : {}),
		...(v ? { files: v.files, bytes: v.bytes, ...(v.pages ? { pages: v.pages } : {}) } : {}),
		...(b ? { backs: b } : {}),
		...(d.pain?.length ? { pain: d.pain.filter((p) => PAIN_IDS.has(p)) } : {}),
		...extra
	};
}
function group(
	id: string,
	level: CatalogNode['level'],
	name: string,
	children: CatalogNode[],
	extra: Partial<CatalogNode> = {}
): CatalogNode {
	const kids = children.filter(Boolean);
	return {
		id,
		name,
		level,
		used: kids.some((c) => c.used),
		kind: 'official',
		...extra,
		children: kids
	};
}

function publicationNode(pit: 'p' | 'm' | 'e'): CatalogNode {
	const ai = appInfo[pit];
	const current = pit === PIT;
	const docTypes: CatalogNode[] = [];

	// JSON API endpoints
	const families = new Set<string>();
	for (const k of [...vols.keys(), ...backs.keys()]) {
		const m = k.match(new RegExp(`^eb/${pit}/api/(.+)$`));
		if (m) families.add(m[1]);
	}
	if (current)
		for (const k of Object.keys(API_DEFS))
			if (!/revised/.test(k) || pit === 'm') families.add(slug(k));
	const famName = new Map(Object.keys(API_DEFS).map((k) => [slug(k), k]));
	const api = [...families]
		.sort(
			(a, b) =>
				Object.keys(API_DEFS).indexOf(famName.get(a) ?? a) -
				Object.keys(API_DEFS).indexOf(famName.get(b) ?? b)
		)
		.map((f) => {
			const key = famName.get(f) ?? f;
			const def = API_DEFS[key] ?? { name: key };
			return leaf(
				`eb/${pit}/api/${f}`,
				{ formats: ['JSON'], ...def },
				{
					url: apiUrl(pit, key.replace('{agency}', '0010').replace('{org}', '0250')),
					...(key.includes('{') ? { count: vols.get(`eb/${pit}/api/${f}`)?.files } : {})
				}
			);
		});
	if (api.length)
		docTypes.push(
			group(`eb/${pit}/api`, 'docType', 'JSON API endpoints', api, {
				formats: ['JSON'],
				description: `ebudget.ca.gov/api/budget/${pit}/${FY}/…: the machine-readable layer behind ebudget’s Budget Detail pages. Undocumented; one request per department per endpoint.`,
				pain: ['undocumented-api']
			})
		);

	// department detail PDFs, grouped by PDF agency folder
	const deptAg = [
		...new Set([...vols.keys(), ...backs.keys()].filter((k) => k.startsWith(`eb/${pit}/dept/`)))
	].sort();
	const deptKids = deptAg.map((k) => {
		const ag = k.split('/').pop()!;
		const v = vols.get(k);
		return leaf(
			k,
			{
				name: `${ag} ${agencyNames.get(ag) ?? ''}`.trim(),
				formats: ['PDF'],
				units: TH,
				granularity: 'subprogram/element × fund; category/object; appropriation item',
				feeds: ['departments', 'expenditures', 'funds'],
				pain: ['pdf-only', 'api-pdf-diff', 'missing-sections']
			},
			{ count: v?.files, url: pdfUrl(pit, `GovernorsBudget/${ag}/`) }
		);
	});
	if (deptKids.length)
		docTypes.push(
			group(`eb/${pit}/dept`, 'docType', 'Budget Detail — department PDFs', deptKids, {
				formats: ['PDF'],
				units: TH,
				url: pdfUrl(pit, 'GovernorsBudget/'),
				description:
					'One PDF per department (GovernorsBudget/{agency}/{org}.pdf): 3-year expenditures and positions, programs down to elements, spending by category, appropriation items, fund condition statements.',
				pain: ['pdf-only']
			})
		);
	else if (pit === 'm')
		docTypes.push({
			id: 'eb/m/dept',
			name: 'Department PDFs: not published',
			description:
				'ebudget publishes no department detail PDFs for the May Revision (Revised/GovernorsBudget/… answers 404); the item-level May changes are only in DOF’s May letters.',
			level: 'docType',
			used: false,
			missing: true,
			kind: 'official',
			formats: ['PDF'],
			pain: ['may-gaps']
		});
	else if (!current)
		docTypes.push({
			id: `eb/${pit}/dept`,
			name: 'Budget Detail — department PDFs',
			level: 'docType',
			used: false,
			kind: 'official',
			formats: ['PDF'],
			url: pdfUrl(pit, 'GovernorsBudget/'),
			description: `The ${PIT_NAME[pit]} versions; superseded by the ${PIT_NAME[PIT]} for this dataset.`
		});

	// fund condition statement PDFs
	const fcsAg = [...new Set([...vols.keys()].filter((k) => k.startsWith(`eb/${pit}/fcs/`)))].sort();
	if (fcsAg.length)
		docTypes.push(
			group(
				`eb/${pit}/fcs`,
				'docType',
				'Fund Condition Statement PDFs',
				fcsAg.map((k) => {
					const ag = k.split('/').pop()!;
					return leaf(
						k,
						{
							name: `${ag} ${agencyNames.get(ag) ?? ''}`.trim(),
							formats: ['PDF'],
							units: TH,
							granularity: 'special fund × revenue code',
							feeds: ['revenues'],
							pain: ['fcs-twice', 'pdf-only']
						},
						{ count: vols.get(k)?.files, url: pdfUrl(pit, `GovernorsBudget/${ag}/`) }
					);
				}),
				{
					formats: ['PDF'],
					units: TH,
					backs: backs.get(`eb/${pit}/fcs`),
					description:
						'GovernorsBudget/{agency}/{org}FCS.pdf: the balance sheet of each special fund, by revenue code. The only per-fund source of special-fund revenue.',
					pain: ['fcs-twice']
				}
			)
		);

	// Summary Schedules
	const schSeen = new Set(
		[...vols.keys(), ...backs.keys()]
			.filter((k) => k.startsWith(`eb/${pit}/sch/`))
			.map((k) => k.split('/').pop()!)
	);
	const schList = current ? [...new Set([...SCH_PUBLISHED, ...schSeen])] : [...schSeen];
	schList.sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b));
	const sch = schList.map((n) =>
		leaf(
			`eb/${pit}/sch/${n}`,
			{
				formats: ['PDF'],
				...(SCH_DEFS[n] ?? { name: `Schedule ${n}` }),
				...(schSeen.has(n) ? {} : { feeds: [] })
			},
			{
				url: pdfUrl(pit, `BudgetSummary/BS_SCH${n}.pdf`),
				...(schSeen.has(n) ? {} : { used: false })
			}
		)
	);
	if (sch.length)
		docTypes.push(
			group(`eb/${pit}/sch`, 'docType', 'Budget Summary — Summary Schedules', sch, {
				formats: ['PDF'],
				units: TH,
				description:
					'DOF’s statewide summary tables (BudgetSummary/BS_SCH{n}.pdf). Text PDFs, laid out for print.',
				pain: ['units']
			})
		);
	else if (pit === 'm')
		docTypes.push({
			id: 'eb/m/sch',
			name: 'Summary Schedules: not published',
			description:
				'No May Revision Summary Schedules on ebudget (Revised/BudgetSummary/BS_SCH1.pdf answers 404): the May General Fund summary exists only as an image in the Summary Charts.',
			level: 'docType',
			used: false,
			missing: true,
			kind: 'official',
			formats: ['PDF'],
			pain: ['may-gaps']
		});

	// Budget Summary chapters
	const chList = chapters(pit);
	const chSeen = new Set(
		[...vols.keys(), ...backs.keys()]
			.filter((k) => k.startsWith(`eb/${pit}/chap/`))
			.map((k) => k.split('/').pop()!)
	);
	const chKids: CatalogNode[] = [];
	for (const c of [...chSeen].sort()) {
		const charts = /SummaryCharts/i.test(c);
		chKids.push(
			leaf(
				`eb/${pit}/chap/${c}`,
				charts
					? {
							name: 'Summary Charts (images)',
							description: 'Charts and tables printed as images — figures transcribed by hand.',
							formats: ['PDF', 'PNG'],
							units: MI,
							granularity: 'statewide',
							feeds: ['reconciliation'],
							pain: ['image-only', 'units']
						}
					: /FullBudgetSummary/.test(c)
						? { name: 'Full Budget Summary', formats: ['PDF'] }
						: {
								name: chList.find((x) => x.fileName === c)?.title ?? c,
								description:
									'Narrative chapter; budget-problem and solution figures quoted from the text.',
								formats: ['PDF'],
								units: 'billions (rounded, in prose)',
								feeds: ['reconciliation'],
								pain: ['narrative', 'units']
							},
				// the Summary Charts PDF is cited, not parsed: it is image-only
				{
					url: pdfUrl(pit, `BudgetSummary/${c}.pdf`),
					...(charts ? { used: !!backs.get(`eb/${pit}/chap/${c}`) } : {})
				}
			)
		);
	}
	const otherCh = chList.filter((c) => !chSeen.has(c.fileName));
	if (otherCh.length)
		chKids.push({
			id: `eb/${pit}/chap/other`,
			name: `${otherCh.length} other chapters (${otherCh
				.slice(0, 4)
				.map((c) => c.title)
				.join(', ')}${otherCh.length > 4 ? ', …' : ''})`,
			level: 'document',
			used: false,
			kind: 'official',
			formats: ['PDF'],
			count: otherCh.length,
			units: 'billions / millions (in prose)',
			examples: otherCh
				.slice(0, 6)
				.map((c) => ({ label: c.title, url: pdfUrl(pit, `BudgetSummary/${c.fileName}.pdf`) }))
		});
	if (chKids.length)
		docTypes.push(
			group(`eb/${pit}/chap`, 'docType', 'Budget Summary — chapters', chKids, {
				formats: ['PDF'],
				url: `${EB}/budget/${pit}/${FY}/BudgetSummary`,
				description: 'The Governor’s narrative: what the budget does and why, by policy area.'
			})
		);

	// web pages
	if (current || backs.has(`eb/${pit}/web`))
		docTypes.push(
			group(`eb/${pit}/web`, 'docType', 'ebudget web pages', [
				leaf(
					`eb/${pit}/web/detail`,
					{
						name: 'Budget Detail (interactive pages)',
						formats: ['HTML'],
						description: 'The human-readable front end over the JSON API.'
					},
					{
						url: `${EB}/budget/${pit}/${FY}/BudgetDetail`,
						used: !!backs.get(`eb/${pit}/web`),
						...(backs.get(`eb/${pit}/web`) ? { backs: backs.get(`eb/${pit}/web`) } : {})
					}
				)
			])
		);

	const date = ai?.publicationDate ?? (current ? meta.publicationDate : undefined);
	return group(`eb/${pit}`, 'publication', `${PIT_NAME[pit]} ${FY}`, docTypes, {
		url: `${EB}/budget/${pit}/${FY}/BudgetSummary`,
		description:
			(date ? `${date}. ` : '') +
			(current
				? `The publication this dataset is built from.`
				: pit === 'p'
					? `January proposal. Used here for the January General Fund plan and the budget-problem narrative.`
					: `Spring update. Used here for its narrative and its (image-only) General Fund summary.`),
		years: `${Y.py}, ${Y.cy}, ${Y.by}`
	});
}

const ebudget = group(
	'eb',
	'publisher',
	'ebudget.ca.gov (Dept. of Finance)',
	[
		...PITS.map(publicationNode),
		group('eb/site', 'publication', 'Site-wide (all publications)', [
			group('eb/site/api', 'docType', 'JSON API — site index', [
				leaf(
					'eb/site/getLink',
					{
						name: 'home/getLink — which publications exist, and their URL prefix',
						formats: ['JSON'],
						pain: ['undocumented-api']
					},
					{ url: `${EB}/api/home/getLink` }
				)
			]),
			group('eb/site/refdocs', 'docType', 'Reference PDFs', [
				leaf(
					'eb/site/ref',
					{ name: 'General Fund Multi-Year Projection', formats: ['PDF'], units: MI },
					{ url: `${EB}/reference/MultiYearProjection.pdf`, used: false, verified: true }
				)
			])
		])
	],
	{
		url: EB,
		verified: true,
		description:
			'The Department of Finance’s budget site: every publication of the Governor’s Budget, as interactive pages, an undocumented JSON API and several series of PDFs. Everything this explorer shows comes from here.'
	}
);

const root: CatalogNode = {
	id: 'root',
	name: 'California state budget information',
	level: 'root',
	used: true,
	kind: 'official',
	description: `Where the numbers for the ${FY} ${meta.publication} budget come from — and where else budget information lives.`,
	children: [ebudget, ...externalPublishers(FY)]
};

// ───────────────────────────── stats ─────────────────────────────

const all: CatalogNode[] = [];
const visit = (n: CatalogNode) => {
	all.push(n);
	n.children?.forEach(visit);
};
visit(root);
const leaves = all.filter((n) => !n.children?.length && n.level !== 'root');
const formats = [...new Set(all.flatMap((n) => n.formats ?? []))] as CatalogFormat[];
const normUnit = (u: string) =>
	/thousand/i.test(u)
		? 'thousands of dollars'
		: /billion/i.test(u)
			? 'billions (rounded, prose)'
			: /million/i.test(u)
				? 'millions of dollars'
				: /dollar/i.test(u)
					? 'whole dollars'
					: u;
const units = [...new Set(all.flatMap((n) => (n.units ? [normUnit(n.units)] : [])))];
const stats: CatalogStats = {
	publishers: root.children!.length,
	publishersUsed: root.children!.filter((c) => c.used).length,
	publications: all.filter((n) => n.level === 'publication').length,
	documentTypes: all.filter((n) => n.level === 'docType').length,
	documents: leaves.reduce((a, n) => a + (n.count ?? 1), 0),
	documentsUsed: leaves.filter((n) => n.used).reduce((a, n) => a + (n.files ?? n.count ?? 1), 0),
	formats,
	unitConventions: units,
	codeSystems: [
		'Organization code (4 digits, e.g. 0250)',
		'Org agency code (PDF folder)',
		'Web agency code (display / statistics)',
		'Program code (7 digits)',
		'Fund code (4 digits)',
		'Fund class code (rwaCntl)',
		'Revenue source code (7 digits)',
		'Budget Act item (0250-001-0001)',
		'Object of expenditure / category'
	],
	filesDownloaded: rawFiles,
	bytesDownloaded: rawBytes,
	pdfPagesParsed: pdfPages,
	handTranscribed: transcribed,
	citations,
	// distinct endpoint families (appInfo of three publications counts once)
	apiEndpoints: new Set(
		all
			.filter((n) => n.used && /^eb\/([pme]\/api\/|site\/getLink$)/.test(n.id))
			.map((n) => n.id.replace(/^eb\/[pme]\/api\//, ''))
	).size,
	...(recon?.checks
		? { crossChecks: { total: recon.checks.length, ok: recon.checks.filter((c) => c.ok).length } }
		: {}),
	etlMessages: vMsgs.length
};

const out: SourcesCatalog = {
	fiscalYear: FY,
	pit: PIT,
	publication: meta.publication,
	generatedAt: new Date().toISOString(),
	root,
	painPoints: PAIN,
	stats,
	products: PRODUCTS.map((p) => ({
		...p,
		...(productNodes[p.id] ? { nodes: productNodes[p.id] } : {})
	})),
	notes: [
		'Files, bytes and pages are measured from the ETL download cache (data-raw/); the same document cached by two ETLs is counted once.',
		'“Cited by” counts the source references (SourceRef) attached to nodes in this explorer’s data files; per-fund revenue nodes derived from Fund Condition Statements are counted against that series.',
		'Sources marked “not used” are listed for completeness. Links marked “unverified” could not be checked automatically (the site blocks scripted requests).',
		...(unmatched.size
			? [`${unmatched.size} cited URLs are not ebudget documents and are not counted.`]
			: [])
	]
};
const file = path.join(OUT_DIR, 'sources-catalog.json');
fs.writeFileSync(file + '.tmp', JSON.stringify(out));
fs.renameSync(file + '.tmp', file);
log(
	`wrote ${file}: ${all.length} nodes, ${stats.documents} documents, ${stats.publishers} publishers, ${PAIN.length} pain points`
);
