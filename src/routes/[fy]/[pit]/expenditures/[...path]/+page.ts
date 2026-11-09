import { loadTreePage } from '#lib/treePage.ts';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent, params, fetch }) => {
	const { ds } = await parent();
	return loadTreePage(ds, 'expenditures', params.path, fetch);
};
