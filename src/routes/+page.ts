import { redirect } from '@sveltejs/kit';
import { getManifest, defaultDataset } from '#lib/data/load.ts';
import { routes } from '#lib/paths.ts';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const m = await getManifest(fetch);
	const { fy, pit } = defaultDataset(m);
	redirect(307, routes.home(fy, pit));
};
