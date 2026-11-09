/* eslint-disable @typescript-eslint/no-explicit-any -- pdfjs-dist dynamic import is untyped here */
/**
 * Minimal PDF table reader on top of pdfjs-dist: turns each page into visual rows of
 * positioned text tokens, plus helpers to parse DOF-style numbers ("$ 1,234", "-", "- $5").
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export interface Tok {
	x: number;
	/** right edge (x + width) */
	r: number;
	s: string;
}
export interface Row {
	page: number;
	y: number;
	toks: Tok[];
}

let pdfjsP: Promise<any> | null = null;
function pdfjs() {
	pdfjsP ??= import(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
	return pdfjsP;
}

/** Read every page into rows (top-to-bottom), tokens sorted left-to-right. */
export async function readRows(buf: Buffer, yTol = 2.5): Promise<Row[]> {
	const lib = await pdfjs();
	const task = lib.getDocument({ data: new Uint8Array(buf), verbosity: 0, isEvalSupported: false });
	const doc = await task.promise;
	const out: Row[] = [];
	for (let p = 1; p <= doc.numPages; p++) {
		const page = await doc.getPage(p);
		const tc = await page.getTextContent();
		const items: { x: number; y: number; r: number; s: string }[] = [];
		for (const it of tc.items as any[]) {
			const s = (it.str ?? '').replace(/\s+/g, ' ').trim();
			if (!s) continue;
			const x = it.transform[4];
			items.push({ x, y: it.transform[5], r: x + (it.width ?? 0), s });
		}
		items.sort((a, b) => b.y - a.y || a.x - b.x);
		const rows: Row[] = [];
		for (const it of items) {
			const row = rows.find((rw) => Math.abs(rw.y - it.y) <= yTol);
			if (row) row.toks.push({ x: it.x, r: it.r, s: it.s });
			else rows.push({ page: p, y: it.y, toks: [{ x: it.x, r: it.r, s: it.s }] });
		}
		rows.sort((a, b) => b.y - a.y);
		for (const rw of rows) rw.toks.sort((a, b) => a.x - b.x);
		out.push(...rows);
		page.cleanup();
	}
	await task.destroy();
	return out;
}

/** Parse a DOF amount token. Dashes mean zero. Returns undefined if not numeric. */
export function parseAmount(s: string): number | undefined {
	const t = s.replace(/[$,\s]/g, '');
	if (/^-+$/.test(t) || t === '') return s.includes('-') ? 0 : undefined;
	if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
	if (/^\(\d+(\.\d+)?\)$/.test(t)) return -Number(t.slice(1, -1));
	return undefined;
}

export const isAmount = (s: string) => parseAmount(s) !== undefined;

/**
 * Split a row into label text (tokens left of `minX` or non-numeric) and numeric values
 * (tokens at/after `minX`). Adjacent dash tokens (the PDFs draw "-" twice, or "$ -" + "-")
 * are merged into a single zero.
 */
export function splitRow(
	row: Row,
	minX: number
): { label: string; vals: number[]; valToks: Tok[] } {
	const label: string[] = [];
	const valToks: Tok[] = [];
	const vals: number[] = [];
	let prevDash: Tok | null = null;
	for (const t of row.toks) {
		const v = t.x >= minX ? parseAmount(t.s) : undefined;
		if (v === undefined) {
			if (t.x < minX && isAmount(t.s) && /^[-$\s]+$/.test(t.s)) continue; // stray dash in label zone
			label.push(t.s);
			prevDash = null;
			continue;
		}
		const isDash = /^[$\s-]+$/.test(t.s);
		if (isDash && prevDash && t.x - prevDash.r < 12) {
			prevDash = null;
			continue;
		}
		vals.push(v);
		valToks.push(t);
		prevDash = isDash ? t : null;
	}
	return { label: label.join(' ').replace(/\s+/g, ' ').trim(), vals, valToks };
}

export const isUpper = (s: string) => /[A-Z]/.test(s) && s === s.toUpperCase();

const SMALL = new Set(['and', 'of', 'the', 'to', 'for', 'from', 'in', 'on', 'or', 'a', 'an', 'by']);
export function titleCase(s: string) {
	return s
		.toLowerCase()
		.split(/\s+/)
		.map((w, i) => (i > 0 && SMALL.has(w) ? w : w.replace(/^[a-z(]/, (c) => c.toUpperCase())))
		.join(' ')
		.replace(/\bK-12\b/i, 'K-12');
}

export function slugify(s: string) {
	return s
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}
