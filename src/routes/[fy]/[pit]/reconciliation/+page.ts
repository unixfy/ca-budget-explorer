import { getReconciliation } from '#lib/data/reconciliation.ts';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent, fetch }) => {
	const { ds } = await parent();
	// null (not an error) when this dataset has no reconciliation.json: the page shows an empty state
	const recon = await getReconciliation(ds.dir, fetch).catch(() => null);
	return { recon };
};
