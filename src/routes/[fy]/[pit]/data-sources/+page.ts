import { getSourcesCatalog } from '#lib/data/sources-catalog.ts';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent, fetch }) => {
	const { ds } = await parent();
	// null (not an error) when this dataset has no sources-catalog.json: the page shows an empty state
	const catalog = await getSourcesCatalog(ds.dir, fetch).catch(() => null);
	return { catalog };
};
