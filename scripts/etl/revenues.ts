/**
 * Revenue + money-flow ETL for the CA Budget Explorer.
 *
 *   node scripts/etl/revenues.ts --fy 2026-27 --pit e [--refresh] [--no-fcs] [--out static/data]
 *
 * Official sources only (ebudget.ca.gov, which hosts DOF's Summary Schedules):
 *   - Schedule 8  "Comparative Statement of Revenues"   -> revenue tree (GF / special funds,
 *                  major taxes / minor revenues / transfers, by official revenue code)
 *   - Departmental Fund Condition Statements ({orgCd}FCS.pdf) -> per-special-fund amounts
 *                  for each revenue code
 *   - Schedule 10 "Summary of Fund Condition Statements" -> special fund list + per-fund totals
 *   - Schedule 9  "Comparative Statement of Expenditures" -> fund type x agency spending (flows)
 *   - Schedule 1 / Schedule 6 / ebudget `sankey` API -> reconciliation + history
 *
 * Outputs (thousands of dollars): static/data/{fy}/{pit}/revenues.json (BudgetNode) and
 * flows.json (Flows). Raw downloads cached under data-raw/{fy}/{pit}/rev/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { RevFetcher } from './lib/rev-fetch.ts';
import { readRows, splitRow } from './lib/rev-pdf.ts';
import {
	parseSchedule8,
	parseSchedule9,
	parseSchedule10,
	parseFcs,
	type Tri,
	type S8Group,
	type S8Source,
	type FcsFund
} from './lib/rev-parse.ts';
import type {
	BudgetNode,
	Flows,
	FlowNode,
	SourceRef,
	Triple
} from '../../src/lib/data/schema.ts';

const { values: args } = parseArgs({
	options: {
		fy: { type: 'string', default: '2026-27' },
		pit: { type: 'string', default: 'e' },
		out: { type: 'string', default: 'static/data' },
		raw: { type: 'string', default: 'data-raw' },
		refresh: { type: 'boolean', default: false },
		'no-fcs': { type: 'boolean', default: false },
		'top-sources': { type: 'string', default: '12' }
	}
});
const FY = args.fy!;
const PIT = args.pit!;

const warnings: string[] = [];
const warn = (m: string) => {
	warnings.push(m);
	console.warn('  ! ' + m);
};
const log = (m: string) => console.log(m);

const ZERO: Tri = { py: 0, cy: 0, by: 0 };
const YRS = ['py', 'cy', 'by'] as const;
const add = (a: Tri, b: Tri): Tri => ({ py: a.py + b.py, cy: a.cy + b.cy, by: a.by + b.by });
const sub = (a: Tri, b: Tri): Tri => ({ py: a.py - b.py, cy: a.cy - b.cy, by: a.by - b.by });
const sum = (xs: Tri[]) => xs.reduce(add, { ...ZERO });
const nonzero = (t: Tri, tol = 0) => YRS.some((k) => Math.abs(t[k]) > tol);
const T = (t: Tri): Triple => ({ py: t.py, cy: t.cy, by: t.by });

async function main() {
	const f = await new RevFetcher(FY, PIT, { rawRoot: args.raw, refresh: args.refresh }).init();
	const ai = f.appInfo;
	log(
		`Revenue ETL ${FY}/${PIT}: ${ai.publication} (${ai.publicationDate}); api prefix "${f.prefix}"`
	);
	const years = { py: ai.previousYear, cy: ai.currentYear, by: ai.budgetYear };
	const notes: string[] = [];
	const recon: Record<string, unknown>[] = [];

	// ── Summary schedules ──────────────────────────────────────────────
	const sched = async (file: string, label: string) => {
		const url = f.summaryPdfUrl(file);
		const buf = await f.pdf(url);
		if (!buf) {
			warn(`${label} not published at ${url}`);
			return null;
		}
		return {
			url,
			rows: await readRows(buf),
			ref: { label: `DOF Summary ${label}`, url } as SourceRef
		};
	};
	const s8raw = await sched('BS_SCH8.pdf', 'Schedule 8 — Comparative Statement of Revenues');
	if (!s8raw) throw new Error('Schedule 8 is required');
	const [s9raw, s10raw, s1raw, s6raw] = await Promise.all([
		sched('BS_SCH9.pdf', 'Schedule 9 — Comparative Statement of Expenditures'),
		sched('BS_SCH10.pdf', 'Schedule 10 — Summary of Fund Condition Statements'),
		sched('BS_SCH1.pdf', 'Schedule 1 — General Budget Summary'),
		sched('BS_SCH6.pdf', 'Schedule 6 — Summary of State Population, Employees, and Expenditures')
	]);
	const s8 = parseSchedule8(s8raw.rows, warn);
	const s9 = s9raw ? parseSchedule9(s9raw.rows, warn) : null;
	const s10 = s10raw ? parseSchedule10(s10raw.rows, warn) : null;
	log(`  Schedule 8: "${s8.title}"; ${s8.categories.length} categories`);
	if (!/BUDGET ACT|ENACTED/i.test(s8.title) && PIT === 'e')
		notes.push(`Schedule 8 title is "${s8.title}" — may not reflect the enacted budget.`);

	// ── Special funds: Schedule 10 list + FCS per-fund revenue detail ─────
	const fundIndex = await f.api<
		{ fundCd: string; fundLglTitl: string; orgCd: string; orgAgencyCd: string }[]
	>('fcsCntl/fundIndex', []);
	const fundName = new Map<string, string>();
	for (const x of s10?.funds ?? []) fundName.set(x.code, x.name);
	for (const x of fundIndex) fundName.set(x.fundCd, x.fundLglTitl);
	const specialSet = new Set(
		(s10?.funds ?? []).filter((x) => x.section === 'special').map((x) => x.code)
	);
	// code -> fundCd -> amounts
	const byCode = new Map<string, Map<string, Tri>>();
	const fcsRefs: SourceRef[] = [];
	let fcsFunds: FcsFund[];
	if (!args['no-fcs'] && fundIndex.length) {
		const orgs = [...new Map(fundIndex.map((x) => [x.orgCd, x.orgAgencyCd])).entries()];
		log(`  Fund condition statements: ${orgs.length} departmental FCS PDFs`);
		const results = await Promise.all(
			orgs.map(async ([org, ag]) => {
				const url = f.fcsPdfUrl(ag, org);
				const buf = await f.pdf(url);
				if (!buf) {
					warn(`FCS not published: ${url}`);
					return [];
				}
				fcsRefs.push({ label: `ebudget Fund Condition Statements ${org}`, url });
				const w = (m: string) => warn(`${org}FCS: ${m}`);
				return parseFcs(await readRows(buf), w);
			})
		);
		fcsFunds = results.flat();
		const seen = new Set<string>();
		for (const fd of fcsFunds) {
			if (!specialSet.has(fd.code) || seen.has(fd.code)) continue;
			seen.add(fd.code);
			for (const r of fd.revenues) {
				let m = byCode.get(r.code);
				if (!m) byCode.set(r.code, (m = new Map()));
				m.set(fd.code, add(m.get(fd.code) ?? ZERO, r.amounts));
			}
		}
		// Per-fund check: FCS "Total Revenues, Transfers" vs Schedule 10 fund revenues
		let mism = 0;
		const s10map = new Map((s10?.funds ?? []).map((x) => [x.code, x]));
		for (const fd of fcsFunds) {
			const s = s10map.get(fd.code);
			if (!s || !fd.totalRevTransfers) continue;
			if (nonzero(sub(fd.totalRevTransfers, s.revenues), 2)) mism++;
		}
		recon.push({
			check:
				'FCS per-fund "Total Revenues, Transfers, and Other Adjustments" vs Schedule 10 fund revenues',
			fundsCompared: fcsFunds.filter((x) => s10map.has(x.code) && x.totalRevTransfers).length,
			fundsDiffering: mism
		});
		log(`  FCS: ${fcsFunds.length} funds parsed, ${seen.size} special funds with revenue detail`);
	}

	// ── Build the revenue tree ──────────────────────────────────────────
	type FT = 'general' | 'special';
	const pick = (s: { gf: Tri; sf: Tri }, ft: FT) => (ft === 'general' ? s.gf : s.sf);
	let sourceCount = 0;
	let fundNodeCount = 0;
	let residualCount = 0;
	const fundAlloc = { itemized: { ...ZERO }, residual: { ...ZERO } };
	const s8ref = s8raw.ref;

	const sourceNode = (
		src: S8Source,
		ft: FT,
		parentId: string,
		isTransfer: boolean
	): BudgetNode | null => {
		const amt = pick(src, ft);
		if (!nonzero(amt)) return null;
		sourceCount++;
		const id = `${parentId}/${src.code}`;
		const n: BudgetNode = {
			id,
			kind: 'revenueSource',
			name: src.name,
			code: /^\d+$/.test(src.code) ? src.code : undefined,
			amounts: T(amt),
			byFundType: { [ft]: T(amt) },
			extra: { allFunds: T(src.total), ...(isTransfer ? { transfer: true } : {}) }
		};
		if (ft === 'special' && !isTransfer && byCode.size) {
			const m = byCode.get(src.code);
			const kids: BudgetNode[] = [];
			let itemized = { ...ZERO };
			for (const [fc, a] of [...(m ?? new Map<string, Tri>()).entries()].sort(
				(x, y) => y[1].by - x[1].by
			)) {
				if (!nonzero(a)) continue;
				itemized = add(itemized, a);
				kids.push({
					id: `${id}/${fc}`,
					kind: 'fund',
					code: fc,
					name: fundName.get(fc) ?? fc,
					amounts: T(a),
					byFundType: { special: T(a) }
				});
			}
			const resid = sub(amt, itemized);
			fundAlloc.itemized = add(fundAlloc.itemized, itemized);
			if (kids.length && nonzero(resid, 1)) {
				residualCount++;
				fundAlloc.residual = add(fundAlloc.residual, resid);
				kids.push({
					id: `${id}/unallocated`,
					kind: 'fund',
					name: 'Other / not itemized by fund',
					amounts: T(resid),
					byFundType: { special: T(resid) },
					extra: {
						residual: true,
						note: 'Schedule 8 special-fund amount minus the sum of itemized fund condition statement lines.'
					}
				});
			} else if (!kids.length) {
				fundAlloc.residual = add(fundAlloc.residual, amt);
			}
			if (kids.length) {
				fundNodeCount += kids.length;
				n.children = kids;
			}
		}
		return n;
	};

	const groupNode = (
		g: S8Group,
		ft: FT,
		parentId: string,
		isTransfer: boolean,
		kind: BudgetNode['kind']
	): BudgetNode | null => {
		const id = `${parentId}/${g.slug}`;
		const children: BudgetNode[] = [];
		for (const s of g.sources) {
			const n = sourceNode(s, ft, id, isTransfer);
			if (n) children.push(n);
		}
		for (const sg of g.subgroups) {
			const n = groupNode(sg, ft, id, isTransfer, 'revenueCategory');
			if (n) children.push(n);
		}
		const childSum = sum(children.map((c) => c.amounts as Tri));
		const official = g.total ? pick(g.total, ft) : childSum;
		if (!nonzero(official) && !children.length) return null;
		const diff = sub(childSum, official);
		const n: BudgetNode = {
			id,
			kind,
			name: g.name,
			amounts: T(official),
			byFundType: { [ft]: T(official) },
			children: children.sort((a, b) => (b.amounts.by ?? 0) - (a.amounts.by ?? 0))
		};
		if (!g.total) warn(`no official subtotal for ${id}; using sum of lines`);
		if (nonzero(diff, 1)) {
			n.extra = {
				reconciliation: { childrenSum: T(childSum), official: T(official), difference: T(diff) }
			};
			warn(`${id}: lines sum differs from official subtotal by ${JSON.stringify(diff)}`);
		}
		recon.push({ check: `Schedule 8 lines vs printed subtotal: ${id}`, difference: T(diff) });
		return n;
	};

	const ftNode = (ft: FT): BudgetNode => {
		const id = `rev/${ft}`;
		const cats = s8.categories
			.map((c) => groupNode(c, ft, id, c.slug === 'transfers', 'revenueCategory'))
			.filter((x): x is BudgetNode => !!x);
		const official = s8.totalAll ? pick(s8.totalAll, ft) : sum(cats.map((c) => c.amounts as Tri));
		const diff = sub(sum(cats.map((c) => c.amounts as Tri)), official);
		recon.push({
			check: `Schedule 8 categories vs "TOTALS, REVENUES, TRANSFERS AND LOANS": ${id}`,
			difference: T(diff)
		});
		if (nonzero(diff, 1))
			warn(`${id}: categories differ from official total by ${JSON.stringify(diff)}`);
		const revOnly = s8.totalRevenues ? pick(s8.totalRevenues, ft) : null;
		return {
			id,
			kind: 'fundType',
			name: ft === 'general' ? 'General Fund' : 'Special Funds',
			code: ft === 'general' ? '0001' : undefined,
			amounts: T(official),
			byFundType: { [ft]: T(official) },
			children: cats,
			extra: {
				...(revOnly ? { revenuesExcludingTransfers: T(revOnly) } : {}),
				...(nonzero(diff, 1) ? { reconciliation: { difference: T(diff) } } : {})
			}
		};
	};
	const gfNode = ftNode('general');
	const sfNode = ftNode('special');
	const rootAmt = s8.totalAll?.total ?? add(gfNode.amounts as Tri, sfNode.amounts as Tri);

	// ── Cross-schedule reconciliation ───────────────────────────────────
	const official: Record<string, unknown> = {
		schedule8: {
			revenues: s8.totalRevenues && {
				general: T(s8.totalRevenues.gf),
				special: T(s8.totalRevenues.sf),
				total: T(s8.totalRevenues.total)
			},
			revenuesTransfersAndLoans: s8.totalAll && {
				general: T(s8.totalAll.gf),
				special: T(s8.totalAll.sf),
				total: T(s8.totalAll.total)
			}
		}
	};
	const cmp = (label: string, a: Tri, b: Tri, tol = 1) => {
		const d = sub(a, b);
		recon.push({ check: label, ours: T(a), theirs: T(b), difference: T(d), ok: !nonzero(d, tol) });
		if (nonzero(d, tol))
			notes.push(
				`${label}: differs by ${YRS.map((k) => `${years[k]} ${d[k].toLocaleString()}`).join(', ')} (thousands).`
			);
	};
	if (s8.totalAll)
		cmp('Schedule 8 GF+SF = total column', add(s8.totalAll.gf, s8.totalAll.sf), s8.totalAll.total);
	// Schedule 1: "Revenues and transfers" (GF, SF) for each of the 3 years
	if (s1raw) {
		const rows = s1raw.rows.filter((r) => r.toks.some((t) => /^Revenues and transfers/i.test(t.s)));
		const vals = rows.map((r) => splitRow(r, 280).vals);
		if (vals.length === 3 && vals.every((v) => v.length >= 2)) {
			const gf = { py: vals[0][0], cy: vals[1][0], by: vals[2][0] };
			const sf = { py: vals[0][1], cy: vals[1][1], by: vals[2][1] };
			official.schedule1 = { general: gf, special: sf };
			cmp(
				'Revenues tree GF total vs Schedule 1 "Revenues and transfers" (GF)',
				gfNode.amounts as Tri,
				gf
			);
			cmp(
				'Revenues tree special funds total vs Schedule 1 "Revenues and transfers" (SF)',
				sfNode.amounts as Tri,
				sf
			);
		} else warn('Schedule 1: could not locate 3 "Revenues and transfers" rows');
	}
	if (s10) {
		const gf = s10.funds.find((x) => x.code === '0001');
		const sfTot = s10.totals['special-funds'];
		if (gf)
			cmp(
				'Revenues tree GF total vs Schedule 10 General Fund revenues',
				gfNode.amounts as Tri,
				gf.revenues
			);
		if (sfTot) {
			cmp(
				'Revenues tree special funds total vs Schedule 10 "Totals, Special Funds" revenues',
				sfNode.amounts as Tri,
				sfTot.revenues
			);
			const sumFunds = sum(s10.funds.filter((x) => x.section === 'special').map((x) => x.revenues));
			cmp(
				'Schedule 10 sum of special fund rows vs "Totals, Special Funds"',
				sumFunds,
				sfTot.revenues
			);
		}
		official.schedule10 = s10.totals;
	}
	let history: unknown[] | undefined;
	if (s6raw) {
		history = s6raw.rows
			.map((r) => {
				const yr = r.toks[0]?.s;
				if (!/^\d{4}-\d{2}$/.test(yr ?? '')) return null;
				const v = splitRow({ ...r, toks: r.toks.slice(1) }, 0).vals;
				if (v.length < 8) return null;
				return {
					year: yr,
					populationThousands: v[0],
					employees: v[1],
					personalIncomeBillions: v[3],
					revenues: { general: v[4] * 1000, total: v[5] * 1000 },
					expenditures: { general: v[6] * 1000, total: v[7] * 1000 }
				};
			})
			.filter(Boolean);
		const h = history as { year: string; revenues: { general: number; total: number } }[];
		const at = (y: string) => h.find((x) => x.year === y);
		if (YRS.every((k) => at(years[k]))) {
			const gf6 = {
				py: at(years.py)!.revenues.general,
				cy: at(years.cy)!.revenues.general,
				by: at(years.by)!.revenues.general
			};
			const tot6 = {
				py: at(years.py)!.revenues.total,
				cy: at(years.cy)!.revenues.total,
				by: at(years.by)!.revenues.total
			};
			cmp(
				'Revenues tree GF total vs Schedule 6 (millions, rounded)',
				gfNode.amounts as Tri,
				gf6,
				500
			);
			cmp(
				'Revenues tree total vs Schedule 6 total revenues (millions, rounded)',
				rootAmt,
				tot6,
				500
			);
		}
	}
	// ebudget GF sankey (millions)
	const sankey = await f.api<{
		nodes: { node: number; name: string; showNegative: boolean }[];
		links: { source: number; target: number; value: number }[];
		revenueTotal: number;
		expenditureTotal: number;
		transferTotal: number;
	} | null>('sankey', null);
	if (sankey?.revenueTotal) {
		cmp(
			'Revenues tree GF total vs ebudget sankey revenueTotal (millions, rounded)',
			{ ...ZERO, by: gfNode.amounts.by! },
			{ ...ZERO, by: sankey.revenueTotal * 1000 },
			500
		);
	}

	// ── Notes ───────────────────────────────────────────────────────────
	notes.unshift(
		`Amounts are in thousands of dollars, as printed in DOF Summary Schedule 8 (${ai.publication}, ${ai.publicationDate}).`,
		'Schedule 8 covers only state funds: the General Fund and special funds. Bond fund proceeds and federal funds are not state revenues and are not in this tree; they appear in flows.json (measured by Schedule 9 expenditures).',
		'"Transfers and Loans" are net movements between the General Fund and special funds (incl. transfers to the Budget Stabilization Account); they are negative for the General Fund in some years. Treemap-style views should treat negative nodes separately.',
		`Special-fund revenue sources are broken down by fund using the departmental Fund Condition Statements published with the budget; "Other / not itemized by fund" holds any remainder vs. Schedule 8.`,
		'Ids: rev/{general|special}/{major|minor|transfers}[/{minor subcategory slug}]/{7-digit revenue code}[/{4-digit fund code}].'
	);
	if (byCode.size) {
		notes.push(
			`Per-fund itemization covers ${(fundAlloc.itemized.by / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })}M of special-fund revenues in ${years.by}; ${(fundAlloc.residual.by / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })}M is not itemized by fund (${residualCount} sources carry a residual node).`
		);
	} else
		notes.push(
			'Per-fund breakdown of special-fund revenues not available (fund condition statements not fetched or not published).'
		);

	const sources: SourceRef[] = [
		s8ref,
		...[s10raw, s1raw, s6raw].filter(Boolean).map((x) => x!.ref)
	];
	if (fcsRefs.length)
		sources.push({
			label: `ebudget Fund Condition Statements (${fcsRefs.length} departmental PDFs, e.g. ${fcsRefs[0].url.split('/').pop()})`,
			url: f.pdfRoot + 'GovernorsBudget/'
		});
	sources.push({ label: 'ebudget API: fcsCntl/fundIndex', url: f.apiUrl('fcsCntl/fundIndex') });

	// ── Other fund types (not revenues; for context) ─────────────────────
	const otherFundTypes = s9?.grandTotal
		? {
				note: 'Not state revenues. Federal funds and selected bond funds as spent per Schedule 9; shown for context and used in flows.json.',
				federal: T(s9.grandTotal.federal),
				bond: T(s9.grandTotal.bond)
			}
		: undefined;

	const root: BudgetNode = {
		id: 'rev',
		kind: 'root',
		name: 'State Revenues',
		amounts: T(rootAmt),
		byFundType: { general: gfNode.amounts, special: sfNode.amounts },
		children: [gfNode, sfNode],
		sources,
		extra: {
			fiscalYear: FY,
			pit: PIT,
			publication: ai.publication,
			publicationDate: ai.publicationDate,
			years,
			units: 'thousands',
			notes,
			officialTotals: official,
			reconciliation: recon,
			otherFundTypes,
			history,
			counts: {
				revenueSources: sourceCount,
				fundNodes: fundNodeCount,
				residualNodes: residualCount
			},
			warnings: warnings.length ? warnings : undefined,
			generatedAt: new Date().toISOString()
		}
	};

	// ── Flows ──────────────────────────────────────────────────────────
	const flows = await buildFlows({
		f,
		s8,
		s9,
		s9ref: s9raw?.ref,
		s8ref,
		sankey,
		notes: [] as string[]
	});

	// ── Write ──────────────────────────────────────────────────────────
	const outDir = path.join(args.out!, FY, PIT);
	fs.mkdirSync(outDir, { recursive: true });
	fs.writeFileSync(path.join(outDir, 'revenues.json'), JSON.stringify(root));
	fs.writeFileSync(path.join(outDir, 'flows.json'), JSON.stringify(flows));
	log(
		`  wrote ${outDir}/revenues.json: total ${fmt(rootAmt.by)} (GF ${fmt(gfNode.amounts.by!)}, SF ${fmt(sfNode.amounts.by!)}); ${sourceCount} source nodes, ${fundNodeCount} fund nodes`
	);
	log(`  wrote ${outDir}/flows.json: ${flows.nodes.length} nodes, ${flows.links.length} links`);
	const bad = recon.filter((r) => r.ok === false);
	log(
		`  reconciliation: ${recon.filter((r) => r.ok === true).length} cross-checks ok, ${bad.length} differ; ${warnings.length} warnings`
	);
	for (const b of bad) log(`    differs: ${b.check} ${JSON.stringify(b.difference)}`);
	log(`  http: ${JSON.stringify(f.stats)}`);
}

const fmt = (k: number) => `$${(k / 1e6).toFixed(2)}B`;

async function buildFlows(o: {
	f: RevFetcher;
	s8: ReturnType<typeof parseSchedule8>;
	s9: ReturnType<typeof parseSchedule9> | null;
	s9ref?: SourceRef;
	s8ref: SourceRef;
	sankey: {
		nodes: { node: number; name: string; showNegative: boolean }[];
		links: { source: number; target: number; value: number }[];
		revenueTotal: number;
		expenditureTotal: number;
		transferTotal: number;
	} | null;
	notes: string[];
}): Promise<Flows & { extra: Record<string, unknown> }> {
	const { f, s8, s9, sankey } = o;
	const notes = o.notes;
	const nodes = new Map<string, FlowNode>();
	const links: { source: string; target: string; value: number }[] = [];
	const addNode = (id: string, name: string, column: number, kind: FlowNode['kind']) => {
		if (!nodes.has(id)) nodes.set(id, { id, name, column, kind });
	};
	const link = (source: string, target: string, value: number) => {
		if (value > 0) links.push({ source, target, value });
	};
	const FTN: Record<string, string> = {
		general: 'General Fund',
		special: 'Special Funds',
		bond: 'Bond Funds (selected)',
		federal: 'Federal Funds'
	};

	// Revenue sources (col 0) -> GF / special (col 1), budget year
	const all: S8Source[] = [];
	const walk = (g: S8Group) => {
		all.push(...g.sources);
		g.subgroups.forEach(walk);
	};
	s8.categories.filter((c) => c.slug !== 'transfers').forEach(walk);
	const topN = Number(args['top-sources']);
	const ranked = all.filter((s) => s.total.by > 0).sort((a, b) => b.total.by - a.total.by);
	const top = ranked.slice(0, topN);
	const other = { gf: 0, sf: 0 };
	for (const s of all) {
		const isTop = top.includes(s);
		for (const [ft, v] of [
			['general', s.gf.by],
			['special', s.sf.by]
		] as const) {
			if (isTop && v > 0) {
				addNode(`rev/src/${s.code}`, s.name, 0, 'revenueSource');
				link(`rev/src/${s.code}`, `rev/${ft}`, v);
			} else other[ft === 'general' ? 'gf' : 'sf'] += v;
		}
	}
	addNode('rev/src/other', 'All other revenues', 0, 'revenueSource');
	link('rev/src/other', 'rev/general', other.gf);
	link('rev/src/other', 'rev/special', other.sf);
	if (other.gf < 0 || other.sf < 0)
		notes.push('Aggregated "All other revenues" is negative for a fund type and was omitted.');

	// Transfers and loans (net, budget year)
	const xfer = s8.categories.find((c) => c.slug === 'transfers')?.total;
	if (xfer) {
		for (const [ft, v] of [
			['general', xfer.gf.by],
			['special', xfer.sf.by]
		] as const) {
			if (v > 0) {
				addNode(
					'rev/src/transfers',
					'Transfers & loans from other funds (net)',
					0,
					'revenueSource'
				);
				link('rev/src/transfers', `rev/${ft}`, v);
			} else if (v < 0) {
				addNode(
					'flow/out/transfers',
					'Transfers & loans to other funds and reserves (net)',
					2,
					'other'
				);
				link(`rev/${ft}`, 'flow/out/transfers', -v);
			}
		}
	}

	// Fund types (col 1) -> agencies (col 2), from Schedule 9
	const agencyMap = new Map<string, string>(); // normalized name -> orgAgencyCd
	const agencyName = new Map<string, string>();
	const depts = await f.api<{ orgCd: string; orgAgencyCd: string }[]>('org/deptIndex', []);
	const agencyCds = [...new Set(depts.map((d) => d.orgAgencyCd))];
	for (const cd of agencyCds) {
		const org = await f.api<{ webTitl?: string; legalTitl?: string } | null>(`org/${cd}`, null);
		const nm = org?.webTitl ?? org?.legalTitl;
		if (nm) {
			agencyMap.set(
				nm
					.toUpperCase()
					.replace(/[^A-Z0-9]+/g, ' ')
					.trim(),
				cd
			);
			agencyName.set(cd, nm);
		}
	}
	const deptAgency = new Map(depts.map((d) => [d.orgCd, d.orgAgencyCd]));
	const unmapped: string[] = [];
	const ftOut: Record<string, number> = { general: 0, special: 0, bond: 0, federal: 0 };
	for (const ag of s9?.agencies ?? []) {
		if (!ag.totals) continue;
		let cd = agencyMap.get(
			ag.name
				.toUpperCase()
				.replace(/[^A-Z0-9]+/g, ' ')
				.trim()
		);
		if (!cd) {
			const votes = new Map<string, number>();
			for (const d of ag.deptCodes) {
				const a = deptAgency.get(d);
				if (a) votes.set(a, (votes.get(a) ?? 0) + 1);
			}
			cd = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
		}
		const id = cd
			? `exp/${cd}`
			: `exp/schedule9/${ag.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
		if (!cd) unmapped.push(ag.name);
		addNode(id, (cd && agencyName.get(cd)) ?? ag.name, 2, 'agency');
		for (const [ft, t] of [
			['general', ag.totals.gf],
			['special', ag.totals.sf],
			['bond', ag.totals.bond],
			['federal', ag.totals.federal]
		] as const) {
			if (t.by < 0)
				notes.push(`${ag.name}: negative ${FTN[ft]} expenditures (${t.by}) omitted from flows.`);
			if (t.by > 0) {
				addNode(`rev/${ft}`, FTN[ft], 1, 'fundType');
				link(`rev/${ft}`, id, t.by);
				ftOut[ft] += t.by;
			}
		}
	}
	if (unmapped.length)
		notes.push(
			`Schedule 9 sections not matched to an ebudget agency code: ${unmapped.join('; ')}.`
		);
	addNode('rev/general', FTN.general, 1, 'fundType');
	addNode('rev/special', FTN.special, 1, 'fundType');

	// Federal & bond: pass-through sources
	if (ftOut.federal > 0) {
		addNode('rev/src/federal', 'Federal funds', 0, 'revenueSource');
		link('rev/src/federal', 'rev/federal', ftOut.federal);
	}
	if (ftOut.bond > 0) {
		addNode('rev/src/bond', 'Bond proceeds (selected bond funds)', 0, 'revenueSource');
		link('rev/src/bond', 'rev/bond', ftOut.bond);
	}

	// Balance each fund type with fund-balance draws / additions
	const balance: Record<string, number> = {};
	for (const ft of ['general', 'special']) {
		const id = `rev/${ft}`;
		const inflow = links.filter((l) => l.target === id).reduce((a, l) => a + l.value, 0);
		const outflow = links.filter((l) => l.source === id).reduce((a, l) => a + l.value, 0);
		const d = inflow - outflow;
		balance[ft] = d;
		if (d < 0) {
			addNode('rev/src/balance', 'Drawn from fund balances & reserves', 0, 'other');
			link('rev/src/balance', id, -d);
		} else if (d > 0) {
			addNode('flow/out/balance', 'Added to fund balances & reserves', 2, 'other');
			link(id, 'flow/out/balance', d);
		}
	}

	// Reference: official ebudget GF sankey, converted to thousands
	const ebudgetGf = sankey
		? {
				note: 'Official ebudget.ca.gov General Fund sankey (budget year), converted from millions to thousands. Negative-flagged nodes are deductions.',
				revenueTotal: sankey.revenueTotal * 1000,
				expenditureTotal: sankey.expenditureTotal * 1000,
				transferTotal: sankey.transferTotal * 1000,
				nodes: sankey.nodes.map((n) => ({ name: n.name, negative: n.showNegative })),
				links: sankey.links.map((l) => ({
					source: l.source,
					target: l.target,
					value: l.value * 1000
				}))
			}
		: undefined;
	if (s9?.grandTotal) {
		const g = s9.grandTotal;
		for (const [ft, v] of [
			['general', g.gf.by],
			['special', g.sf.by],
			['bond', g.bond.by],
			['federal', g.federal.by]
		] as const) {
			if (Math.abs(ftOut[ft] - v) > 1)
				notes.push(`${FTN[ft]}: agency links sum ${ftOut[ft]} vs Schedule 9 grand total ${v}.`);
		}
	}
	if (
		sankey &&
		s9?.grandTotal &&
		Math.abs(sankey.expenditureTotal * 1000 - s9.grandTotal.gf.by) > 1000
	)
		notes.push(
			`GF expenditures: ebudget sankey ${sankey.expenditureTotal}M vs Schedule 9 ${s9.grandTotal.gf.by}K.`
		);

	const srcs: SourceRef[] = [o.s8ref];
	if (o.s9ref) srcs.push(o.s9ref);
	srcs.push({ label: 'ebudget API: sankey (General Fund)', url: f.apiUrl('sankey') });
	srcs.push({ label: 'ebudget API: org/deptIndex + org/{agency}', url: f.apiUrl('org/deptIndex') });
	return {
		year: 'by',
		nodes: [...nodes.values()].sort((a, b) => a.column - b.column),
		links,
		sources: srcs,
		extra: {
			units: 'thousands',
			fiscalYear: FY,
			pit: PIT,
			notes: [
				'Columns: 0 = revenue sources (top Schedule 8 sources by all-fund amount, rest aggregated; plus federal funds, bond proceeds and fund-balance draws), 1 = fund types, 2 = agencies (ids match expenditures.json exp/{agencyCode}).',
				'General Fund and special fund inflows are Schedule 8 revenues; outflows are Schedule 9 expenditures by agency. Net transfers and changes in fund balance close the gap so each fund-type node balances.',
				'Federal and bond fund inflows are measured by their Schedule 9 expenditures (no revenue schedule exists for them).',
				...notes
			],
			fundTypeBalance: balance,
			ebudgetGeneralFundSankey: ebudgetGf
		}
	};
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
