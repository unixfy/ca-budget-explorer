import { error } from '@sveltejs/kit';
import { getDataset, DataError } from '#lib/data/load.ts';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ params, fetch }) => {
	try {
		const ds = await getDataset(params.fy, params.pit, fetch);
		return { ds };
	} catch (e) {
		const status = e instanceof DataError ? e.status : 500;
		error(
			status === 404 ? 404 : 500,
			status === 404
				? `No budget dataset is published for ${params.fy} / “${params.pit}”.`
				: `Could not load the ${params.fy} dataset: ${(e as Error).message}`
		);
	}
};
