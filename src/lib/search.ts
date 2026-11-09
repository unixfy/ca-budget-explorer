/** Client-side search over search.json entries. */
import type { SearchEntry } from './data/schema';
import { idToSegments } from './data/load';
import { routes } from './paths';
import type { AtlasIndex, AtlasRef } from './atlas';

const norm = (s: string) =>
	s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '');

export interface Prepared {
	e: SearchEntry;
	hay: string;
	name: string;
}

export function prepare(entries: SearchEntry[]): Prepared[] {
	return entries.map((e) => ({
		e,
		name: norm(e.name),
		hay: norm([e.name, e.code ?? '', ...e.path].join(' '))
	}));
}

/** Token-AND search; ranks name-prefix > name-contains > path match, then by size. */
export function search(items: Prepared[], q: string, limit = 50): SearchEntry[] {
	return searchCounted(items, q, limit).results;
}

export interface CountedResults {
	/** The best `limit` matches, ranked. */
	results: SearchEntry[];
	/** How many entries matched in all (may exceed `limit`). */
	total: number;
	/** Matches per kind across every match, not just the first `limit`. */
	byKind: Map<SearchEntry['kind'], number>;
}

/** Like `search`, but also reports how many entries matched in all, and per kind. */
export function searchCounted(items: Prepared[], q: string, limit = 50): CountedResults {
	const tokens = norm(q).split(/\s+/).filter(Boolean);
	if (!tokens.length) return { results: [], total: 0, byKind: new Map() };
	const scored: { e: SearchEntry; s: number }[] = [];
	for (const it of items) {
		let s = 0;
		let ok = true;
		for (const t of tokens) {
			if (it.e.code && it.e.code.toLowerCase() === t) s += 120;
			else if (it.name.startsWith(t)) s += 60;
			else if (new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(it.name)) s += 40;
			else if (it.name.includes(t)) s += 25;
			else if (it.hay.includes(t)) s += 8;
			else {
				ok = false;
				break;
			}
		}
		if (!ok) continue;
		s += Math.log10(Math.max(1, Math.abs(it.e.by ?? 0))) * 2; // bigger items first
		s -= it.e.path.length * 1.5; // shallower first
		scored.push({ e: it.e, s });
	}
	scored.sort((a, b) => b.s - a.s);
	const byKind = new Map<SearchEntry['kind'], number>();
	for (const x of scored) byKind.set(x.e.kind, (byKind.get(x.e.kind) ?? 0) + 1);
	return { results: scored.slice(0, limit).map((x) => x.e), total: scored.length, byKind };
}

export function entryHref(fy: string, pit: string, e: SearchEntry): string {
	if (e.tree === 'department' && e.detailRef) return routes.department(fy, pit, e.detailRef, e.id);
	if (e.tree === 'revenues') return routes.tree(fy, pit, 'revenues', idToSegments(e.id));
	return routes.tree(fy, pit, 'expenditures', idToSegments(e.id));
}

/** The atlas tree that draws a search entry (department detail lives in spending). */
export const entryTree = (e: SearchEntry): 'expenditures' | 'revenues' =>
	e.tree === 'revenues' ? 'revenues' : 'expenditures';

/**
 * Street-index reference for a search entry: its own square when the atlas index knows
 * it, otherwise the nearest indexed ancestor's map page (programs and line items are
 * drawn on their department's page).
 */
export function entryRef(idx: AtlasIndex, e: SearchEntry): AtlasRef | undefined {
	const hit = idx.ref(e.id);
	if (hit) return hit;
	const segs = e.id.split('/');
	for (let n = segs.length - 1; n > 0; n--) {
		const r = idx.ref(segs.slice(0, n).join('/'));
		if (r) return r.own !== undefined ? { page: r.own } : r;
	}
	return undefined;
}

/** Index letter for an entry name: A–Z, or "#" for names starting with a digit or symbol. */
export function indexLetter(name: string): string {
	const c = norm(name).charAt(0).toUpperCase();
	return c >= 'A' && c <= 'Z' ? c : '#';
}
