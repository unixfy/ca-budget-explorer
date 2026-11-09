import { error } from '@sveltejs/kit';
import { getDepartment, getTree, walk } from '#lib/data/load.ts';
import type { BudgetNode } from '#lib/data/schema.ts';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent, params, fetch, url }) => {
	const { ds } = await parent();
	const [detail, exp] = await Promise.all([
		getDepartment(ds.dir, params.org, fetch).catch(() => null),
		getTree(ds.dir, 'expenditures', fetch).catch(() => null)
	]);
	if (!detail) error(404, `No detail is published for department ${params.org} in ${ds.fy}.`);

	// locate the department in the expenditure tree for breadcrumbs
	let expTrail: BudgetNode[] = [];
	if (exp) {
		const stack: BudgetNode[] = [];
		for (const [n, depth] of walk(exp)) {
			stack.length = depth;
			stack.push(n);
			if (n.detailRef === params.org || (n.kind === 'department' && n.code === params.org)) {
				expTrail = [...stack];
				break;
			}
		}
	}
	return { detail, expTrail, focus: url.searchParams.get('focus') };
};
