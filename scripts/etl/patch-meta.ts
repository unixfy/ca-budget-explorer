/**
 * Post-ETL step: merge revenue results into the expenditure ETL's meta.json / search.json.
 *
 *   node scripts/etl/patch-meta.ts --fy 2026-27 --pit e [--out static/data]
 *
 * - meta.json: sets totals.revenues / totals.revenuesByFundType from revenues.json, adds
 *   revenue source refs (deduped by url) and revenue notes (prefixed "Revenues: ", replaced
 *   on each run).
 * - search.json: removes every entry with tree === 'revenues', then appends one entry per
 *   revenue node (idempotent).
 * Missing meta.json / search.json are skipped with a warning.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { BudgetNode, DatasetMeta, SearchEntry } from '../../src/lib/data/schema.ts';

const { values: args } = parseArgs({
	options: {
		fy: { type: 'string', default: '2026-27' },
		pit: { type: 'string', default: 'e' },
		out: { type: 'string', default: 'static/data' }
	}
});
const dir = path.join(args.out!, args.fy!, args.pit!);
const revFile = path.join(dir, 'revenues.json');
if (!fs.existsSync(revFile)) {
	console.error(`patch-meta: ${revFile} not found — run "npm run etl:rev" first.`);
	process.exit(1);
}
const rev: BudgetNode = JSON.parse(fs.readFileSync(revFile, 'utf8'));
const writeJson = (file: string, data: unknown) => {
	const tmp = file + '.tmp';
	fs.writeFileSync(tmp, JSON.stringify(data));
	fs.renameSync(tmp, file);
};

// ── meta.json ──
const metaFile = path.join(dir, 'meta.json');
if (!fs.existsSync(metaFile)) {
	console.warn(
		`patch-meta: ${metaFile} not found — skipping meta (run the expenditure ETL first).`
	);
} else {
	const meta: DatasetMeta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
	meta.totals ??= {} as DatasetMeta['totals'];
	meta.totals.revenues = rev.amounts;
	meta.totals.revenuesByFundType = rev.byFundType ?? {};
	const urls = new Set((meta.sources ?? []).map((s) => s.url));
	meta.sources = [...(meta.sources ?? []), ...(rev.sources ?? []).filter((s) => !urls.has(s.url))];
	const revNotes = ((rev.extra?.notes as string[]) ?? []).map((n) => `Revenues: ${n}`);
	meta.notes = [...(meta.notes ?? []).filter((n) => !n.startsWith('Revenues: ')), ...revNotes];
	writeJson(metaFile, meta);
	console.log(`patch-meta: updated ${metaFile} (revenues by = ${rev.amounts.by})`);
}

// ── search.json ──
const searchFile = path.join(dir, 'search.json');
if (!fs.existsSync(searchFile)) {
	console.warn(`patch-meta: ${searchFile} not found — skipping search index.`);
} else {
	const search: SearchEntry[] = JSON.parse(fs.readFileSync(searchFile, 'utf8'));
	const kept = search.filter((e) => e.tree !== 'revenues');
	const added: SearchEntry[] = [];
	const walk = (n: BudgetNode, trail: string[]) => {
		if (n.kind !== 'root' && !n.extra?.residual)
			added.push({
				id: n.id,
				name: n.name,
				kind: n.kind,
				...(n.code ? { code: n.code } : {}),
				path: trail,
				by: n.amounts.by,
				tree: 'revenues'
			});
		for (const c of n.children ?? []) walk(c, [...trail, n.name]);
	};
	walk(rev, []);
	writeJson(searchFile, [...kept, ...added]);
	console.log(
		`patch-meta: ${searchFile}: ${kept.length} existing + ${added.length} revenue entries`
	);
}
