import { getTree } from '#lib/data/load.ts';
import type { PageLoad } from './$types';

/**
 * The Overview renders its headline from meta.json (already loaded by the layout), so this
 * load does not wait for any tree: it starts the expenditure and revenue downloads and hands
 * the page their promises. Larger files (bytype.json, funds.json) are loaded by the page
 * after first paint, only when needed.
 */
export const load: PageLoad = async ({ parent, fetch }) => {
	const { ds } = await parent();
	const exp = getTree(ds.dir, 'expenditures', fetch);
	const rev = getTree(ds.dir, 'revenues', fetch).catch(() => null);
	// handled by the page; avoid an unhandled-rejection warning if it fails before then
	exp.catch(() => {});
	return { exp, rev };
};
