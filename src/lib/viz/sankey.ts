/**
 * Minimal column-based sankey layout (d3-sankey is not installed).
 * Nodes carry an explicit `column`; node height ∝ max(in, out); nodes in a column are
 * ordered by a few barycentric relaxation passes to reduce crossings.
 */
export interface SankeyInNode {
	id: string;
	name: string;
	column: number;
}
export interface SankeyInLink {
	source: string;
	target: string;
	value: number;
}
export interface SankeyNode<N extends SankeyInNode = SankeyInNode> {
	data: N;
	id: string;
	column: number;
	value: number;
	x0: number;
	x1: number;
	y0: number;
	y1: number;
	in: SankeyLink<N>[];
	out: SankeyLink<N>[];
}
export interface SankeyLink<N extends SankeyInNode = SankeyInNode> {
	source: SankeyNode<N>;
	target: SankeyNode<N>;
	value: number;
	width: number;
	/** y at source (center of the band) and at target */
	y0: number;
	y1: number;
}

export function sankeyLayout<N extends SankeyInNode>(
	nodesIn: N[],
	linksIn: SankeyInLink[],
	opts: { width: number; height: number; nodeWidth?: number; padding?: number; iterations?: number }
) {
	const { width, height } = opts;
	const nodeWidth = opts.nodeWidth ?? 14;
	const padding = opts.padding ?? 10;
	const byId = new Map<string, SankeyNode<N>>();
	for (const d of nodesIn)
		byId.set(d.id, {
			data: d,
			id: d.id,
			column: d.column,
			value: 0,
			x0: 0,
			x1: 0,
			y0: 0,
			y1: 0,
			in: [],
			out: []
		});

	const links: SankeyLink<N>[] = [];
	for (const l of linksIn) {
		const s = byId.get(l.source);
		const t = byId.get(l.target);
		if (!s || !t || !(l.value > 0)) continue;
		const link: SankeyLink<N> = { source: s, target: t, value: l.value, width: 0, y0: 0, y1: 0 };
		s.out.push(link);
		t.in.push(link);
		links.push(link);
	}
	const nodes = [...byId.values()].filter((n) => n.in.length || n.out.length);
	for (const n of nodes)
		n.value = Math.max(
			n.in.reduce((a, l) => a + l.value, 0),
			n.out.reduce((a, l) => a + l.value, 0)
		);

	const colIdx = [...new Set(nodes.map((n) => n.column))].sort((a, b) => a - b);
	const columns = colIdx.map((c) =>
		nodes.filter((n) => n.column === c).sort((a, b) => b.value - a.value)
	);
	const nCols = columns.length;
	const ky = Math.min(
		...columns.map(
			(col) =>
				(height - (col.length - 1) * padding) /
				Math.max(
					1,
					col.reduce((a, n) => a + n.value, 0)
				)
		)
	);

	columns.forEach((col, ci) => {
		const x0 = nCols === 1 ? 0 : (ci / (nCols - 1)) * (width - nodeWidth);
		for (const n of col) {
			n.x0 = x0;
			n.x1 = x0 + nodeWidth;
		}
	});

	const stack = (col: SankeyNode<N>[]) => {
		const total = col.reduce((a, n) => a + n.value * ky, 0) + (col.length - 1) * padding;
		let y = (height - total) / 2;
		for (const n of col) {
			n.y0 = y;
			n.y1 = y + n.value * ky;
			y = n.y1 + padding;
		}
	};
	columns.forEach(stack);

	// barycentric ordering passes (left->right then right->left)
	const center = (n: SankeyNode<N>) => (n.y0 + n.y1) / 2;
	const bary = (n: SankeyNode<N>, dir: 'in' | 'out') => {
		const ls = dir === 'in' ? n.in : n.out;
		if (!ls.length) return center(n);
		const w = ls.reduce((a, l) => a + l.value, 0);
		return ls.reduce((a, l) => a + center(dir === 'in' ? l.source : l.target) * l.value, 0) / w;
	};
	for (let it = 0; it < (opts.iterations ?? 4); it++) {
		for (let c = 1; c < nCols; c++) {
			columns[c].sort((a, b) => bary(a, 'in') - bary(b, 'in'));
			stack(columns[c]);
		}
		for (let c = nCols - 2; c >= 0; c--) {
			columns[c].sort((a, b) => bary(a, 'out') - bary(b, 'out'));
			stack(columns[c]);
		}
	}

	// link band positions
	for (const l of links) l.width = l.value * ky;
	for (const n of nodes) {
		n.out.sort((a, b) => center(a.target) - center(b.target));
		n.in.sort((a, b) => center(a.source) - center(b.source));
		let y = n.y0;
		for (const l of n.out) {
			l.y0 = y + l.width / 2;
			y += l.width;
		}
		y = n.y0;
		for (const l of n.in) {
			l.y1 = y + l.width / 2;
			y += l.width;
		}
	}
	return { nodes, links, columns };
}

/** SVG path for a link band (stroke it with stroke-width = link.width). */
export function linkPath(l: SankeyLink): string {
	const x0 = l.source.x1;
	const x1 = l.target.x0;
	const xm = (x0 + x1) / 2;
	return `M${x0},${l.y0}C${xm},${l.y0} ${xm},${l.y1} ${x1},${l.y1}`;
}

/** Shorten `s` to `max` characters by cutting the middle, so both ends stay readable. */
export function middleTruncate(s: string, max: number): string {
	if (s.length <= max) return s;
	const keep = Math.max(2, max - 1);
	const a = Math.ceil(keep / 2);
	return s.slice(0, a).trimEnd() + '…' + s.slice(s.length - (keep - a)).trimStart();
}

