/**
 * Client-side data loading for the static JSON files described in schema.ts.
 * Everything is fetched lazily from /data/** and memoised per URL, so navigating
 * between drill-down levels never re-downloads a tree.
 */
import { asset } from '$app/paths';
import type {
	BudgetNode,
	DatasetMeta,
	DepartmentDetail,
	Flows,
	Fund,
	Manifest,
	Pit,
	SearchEntry
} from './schema';
import { PIT_LABELS } from './schema';

/** Data file name (without .json) and URL segment of each drillable tree. */
export type TreeName = 'expenditures' | 'revenues' | 'bytype';
type Fetch = typeof fetch;

const cache = new Map<string, Promise<unknown>>();

/** URL of a file under static/data. */
export function dataUrl(rel: string): string {
	return (asset as (p: string) => string)('data/' + rel.replace(/^\/+/, ''));
}

export class DataError extends Error {
	constructor(
		message: string,
		public status = 500,
		public url?: string
	) {
		super(message);
	}
}

async function getJSON<T>(rel: string, f: Fetch = fetch): Promise<T> {
	const url = dataUrl(rel);
	let p = cache.get(url) as Promise<T> | undefined;
	if (!p) {
		p = f(url).then(async (r) => {
			if (!r.ok) throw new DataError(`Could not load ${rel} (HTTP ${r.status})`, r.status, url);
			const text = await r.text();
			// SPA fallback servers answer unknown paths with index.html — treat that as 404.
			if (/^\s*</.test(text)) throw new DataError(`Could not load ${rel} (not found)`, 404, url);
			return JSON.parse(text) as T;
		});
		cache.set(url, p);
		p.catch(() => cache.delete(url));
	}
	return p;
}

// ---------------------------------------------------------------- manifest / datasets

const FALLBACK_MANIFEST: Manifest = {
	defaultYear: 'fixture',
	defaultPit: 'e',
	datasets: [
		{ fiscalYear: 'fixture', pit: 'e', publication: 'Enacted (fixture)', path: 'fixture/e' }
	]
};

export async function getManifest(f: Fetch = fetch): Promise<Manifest> {
	try {
		const m = await getJSON<Manifest>('manifest.json', f);
		if (!m?.datasets?.length) return FALLBACK_MANIFEST;
		return m;
	} catch {
		return FALLBACK_MANIFEST;
	}
}

export function defaultDataset(m: Manifest): { fy: string; pit: Pit } {
	const hit =
		m.datasets.find((d) => d.fiscalYear === m.defaultYear && d.pit === m.defaultPit) ??
		m.datasets.find((d) => d.fiscalYear === m.defaultYear) ??
		m.datasets[0];
	return { fy: hit?.fiscalYear ?? m.defaultYear, pit: hit?.pit ?? m.defaultPit };
}

const isPit = (p: string): p is Pit => p in PIT_LABELS;

/**
 * Directory (relative to static/data) of a dataset. Uses the manifest `path` when present
 * (tolerating "static/data/…", "/data/…" or "…/meta.json" spellings), else `{fy}/{pit}`,
 * so datasets not yet listed in the manifest (e.g. the fixture) are still reachable.
 */
