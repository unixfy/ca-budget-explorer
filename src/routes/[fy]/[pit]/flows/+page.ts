import { error } from '@sveltejs/kit';
import { getFlows, getTree } from '#lib/data/load.ts';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent, fetch }) => {
	const { ds } = await parent();
	// the spending tree only lends the Key Map's agency tints and page numbers; optional
	const [flows, expenditures] = await Promise.all([
		getFlows(ds.dir, fetch).catch(() => null),
		getTree(ds.dir, 'expenditures', fetch).catch(() => null)
	]);
	if (!flows) error(404, `No flow-of-funds data is published for ${ds.fy}.`);
	return { flows, expenditures };
};