/**
 * Wrap a label into at most `maxLines` lines of `max` characters. Overflow is cut in the
 * middle of the last line, so distinguishing endings ("1991 Realignment") survive.
 */
export function wrapLabel(s: string, max: number, maxLines = 2): string[] {
	const lines: string[] = [];
	let cur = '';
	for (const w of s.split(/\s+/)) {
		const next = cur ? `${cur} ${w}` : w;
		if (next.length > max && cur) {
			lines.push(cur);
			cur = w;
		} else cur = next;
	}
	if (cur) lines.push(cur);
	if (lines.length <= maxLines) return lines.map((l) => middleTruncate(l, max));
	const head = lines.slice(0, maxLines - 1).map((l) => middleTruncate(l, max));
	return [...head, middleTruncate(lines.slice(maxLines - 1).join(' '), max)];
}

/**
 * Place label boxes (centre `y`, height `h`) as close to their anchors as possible
 * without overlapping, inside [min, max]. Returns the items with a `top` coordinate.
 */
export function spreadLabels<T extends { y: number; h: number }>(
	items: T[],
	min: number,
	max: number,
	gap = 2
): (T & { top: number })[] {
	const s = [...items].sort((a, b) => a.y - b.y).map((it) => ({ ...it, top: it.y - it.h / 2 }));
	let prev = min - gap;
	for (const it of s) {
		it.top = Math.max(it.top, prev + gap);
		prev = it.top + it.h;
	}
	let next = max + gap;
	for (let i = s.length - 1; i >= 0; i--) {
		const it = s[i];
		if (it.top + it.h > next - gap) it.top = next - gap - it.h;
		next = it.top;
	}
	return s;
}

/** Node value (max of inflow and outflow) for every node id in a set of links. */
export function nodeValues(links: SankeyInLink[]): Map<string, number> {
	const inflow = new Map<string, number>();
	const outflow = new Map<string, number>();
	for (const l of links) {
		if (!(l.value > 0)) continue;
		inflow.set(l.target, (inflow.get(l.target) ?? 0) + l.value);
		outflow.set(l.source, (outflow.get(l.source) ?? 0) + l.value);
	}
	const out = new Map<string, number>();
	for (const id of new Set([...inflow.keys(), ...outflow.keys()]))
		out.set(id, Math.max(inflow.get(id) ?? 0, outflow.get(id) ?? 0));
	return out;
}

/**
 * Atlas route tints for the flow map. Revenue is water (blue), funds are the road
 * classes the money travels along (orange and yellow family), balances and reserves are
 * park (green), spending areas take the agency city tints from the Key Map, and
 * transfers stay neutral "unincorporated" grey.
 */
export const ROUTE_TINTS = {
	light: {
		water: '#a6d0ee',
		park: '#b8dca6',
		roads: ['#f6cd93', '#f6e07a', '#efbf9c', '#e8d7a8'],
		neutral: '#d5dcd8'
	},
	dark: {
		water: '#2d6185',
		park: '#3f6e3a',
		roads: ['#80602a', '#7a6a1e', '#84503d', '#6b5d34'],
		neutral: '#3a4652'
	}
} as const;

export interface RouteNode extends SankeyInNode {
	kind?: string;
}

/**
 * Fill tint for every node of the flow map, keyed by id.
 * - Fund column: road tints by size (stable across views).
 * - Balance / reserve nodes: park green. Transfer and "other" nodes: neutral.
 * - Revenue column: water blue. Spending areas: `agencyTints` when given, else neutral.
 */
export function routeTints(
	nodes: RouteNode[],
	values: Map<string, number>,
	mode: 'light' | 'dark',
	agencyTints?: Map<string, string>
): Map<string, string> {
	const t = ROUTE_TINTS[mode];
	const cols = [...new Set(nodes.map((n) => n.column))].sort((a, b) => a - b);
	const first = cols[0];
	const mid = cols.length > 2 ? cols[1] : undefined;
	const out = new Map<string, string>();
	const funds = nodes
		.filter((n) => n.column === mid)
		.sort((a, b) => (values.get(b.id) ?? 0) - (values.get(a.id) ?? 0));
	funds.forEach((n, i) => out.set(n.id, t.roads[i] ?? t.neutral));
	for (const n of nodes) {
		if (out.has(n.id)) continue;
		if (/balance|reserve/i.test(n.id) || /balances? (&|and) reserves/i.test(n.name))
			out.set(n.id, t.park);
		else if (/transfer/i.test(n.id) || n.kind === 'other') out.set(n.id, t.neutral);
		else if (n.column === first) out.set(n.id, t.water);
		else out.set(n.id, agencyTints?.get(n.id) ?? t.neutral);
	}
	return out;
}

/** Closed outline of a link band, for a filled ribbon with a casing edge. */
export function linkBand(l: SankeyLink): string {
	const x0 = l.source.x1;
	const x1 = l.target.x0;
	const xm = (x0 + x1) / 2;
	const h = Math.max(0.5, l.width / 2);
	const a0 = l.y0 - h;
	const a1 = l.y1 - h;
	const b0 = l.y0 + h;
	const b1 = l.y1 + h;
	return `M${x0},${a0}C${xm},${a0} ${xm},${a1} ${x1},${a1}L${x1},${b1}C${xm},${b1} ${xm},${b0} ${x0},${b0}Z`;
}
