/**
 * Spending by type ETL: every dollar of spending regrouped by what it pays for.
 *
 *   node scripts/etl/bytype.ts --fy 2026-27 --pit e [--refresh] [--out static/data]
 *
 * Input: the expenditure ETL's output (expenditures.json + departments/*.json). Each
 * department's program tree ends in one row per fund, and each fund row carries its split by
 * character (state operations / local assistance / capital outlay). Those rows are on the same
 * net basis as the headline total (reimbursements and nongovernmental cost funds excluded).
 * Every row is classified by the ordered rules in lib/spend-types.ts.
 *
 * Output: static/data/{fy}/{pit}/bytype.json, a BudgetNode tree
 *   type -> group (K-12 schools, Health care...) -> type of payment -> department -> program
 * whose root equals the expenditure tree's total. As a cross-check, character totals are
 * compared with DOF Summary Schedule 9 (cached under data-raw/{fy}/{pit}/rev/).
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { RevFetcher } from './lib/rev-fetch.ts';
import { readRows } from './lib/rev-pdf.ts';
import { parseSchedule9, type S9Character } from './lib/rev-parse.ts';
import { GROUPS, RULES, classify, describeRule, type Character } from './lib/spend-types.ts';
import type {
	BudgetNode,
	DepartmentDetail,
	FundType,
	SourceRef,
	Triple
} from '../../src/lib/data/schema.ts';

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
const OUT = path.join(args.out!, FY, PIT);
const YK = ['py', 'cy', 'by'] as const;

const warnings: string[] = [];
const warn = (m: string) => {
	warnings.push(m);
	console.warn('  ! ' + m);
};

const CHAR_OF: Record<string, Character> = {
	'State Operations': 'so',
	'Local Assistance': 'la',
	'Capital Outlay': 'co'
};
export const CHAR_LABEL: Record<Character, string> = {
	so: 'State operations',
	la: 'Local assistance',
	co: 'Capital outlay',
	unknown: 'Not split by character'
};

const zero = (): Triple => ({ py: 0, cy: 0, by: 0 });
const add = (a: Triple, b: Triple, k = 1) => {
	for (const y of YK) a[y] = (a[y] ?? 0) + (b[y] ?? 0) * k;
};
const sub = (a: Triple, b: Triple): Triple => ({
	py: (a.py ?? 0) - (b.py ?? 0),
	cy: (a.cy ?? 0) - (b.cy ?? 0),
	by: (a.by ?? 0) - (b.by ?? 0)
});
const nonzero = (t: Triple) => YK.some((y) => Math.abs(t[y] ?? 0) > 0.5);
const fmtK = (k: number) => `$${Math.round(k).toLocaleString('en-US')}K`;
const slug = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 60);

/** One classified amount: a department program's money from one fund type, of one character. */
interface Row {
	dept: BudgetNode;
	agency: BudgetNode;
	/** program/subprogram node the row belongs to (the fund row's parent, or a fundless leaf) */
	prog: BudgetNode;
	path: string;
	fundType: FundType | null;
	char: Character;
	amounts: Triple;
}

