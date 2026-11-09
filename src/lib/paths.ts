/** App-internal URL helpers (base-path aware via $app/paths.resolve). */
import { resolve } from '$app/paths';
import type { TreeName } from './data/load';

const res = resolve as unknown as (p: string) => string;

/** Resolve an app path like "/2026-27/e/flows". */
export const href = (p: string) => res(p.replace(/^\/+/, ''));

const enc = (segs: string[]) => (segs.length ? '/' + segs.map(encodeURIComponent).join('/') : '');

export const routes = {
	home: (fy: string, pit: string) => href(`/${fy}/${pit}`),
	tree: (fy: string, pit: string, tree: TreeName, segs: string[] = []) =>
		href(`/${fy}/${pit}/${tree}${enc(segs)}`),
	department: (fy: string, pit: string, org: string, focus?: string) =>
		href(
			`/${fy}/${pit}/department/${encodeURIComponent(org)}${focus ? `?focus=${encodeURIComponent(focus)}` : ''}`
		),
	flows: (fy: string, pit: string) => href(`/${fy}/${pit}/flows`),
	reconciliation: (fy: string, pit: string) => href(`/${fy}/${pit}/reconciliation`),
	sources: (fy: string, pit: string) => href(`/${fy}/${pit}/sources`),
	/** Tree of every data source behind (and around) the budget. */
	dataSources: (fy: string, pit: string, product?: string) =>
		href(
			`/${fy}/${pit}/data-sources${product ? `?product=${encodeURIComponent(product)}` : ''}`
		),
	search: (fy: string, pit: string, q = '') =>
		href(`/${fy}/${pit}/search${q ? `?q=${encodeURIComponent(q)}` : ''}`)
};