export function datasetDir(m: Manifest, fy: string, pit: string): string {
	const d = m.datasets.find((x) => x.fiscalYear === fy && x.pit === pit);
	let p = d?.path?.trim() || `${fy}/${pit}`;
	p = p
		.replace(/^\.?\/+/, '')
		.replace(/^static\//, '')
		.replace(/^data\//, '')
		.replace(/\/[^/]+\.json$/, '')
		.replace(/\/+$/, '');
	return p;
}

/** A handle on one fy/pit dataset with typed accessors. */
export interface Dataset {
	fy: string;
	pit: Pit;
	dir: string;
	manifest: Manifest;
	meta: DatasetMeta;
}

export async function getDataset(fy: string, pit: string, f: Fetch = fetch): Promise<Dataset> {
	if (!isPit(pit)) throw new DataError(`Unknown publication "${pit}"`, 404);
	const manifest = await getManifest(f);
	const dir = datasetDir(manifest, fy, pit);
	const meta = await getMeta(dir, f);
	return { fy, pit, dir, manifest, meta };
}

export const getMeta = (dir: string, f?: Fetch) => getJSON<DatasetMeta>(`${dir}/meta.json`, f);
export const getTree = (dir: string, tree: TreeName, f?: Fetch) =>
	getJSON<BudgetNode>(`${dir}/${tree}.json`, f);
export const getFunds = (dir: string, f?: Fetch) =>
	getJSON<Record<string, Fund>>(`${dir}/funds.json`, f);
export const getFlows = (dir: string, f?: Fetch) => getJSON<Flows>(`${dir}/flows.json`, f);
export const getSearch = (dir: string, f?: Fetch) =>
	getJSON<SearchEntry[]>(`${dir}/search.json`, f);
export const getDepartment = (dir: string, orgCode: string, f?: Fetch) =>
	getJSON<DepartmentDetail>(`${dir}/departments/${encodeURIComponent(orgCode)}.json`, f);

// ---------------------------------------------------------------- tree helpers

/** Last slash-delimited segment of a node id — the URL segment for that node. */
export const segmentOf = (n: Pick<BudgetNode, 'id'>) => n.id.split('/').pop() ?? n.id;

function matchChild(parent: BudgetNode, seg: string): BudgetNode | undefined {
	// excludedChildren (non-spending funds) are navigable too, just never summed
	const kids = [...(parent.children ?? []), ...(parent.excludedChildren ?? [])];
	return (
		kids.find((c) => c.id === `${parent.id}/${seg}`) ??
		kids.find((c) => segmentOf(c) === seg) ??
		kids.find((c) => c.code === seg)
	);
}

/**
 * If `node` is a department leaf with a detail file, graft that department's program tree
 * underneath it so drill-down continues seamlessly into programs/subprograms/elements.
 * Mutates the (cached) tree in place; idempotent.
 */
export async function expandDetail(
	dir: string,
	node: BudgetNode,
	f?: Fetch
): Promise<DepartmentDetail | null> {
	if (!node.detailRef) return null;
	try {
		const d = await getDepartment(dir, node.detailRef, f);
		// e.g. a department's share of one spending type: its full program tree would not add up
		if (node.extra?.noGraft) return d;
		if (!node.children?.length && d.programs?.children?.length) {
			node.children = d.programs.children;
			node.extra = { ...node.extra, grafted: 'programs' };
		}
		return d;
	} catch {
		return null;
	}
}

/**
 * Walk `segments` from `root`, lazily grafting department program trees on the way.
 * Returns the trail root..target; `complete` is false when a segment did not resolve
 * (the trail then ends at the deepest node that did).
 */
export async function findNodeByPath(
	dir: string,
	root: BudgetNode,
	segments: string[],
	f?: Fetch
): Promise<{ trail: BudgetNode[]; detail: DepartmentDetail | null; complete: boolean }> {
	const trail = [root];
	let detail: DepartmentDetail | null = null;
	let cur = root;
	let complete = true;
	for (const seg of segments) {
		if (!cur.children?.length && cur.detailRef)
			detail = (await expandDetail(dir, cur, f)) ?? detail;
		const next = matchChild(cur, seg);
		if (!next) {
			complete = false;
			break;
		}
		if (next.detailRef) detail = null; // reset to the closest department
		trail.push(next);
		cur = next;
	}
	if (cur.detailRef) detail = (await expandDetail(dir, cur, f)) ?? detail;
	else if (!detail) {
		// nearest department ancestor already grafted
		const dep = [...trail].reverse().find((n) => n.detailRef);
		if (dep) detail = await getDepartment(dir, dep.detailRef!, f).catch(() => null);
	}
	return { trail, detail, complete };
}

/** Synchronous lookup by id (no grafting). Returns the trail root..node. */
export function findNodeById(root: BudgetNode, id: string): BudgetNode[] | null {
	const go = (n: BudgetNode, prune: boolean): BudgetNode[] | null => {
		if (n.id === id) return [n];
		for (const c of [...(n.children ?? []), ...(n.excludedChildren ?? [])]) {
			// ids are paths, so prune subtrees whose id is not a prefix of the target
			if (prune && !id.startsWith(c.id + '/') && id !== c.id) continue;
			const r = go(c, prune);
			if (r) return [n, ...r];
		}
		return null;
	};
	return go(root, true) ?? go(root, false);
}

/** Path segments (for URLs) from the root to a node, given the trail. */
export const pathSegments = (trail: BudgetNode[]) => trail.slice(1).map(segmentOf);

/** Ancestors of the last node in a trail (root-first, excluding the node). */
export const ancestors = (trail: BudgetNode[]) => trail.slice(0, -1);

/** Depth-first iterator over a tree. */
export function* walk(node: BudgetNode, depth = 0): Generator<[BudgetNode, number]> {
	yield [node, depth];
	for (const c of node.children ?? []) yield* walk(c, depth + 1);
}

/** Segments for a search entry id in a tree, assuming ids are "{rootId}/{seg}/{seg}…". */
export const idToSegments = (id: string) => id.split('/').slice(1);

/**
 * Best-effort lookup of an id that may come from another file (flows.json, search.json):
 * exact id first, then a node whose last id segment (or code) matches, preferring `kind`.
 */
export function locate(root: BudgetNode, id: string, kind?: string): BudgetNode[] | null {
	const exact = findNodeById(root, id);
	if (exact) return exact;
	const seg = id.split('/').pop() ?? id;
	let best: BudgetNode[] | null = null;
	const stack: BudgetNode[] = [];
	for (const [n, depth] of walk(root)) {
		stack.length = depth;
		stack.push(n);
		if (n !== root && (segmentOf(n) === seg || n.code === seg)) {
			if (!kind || n.kind === kind) return [...stack];
			best ??= [...stack];
		}
	}
	return best;
}