function rowsOf(agency: BudgetNode, dept: BudgetNode, detail: DepartmentDetail | null): Row[] {
	const rows: Row[] = [];
	if (!detail) {
		// no detail file: the department node itself is the only row
		for (const [ft, t] of Object.entries(dept.byFundType ?? {}) as [FundType, Triple][])
			if (nonzero(t))
				rows.push({
					dept,
					agency,
					prog: dept,
					path: dept.name,
					fundType: ft,
					char: 'unknown',
					amounts: { ...t }
				});
		const rest = sub(
			dept.amounts,
			rows.reduce((s, r) => (add(s, r.amounts), s), zero())
		);
		if (nonzero(rest))
			rows.push({
				dept,
				agency,
				prog: dept,
				path: dept.name,
				fundType: null,
				char: 'unknown',
				amounts: rest
			});
		return rows;
	}
	const fundless: { prog: BudgetNode; path: string }[] = [];
	const walk = (n: BudgetNode, names: string[]) => {
		const kids = n.children ?? [];
		if (n !== detail.programs && !kids.length) {
			fundless.push({ prog: n, path: names.join(' > ') });
			return;
		}
		for (const c of kids) {
			if (c.kind !== 'fund') {
				walk(c, [...names, c.name]);
				continue;
			}
			const ft = (c.extra?.fundType as FundType | undefined) ?? null;
			const at = (c.extra?.byAppropriationType ?? {}) as Record<string, Triple>;
			const split = zero();
			for (const [k, t] of Object.entries(at)) {
				const ch = CHAR_OF[k];
				if (!ch) {
					warn(`${dept.code} ${names.join(' > ')}: unknown appropriation type "${k}"`);
					continue;
				}
				add(split, t);
				if (nonzero(t))
					rows.push({
						dept,
						agency,
						prog: n,
						path: names.join(' > '),
						fundType: ft,
						char: ch,
						amounts: { ...t }
					});
			}
			const rest = sub(c.amounts, split);
			if (nonzero(rest))
				rows.push({
					dept,
					agency,
					prog: n,
					path: names.join(' > '),
					fundType: ft,
					char: 'unknown',
					amounts: rest
				});
		}
	};
	walk(detail.programs, []);

	// fundless leaves (e.g. bond debt service, realignment subaccounts, residual adjustments):
	// their fund types are whatever the department's fund breakdown has left over
	if (fundless.length) {
		const used: Partial<Record<FundType, Triple>> = {};
		for (const r of rows) if (r.fundType) add((used[r.fundType] ??= zero()), r.amounts);
		const left = Object.entries(dept.byFundType ?? {})
			.map(([ft, t]) => [ft as FundType, sub(t, used[ft as FundType] ?? zero())] as const)
			.filter(([, t]) => nonzero(t));
		const leftTotal = left.reduce((s, [, t]) => (add(s, t), s), zero());
		for (const { prog, path: p } of fundless) {
			if (!nonzero(prog.amounts)) continue;
			if (!left.length) {
				rows.push({
					dept,
					agency,
					prog,
					path: p,
					fundType: null,
					char: 'unknown',
					amounts: { ...prog.amounts }
				});
				continue;
			}
			for (const [ft, t] of left) {
				const share: Triple = zero();
				for (const y of YK) {
					const lt = leftTotal[y] ?? 0;
					share[y] = lt
						? ((t[y] ?? 0) / lt) * (prog.amounts[y] ?? 0)
						: left.length === 1
							? (prog.amounts[y] ?? 0)
							: 0;
				}
				if (nonzero(share))
					rows.push({ dept, agency, prog, path: p, fundType: ft, char: 'unknown', amounts: share });
			}
		}
	}
	// every department must add up to its total; where the printed program detail and the
	// department total disagree (documented on the reconciliation page), keep an explicit row
	const rest = sub(
		dept.amounts,
		rows.reduce((s, r) => (add(s, r.amounts), s), zero())
	);
	if (YK.some((y) => Math.abs(rest[y] ?? 0) > 2)) {
		console.log(
			`  ~ ${dept.code} ${dept.name}: program detail differs from department total by ${YK.map((y) => `${y} ${fmtK(rest[y] ?? 0)}`).join(', ')}`
		);
		const prog: BudgetNode = {
			id: `${dept.id}/adjustment`,
			kind: 'other',
			name: 'Difference between program detail and department total',
			amounts: rest
		};
		rows.push({
			dept,
			agency,
			prog,
			path: prog.name,
			fundType: null,
			char: 'unknown',
			amounts: rest
		});
	}
	return rows;
}

function rollUp(n: BudgetNode) {
	if (!n.children?.length) return n;
	n.children.forEach(rollUp);
	n.children = n.children.filter((c) => nonzero(c.amounts));
	n.children.sort((a, b) => (b.amounts.by ?? 0) - (a.amounts.by ?? 0));
	n.amounts = zero();
	n.byFundType = {};
	const bc: Partial<Record<Character, Triple>> = {};
	for (const c of n.children) {
		add(n.amounts, c.amounts);
		for (const [ft, t] of Object.entries(c.byFundType ?? {}) as [FundType, Triple][])
			add((n.byFundType[ft] ??= zero()), t);
		for (const [ch, t] of Object.entries(c.extra?.byCharacter ?? {}) as [Character, Triple][])
			add((bc[ch] ??= zero()), t);
	}
	n.extra = { ...n.extra, byCharacter: bc };
	return n;
}

