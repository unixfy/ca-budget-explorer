/**
 * The atlas index: every budget item gets a page and a grid square, the way a street
 * atlas indexes every street ("Medi-Cal ······ 312 C4").
 *
 * - Map pages: the Key Map (the whole tree), one page per top-level item (agency,
 *   revenue fund group, spending type) and one per second-level item (department...).
 *   Pages run in budget-year size order inside each tree, from that tree's first page.
 * - Grid squares: the A–J / 1–7 square where an item sits on the map page that draws it,
 *   from a squarified layout of that page's items on a 10 × 7 sheet (same algorithm and
 *   size order as the treemap, so the square matches what the visitor sees).
 * - Deeper items (programs, line items) are found on their department's page, at the
 *   square of the branch that contains them.
 *
 * Page numbers are a reading aid computed from this dataset; they are not page numbers
 * in any official document (those appear in source citations).
 */
import { hierarchy, treemap, treemapSquarify } from 'd3';
import type { BudgetNode } from './data/schema';
import type { TreeName } from './data/load';

export const GRID_COLS = 'ABCDEFGHIJ';
export const GRID_ROWS = 7;

/** First page of each tree; spending starts at 100 like an atlas's first city page. */
export const FIRST_PAGE: Record<TreeName, number> = {
	expenditures: 100,
	revenues: 5000,
	bytype: 8000
};

export interface AtlasRef {
	/** Page whose map draws this item ("Key Map" pages are page 0 / KEY). */
	page: number;
	/** Grid square on that page, e.g. "C4"; absent when the page has no map position. */
	grid?: string;
	/** This item's own map page, when it has one (top two levels). */
	own?: number;
}

export interface AtlasIndex {
	ref(id: string): AtlasRef | undefined;
	/** Map pages in order, for a contents listing. */
	pages: { page: number; id: string; name: string; depth: 1 | 2 }[];
}

const KEY_PAGE = 0;
const size = (n: BudgetNode) => Math.max(0, n.amounts.by ?? 0);
const bySize = (a: BudgetNode, b: BudgetNode) => size(b) - size(a);

/** Grid squares of a node's children on a 10 × 7 sheet, keyed by child id. */
export function sheetSquares(node: BudgetNode): Map<string, string> {
	const out = new Map<string, string>();
	const kids = (node.children ?? []).filter((c) => size(c) > 0);
	if (!kids.length) return out;
	const root = hierarchy<{ node?: BudgetNode; children?: { node: BudgetNode }[] }>({
		children: kids.map((node) => ({ node }))
	})
		.sum((d) => (d.node ? size(d.node) : 0))
		.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
	treemap<{ node?: BudgetNode }>().tile(treemapSquarify).size([GRID_COLS.length, GRID_ROWS])(root);
	for (const leaf of root.leaves()) {
		const l = leaf as typeof leaf & { x0: number; x1: number; y0: number; y1: number };
		const col = Math.min(GRID_COLS.length - 1, Math.floor((l.x0 + l.x1) / 2));
		const row = Math.min(GRID_ROWS - 1, Math.floor((l.y0 + l.y1) / 2));
		if (leaf.data.node) out.set(leaf.data.node.id, `${GRID_COLS[col]}${row + 1}`);
	}
	return out;
}

const cache = new WeakMap<BudgetNode, AtlasIndex>();

export function atlasIndex(root: BudgetNode, tree: TreeName): AtlasIndex {
	const hit = cache.get(root);
	if (hit) return hit;
	const refs = new Map<string, AtlasRef>();
	const pages: AtlasIndex['pages'] = [];
	const top = [...(root.children ?? [])].sort(bySize);
	const widest = Math.max(1, ...top.map((t) => t.children?.length ?? 0));
	const step = Math.ceil((widest + 1) / 100) * 100;
	const keySquares = sheetSquares(root);

	top.forEach((t, i) => {
		const own = FIRST_PAGE[tree] + i * step;
		refs.set(t.id, { page: KEY_PAGE, grid: keySquares.get(t.id), own });
		pages.push({ page: own, id: t.id, name: t.name, depth: 1 });
		const squares = sheetSquares(t);
		[...(t.children ?? [])].sort(bySize).forEach((d, j) => {
			const dOwn = own + 1 + j;
			refs.set(d.id, { page: own, grid: squares.get(d.id), own: dOwn });
			pages.push({ page: dOwn, id: d.id, name: d.name, depth: 2 });
			const inner = sheetSquares(d);
			for (const branch of d.children ?? []) {
				const grid = inner.get(branch.id);
				const stack: BudgetNode[] = [branch];
				while (stack.length) {
					const n = stack.pop()!;
					refs.set(n.id, { page: dOwn, grid });
					if (n.children) stack.push(...n.children);
				}
			}
		});
	});

	const idx: AtlasIndex = { ref: (id) => refs.get(id), pages };
	cache.set(root, idx);
	return idx;
}

/** "Key Map" for page 0, otherwise the page number. */
export const pageName = (page: number) => (page === KEY_PAGE ? 'Key Map' : String(page));

/** "p. 312 · C4", "Key Map · C4", or "p. 312". */
export function refLabel(r: AtlasRef): string {
	const p = r.page === KEY_PAGE ? 'Key Map' : `p. ${r.page}`;
	return r.grid ? `${p} · ${r.grid}` : p;
}

/** Spoken form for screen readers: "page 312, square C4". */
export function refSpoken(r: AtlasRef): string {
	const p = r.page === KEY_PAGE ? 'the Key Map' : `page ${r.page}`;
	return r.grid ? `${p}, square ${r.grid}` : p;
}
