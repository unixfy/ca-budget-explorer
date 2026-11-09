/** Shared load() for the URL-driven tree explorers (/expenditures/..., /revenues/..., /bytype/...). */
import { error, redirect } from '@sveltejs/kit';
import { getTree, findNodeByPath, pathSegments, type Dataset, type TreeName } from './data/load';
import { routes } from './paths';
import { atlasIndex, sheetSquares, type AtlasRef } from './atlas';
import type { BudgetNode } from './data/schema';

export async function loadTreePage(ds: Dataset, tree: TreeName, path: string, f: typeof fetch) {
	let root;
	try {
		root = await getTree(ds.dir, tree, f);
	} catch (e) {
		error(404, `The ${tree} tree is not available for ${ds.fy}: ${(e as Error).message}`);
	}
	const segments = path.split('/').filter(Boolean).map(decodeURIComponent);
	const { trail, detail, complete } = await findNodeByPath(ds.dir, root, segments, f);
	// unknown deep link (e.g. after switching year): go to the deepest level that exists
	if (!complete) redirect(307, routes.tree(ds.fy, ds.pit, tree, pathSegments(trail)));
	return { tree, trail, detail };
}

export type RefOf = (trail: BudgetNode[], n: BudgetNode) => AtlasRef | undefined;

/**
 * Atlas references for a tree, including items below the indexed top two levels.
 * Deeper items (programs, line items, grafted after the index was built) sit on their
 * nearest ancestor's own map page, at the square of the branch that contains them.
 * `trail` ends at `n` or at its parent.
 */
export function atlasRefs(root: BudgetNode, tree: TreeName): RefOf {
	const idx = atlasIndex(root, tree);
	const squares = new WeakMap<BudgetNode, Map<string, string>>();
	const sq = (n: BudgetNode) => {
		let m = squares.get(n);
		if (!m) squares.set(n, (m = sheetSquares(n)));
		return m;
	};
	return (trail, n) => {
		const hit = idx.ref(n.id);
		if (hit) return hit;
		const chain = trail[trail.length - 1] === n ? trail : [...trail, n];
		for (let i = chain.length - 2; i >= 0; i--) {
			const own = idx.ref(chain[i].id)?.own;
			if (own != null) return { page: own, grid: sq(chain[i]).get(chain[i + 1].id) };
		}
		return undefined;
	};
}

/** The page a node's tab shows: its own map page, else the page that draws it. */
export const tabPage = (r: AtlasRef | undefined) => (r ? (r.own ?? r.page) : undefined);
