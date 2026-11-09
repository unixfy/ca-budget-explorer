/**
 * Pure helpers for the sources-catalog tree: subtree aggregates, format colours and labels.
 * No DOM access: safe to import anywhere.
 */
import type { CatalogFormat, CatalogNode, Product } from '#lib/data/sources-catalog.ts';
import { CATEGORICAL, OTHER, type Mode } from './palette.ts';

export interface Agg {
	/** Documents represented (series count, or 1 per leaf). */
	docs: number;
	docsUsed: number;
	files: number;
	bytes: number;
	pages: number;
	/** Citations per product in the subtree. */
	backs: Partial<Record<Product, number>>;
	feeds: Set<Product>;
	/** Documents per format in the subtree (for the dominant colour). */
	formats: Map<CatalogFormat, number>;
	pain: Set<string>;
	used: boolean;
	unverified: number;
}

/** Aggregate every node's subtree once. */
export function aggregate(root: CatalogNode): Map<string, Agg> {
	const out = new Map<string, Agg>();
	const go = (n: CatalogNode): Agg => {
		const a: Agg = {
			docs: 0,
			docsUsed: 0,
			files: n.files ?? 0,
			bytes: n.bytes ?? 0,
			pages: n.pages ?? 0,
			backs: { ...(n.backs ?? {}) },
			feeds: new Set(n.used ? (n.feeds ?? []) : []),
			formats: new Map(),
			pain: new Set(n.pain ?? []),
			used: n.used,
			unverified: n.verified === false ? 1 : 0
		};
		for (const p of Object.keys(a.backs) as Product[]) if (n.used) a.feeds.add(p);
		if (!n.children?.length) {
			const d = n.count ?? 1;
			a.docs = d;
			a.docsUsed = n.used ? (n.files ?? d) : 0;
			for (const f of n.formats ?? []) a.formats.set(f, (a.formats.get(f) ?? 0) + d);
		} else {
			// a group's own files (rare) are kept; children add theirs
			for (const c of n.children) {
				const ca = go(c);
				a.docs += ca.docs;
				a.docsUsed += ca.docsUsed;
				a.files += ca.files;
				a.bytes += ca.bytes;
				a.pages += ca.pages;
				a.unverified += ca.unverified;
				for (const [k, v] of Object.entries(ca.backs) as [Product, number][])
					a.backs[k] = (a.backs[k] ?? 0) + v;
				ca.feeds.forEach((f) => a.feeds.add(f));
				ca.pain.forEach((p) => a.pain.add(p));
				for (const [f, v] of ca.formats) a.formats.set(f, (a.formats.get(f) ?? 0) + v);
			}
			if (!a.formats.size) for (const f of n.formats ?? []) a.formats.set(f, 1);
		}
		out.set(n.id, a);
		return a;
	};
	go(root);
	return out;
}

/** Fixed format → categorical slot (colour follows the format, never its rank). */
export const FORMAT_SLOT: Record<CatalogFormat, number> = {
	JSON: 0,
	PDF: 1,
	HTML: 2,
	PNG: 3,
	XLSX: 4,
	CSV: 6,
	DOCX: 7
};
export const FORMAT_LABEL: Record<CatalogFormat, string> = {
	JSON: 'JSON (API)',
	PDF: 'PDF',
	HTML: 'Web page',
	PNG: 'Image only',
	XLSX: 'Spreadsheet',
	CSV: 'CSV',
	DOCX: 'Word'
};
export const formatColor = (f: CatalogFormat | undefined, mode: Mode) =>
	f ? (CATEGORICAL[mode][FORMAT_SLOT[f]] ?? OTHER[mode]) : OTHER[mode];

/** Dominant format of a subtree; an image-only document wins over the PDF wrapping it. */
export function dominantFormat(n: CatalogNode, a: Agg | undefined): CatalogFormat | undefined {
	if (n.formats?.includes('PNG')) return 'PNG';
	let best: CatalogFormat | undefined;
	let bv = -1;
	for (const [f, v] of a?.formats ?? []) if (v > bv) [best, bv] = [f, v];
	return best ?? n.formats?.[0];
}

export const PRODUCT_LABEL: Record<Product, string> = {
	meta: 'Overview & totals',
	expenditures: 'Spending tree',
	departments: 'Department pages',
	funds: 'Funds',
	revenues: 'Revenue tree',
	flows: 'Money flows',
	reconciliation: 'Reconciliation'
};

export const LEVEL_LABEL: Record<CatalogNode['level'], string> = {
	root: 'All sources',
	publisher: 'Publisher',
	publication: 'Publication',
	docType: 'Kind of document',
	document: 'Document or data feed'
};

export function bytesLabel(b: number): string {
	if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
	if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
	if (b >= 1e3) return `${Math.round(b / 1e3)} KB`;
	return `${b} B`;
}

export const truncate = (s: string, max: number) =>
	s.length <= max ? s : s.slice(0, Math.max(1, max - 1)).trimEnd() + '…';

/** Ids of the ancestors of every node matching `pred` (to expand a highlighted path). */
export function ancestorsOf(root: CatalogNode, pred: (n: CatalogNode) => boolean): Set<string> {
	const out = new Set<string>();
	const go = (n: CatalogNode, trail: string[]) => {
		if (pred(n)) trail.forEach((t) => out.add(t));
		for (const c of n.children ?? []) go(c, [...trail, n.id]);
	};
	go(root, []);
	return out;
}

export function findPath(root: CatalogNode, id: string): CatalogNode[] | null {
	if (root.id === id) return [root];
	for (const c of root.children ?? []) {
		const p = findPath(c, id);
		if (p) return [root, ...p];
	}
	return null;
}