async function main() {
	console.log(`spending-by-type ETL ${FY}/${PIT}`);
	const read = <T>(f: string): T => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
	if (!fs.existsSync(path.join(OUT, 'expenditures.json')))
		throw new Error(`${OUT}/expenditures.json not found — run "npm run etl:exp" first`);
	const exp = read<BudgetNode>('expenditures.json');

	// ---- DOF Schedule 9: character split by department (used for rows the program detail
	// does not split, and as a cross-check)
	let s9: ReturnType<typeof parseSchedule9> | null = null;
	let s9src: SourceRef | null = null;
	try {
		const f = await new RevFetcher(FY, PIT, { rawRoot: args.raw, refresh: args.refresh }).init();
		const url = f.summaryPdfUrl('BS_SCH9.pdf');
		const buf = await f.pdf(url);
		if (buf) {
			s9 = parseSchedule9(await readRows(buf), warn);
			s9src = {
				label: `DOF Summary Schedule 9 — Comparative Statement of Expenditures (${f.appInfo.publication})`,
				url
			};
		} else warn(`Schedule 9 not published: ${url}`);
	} catch (e) {
		warn(`Schedule 9 unavailable: ${(e as Error).message}`);
	}
	const s9Dept = new Map<string, Record<Character, Triple>>();
	for (const ag of s9?.agencies ?? [])
		for (const d of ag.depts) {
			const c: Record<Character, Triple> = { so: zero(), la: zero(), co: zero(), unknown: zero() };
			for (const [k, a] of Object.entries(d.byCharacter) as [S9Character, typeof d.totals][])
				for (const col of ['gf', 'sf', 'bond', 'federal'] as const) add(c[CHAR_OF[k]], a[col]);
			s9Dept.set(d.code, c);
		}

	/** Split a department's rows that have no character into the character Schedule 9 leaves over. */
	const splitUnknown = (dept: BudgetNode, rs: Row[]): Row[] => {
		const s9c = s9Dept.get(dept.code!);
		const unknown = rs.filter((r) => r.char === 'unknown');
		if (!s9c || !unknown.length) return rs;
		const known = rs.filter((r) => r.char !== 'unknown');
		const left = (['so', 'la', 'co'] as const).map((ch) => {
			const t = { ...s9c[ch] };
			for (const r of known) if (r.char === ch) add(t, r.amounts, -1);
			return [ch, t] as const;
		});
		const out = [...known];
		for (const r of unknown)
			for (const y of YK) {
				// shares by year from the leftover; only positive leftovers absorb the row
				const pos = left.map(([ch, t]) => [ch, Math.max(0, t[y] ?? 0)] as const);
				const tot = pos.reduce((s, [, v]) => s + v, 0);
				if (!tot) {
					pushPart(out, r, 'unknown', y, r.amounts[y] ?? 0);
					continue;
				}
				for (const [ch, v] of pos) if (v) pushPart(out, r, ch, y, ((r.amounts[y] ?? 0) * v) / tot);
			}
		return out;
	};
	const pushPart = (out: Row[], r: Row, ch: Character, y: (typeof YK)[number], v: number) => {
		let p = out.find(
			(x) =>
				x.prog === r.prog &&
				x.fundType === r.fundType &&
				x.char === ch &&
				x !== r &&
				(x as Row & { from?: Row }).from === r
		);
		if (!p) {
			p = Object.assign({ ...r, char: ch, amounts: zero() }, { from: r });
			out.push(p);
		}
		p.amounts[y] = (p.amounts[y] ?? 0) + v;
	};

	// ---- rows
	const rows: Row[] = [];
	for (const agency of exp.children ?? [])
		for (const dept of agency.children ?? []) {
			if (!nonzero(dept.amounts)) continue;
			const file = dept.detailRef && path.join(OUT, 'departments', `${dept.detailRef}.json`);
			const detail =
				file && fs.existsSync(file)
					? (JSON.parse(fs.readFileSync(file, 'utf8')) as DepartmentDetail)
					: null;
			rows.push(...splitUnknown(dept, rowsOf(agency, dept, detail)));
		}

	// ---- classify + build the tree
	const ruleUse = new Map<number, Triple>();
	const root: BudgetNode = {
		id: 'type',
		kind: 'root',
		name: 'Spending by type',
		description:
			'Every dollar of state spending (General, special, bond and federal funds) grouped by what it pays for. Each department program is assigned to one type of payment, so nothing is counted twice and the total matches the agency view. The grouping is this explorer’s, built on the official program structure; open any program to see the rule that placed it.',
		amounts: zero(),
		children: GROUPS.map((g) => ({
			id: `type/${g.id}`,
			kind: 'category',
			name: g.name,
			description: g.description,
			amounts: zero(),
			children: g.types.map((t) => ({
				id: `type/${g.id}/${t.id}`,
				kind: 'category',
				name: t.name,
				description: t.description,
				amounts: zero(),
				children: []
			}))
		}))
	};
	const typeNode = new Map<string, BudgetNode>();
	for (const g of root.children!)
		for (const t of g.children!) typeNode.set(t.id.slice('type/'.length), t);
	for (const rule of RULES)
		if (!typeNode.has(rule.to)) throw new Error(`rule target "${rule.to}" is not a defined type`);

	const unmatched: Row[] = [];
	for (const row of rows) {
		const i = classify({
			dept: row.dept.code!,
			agency: row.agency.code!,
			path: row.path,
			char: row.char
		});
		if (i < 0) {
			unmatched.push(row);
			continue;
		}
		add(ruleUse.get(i) ?? (ruleUse.set(i, zero()), ruleUse.get(i)!), row.amounts);
		const t = typeNode.get(RULES[i].to)!;
		let dn = t.children!.find((c) => c.code === row.dept.code);
		if (!dn) {
			dn = {
				id: `${t.id}/${row.dept.code}`,
				kind: 'department',
				name: row.dept.name,
				code: row.dept.code,
				shortName: row.dept.shortName,
				amounts: zero(),
				detailRef: row.dept.detailRef,
				children: [],
				// the department's full program tree mixes types: never graft it here
				extra: { noGraft: true, agency: row.agency.name }
			};
			t.children!.push(dn);
		}
		const progSeg = row.prog === row.dept ? 'all' : (row.prog.code ?? slug(row.prog.name));
		let pn = dn.children!.find((c) => c.id === `${dn.id}/${progSeg}`);
		if (!pn) {
			pn = {
				id: `${dn.id}/${progSeg}`,
				kind: row.prog === row.dept ? 'department' : row.prog.kind,
				name: row.prog === row.dept ? row.dept.name : row.prog.name,
				code: row.prog.code,
				amounts: zero(),
				byFundType: {},
				detailRef: row.dept.detailRef,
				sources: row.dept.sources,
				extra: {
					noGraft: true,
					focus: row.prog === row.dept ? undefined : row.prog.id,
					programPath: row.path,
					rule: describeRule(i),
					byCharacter: {}
				}
			};
			dn.children!.push(pn);
		}
		add(pn.amounts, row.amounts);
		if (row.fundType) add((pn.byFundType![row.fundType] ??= zero()), row.amounts);
		const bc = pn.extra!.byCharacter as Partial<Record<Character, Triple>>;
		add((bc[row.char] ??= zero()), row.amounts);
	}
	for (const u of unmatched)
		warn(
			`unclassified: ${u.dept.code} ${u.dept.name} | ${u.path} (${u.char}) ${fmtK(u.amounts.by ?? 0)}`
		);
	// leaves: rollUp only touches nodes with children, so set leaf byCharacter/byFundType as built
	rollUp(root);
	const emptyTypes = [...typeNode].filter(([, t]) => !t.children?.length).map(([k]) => k);
	root.children = root.children!.filter((g) => g.children?.length);

	// ---- validation
	for (const y of YK) {
		const d = (root.amounts[y] ?? 0) - (exp.amounts[y] ?? 0);
		const line = `${y}: by type ${fmtK(root.amounts[y] ?? 0)} vs. expenditures ${fmtK(exp.amounts[y] ?? 0)} (diff ${fmtK(d)})`;
		if (Math.abs(d) > 5) warn(line);
		else console.log('  ' + line);
	}
	const unused = RULES.map((_, i) => i).filter((i) => !ruleUse.has(i));
	if (unused.length)
		console.log(`  rules that matched nothing: ${unused.map(describeRule).join(' | ')}`);
	if (emptyTypes.length) console.log(`  types with no spending: ${emptyTypes.join(', ')}`);

	// cross-check: character totals vs. DOF Schedule 9 (rows not split by character are listed)
	const notes: string[] = [
		'The grouping is this explorer’s, not an official classification: the budget reports spending by department, program and fund, and almost all payments to local governments, schools and providers share one object-of-expenditure code (“Grants and Subventions”). Each program row is assigned by an explicit rule (shown with every program), so the groups add up exactly to the total.'
	];
	const bc = root.extra!.byCharacter as Partial<Record<Character, Triple>>;
	if (s9) {
		const tot: Record<Character, Triple> = { so: zero(), la: zero(), co: zero(), unknown: zero() };
		for (const c of s9Dept.values())
			for (const ch of ['so', 'la', 'co'] as const) add(tot[ch], c[ch]);
		for (const ch of ['so', 'la', 'co'] as const)
			console.log(
				`  ${CHAR_LABEL[ch]} (by): rows ${fmtK(bc[ch]?.by ?? 0)} vs. Schedule 9 ${fmtK(tot[ch].by ?? 0)}`
			);
		root.sources = [s9src!];
	}
	console.log(`  not split by character (by): ${fmtK(bc.unknown?.by ?? 0)}`);
	root.extra = { ...root.extra, notes, warnings };

	// ---- summary
	for (const g of root.children!) {
		console.log(`  ${(g.amounts.by! / 1e6).toFixed(1).padStart(6)}B ${g.name}`);
		for (const t of g.children!)
			console.log(`         ${(t.amounts.by! / 1e6).toFixed(2).padStart(7)}B ${t.name}`);
	}
	fs.writeFileSync(path.join(OUT, 'bytype.json'), JSON.stringify(root));
	console.log(
		`  wrote ${path.join(OUT, 'bytype.json')} (${rows.length} rows, ${warnings.length} warnings)`
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
