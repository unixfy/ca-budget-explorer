/**
 * Remove non-spending fund types (reimbursements, nongovernmental cost funds, loan-financed
 * interim payments) from spending totals.
 *
 * Reimbursements are payments from one department to another and are already counted where the
 * money originates; nongovernmental cost funds (UC/CSU own funds, CalPERS/CalSTRS trust funds,
 * local property tax, disability insurance...) are money the state holds or passes through;
 * loan-financed interim payments (0201) are later charged to the regular Budget Act items.
 * ebudget's "all funds" total includes both; we keep them in the data but outside `amounts`:
 *   - node.excluded[type]  = the excluded amounts for this node
 *   - node.excludedChildren = children funded entirely by excluded fund types (not summed)
 */
import type { BudgetNode, NonSpendingFundType, Triple } from '../../../src/lib/data/schema.ts';
import { NON_SPENDING_FUND_TYPES } from '../../../src/lib/data/schema.ts';

const YEARS = ['py', 'cy', 'by'] as const;
const r1 = (n: number) => Math.round(n * 10) / 10;

export const isNonSpending = (t: string): t is NonSpendingFundType =>
	(NON_SPENDING_FUND_TYPES as readonly string[]).includes(t);

export function addTriple(a: Triple | undefined, b: Triple | undefined): Triple {
	const out = { py: null, cy: null, by: null } as Triple;
	for (const y of YEARS) {
		const x = a?.[y] ?? null;
		const z = b?.[y] ?? null;
		out[y] = x === null && z === null ? null : r1((x ?? 0) + (z ?? 0));
	}
	return out;
}

function subTriple(a: Triple, b: Triple): Triple {
	const out = { ...a };
	for (const y of YEARS) if (a[y] !== null && b[y] !== null) out[y] = r1(a[y]! - b[y]!);
	return out;
}

export function mergeExcluded(
	into: Partial<Record<NonSpendingFundType, Triple>>,
	from: Partial<Record<NonSpendingFundType, Triple>> | undefined
) {
	for (const [k, v] of Object.entries(from ?? {}) as [NonSpendingFundType, Triple][])
		into[k] = addTriple(into[k], v);
}

export const excludedTotal = (n: Pick<BudgetNode, 'excluded'>): Triple => {
	let t: Triple = { py: null, cy: null, by: null };
	for (const v of Object.values(n.excluded ?? {})) t = addTriple(t, v);
	return t;
};

/** Is this subtree funded only by non-spending fund types? (checked on the untransformed node) */
function fullyExcluded(n: BudgetNode): boolean {
	if (n.kind === 'fundType') return isNonSpending(n.id.split('/').pop() ?? '');
	const keys = Object.keys(n.byFundType ?? {});
	return keys.length > 0 && keys.every(isNonSpending);
}

/** Post-order, in-place transform. Never mutates shared byFundType objects (it reassigns). */
export function excludeNonSpending(node: BudgetNode): BudgetNode {
	const kids = node.children ?? [];
	const moved: BudgetNode[] = [];
	if (kids.length) {
		const keep: BudgetNode[] = [];
		// excluded subtrees are moved as-is (they keep their own gross amounts)
		for (const k of kids) (fullyExcluded(k) ? moved : keep).push(k);
		for (const k of keep) excludeNonSpending(k);
		if (moved.length) {
			node.children = keep;
			node.excludedChildren = [...(node.excludedChildren ?? []), ...moved];
		}
	}

	if (node.byFundType) {
		const excluded: Partial<Record<NonSpendingFundType, Triple>> = {};
		const rest: typeof node.byFundType = {};
		for (const [t, v] of Object.entries(node.byFundType)) {
			if (isNonSpending(t)) excluded[t] = v;
			else rest[t as keyof typeof rest] = v;
		}
		if (Object.keys(excluded).length) {
			node.byFundType = rest;
			node.excluded = excluded;
			node.amounts = subTriple(node.amounts, excludedTotal(node));
		}
	} else if (moved.length) {
		// No fund-type split on this node: derive what was excluded from the moved children.
		const excluded: Partial<Record<NonSpendingFundType, Triple>> = {};
		for (const m of moved) {
			const t = (
				m.kind === 'fundType' ? m.id.split('/').pop() : Object.keys(m.byFundType ?? {})[0]
			) as NonSpendingFundType;
			if (Object.keys(m.byFundType ?? {}).length > 1)
				mergeExcluded(excluded, m.byFundType as Partial<Record<NonSpendingFundType, Triple>>);
			else excluded[t] = addTriple(excluded[t], m.amounts);
		}
		node.excluded = excluded;
		node.amounts = subTriple(node.amounts, excludedTotal(node));
	}

	// Children without any fund split (e.g. program lists from the API) can't be adjusted
	// individually: add one explicit adjustment line so the parent still equals its children.
	const kept = node.children ?? [];
	if (node.excluded && kept.length && kept.every((k) => !k.byFundType && !k.excluded)) {
		let sum: Triple = { py: null, cy: null, by: null };
		for (const k of kept) sum = addTriple(sum, k.amounts);
		const diff = subTriple(node.amounts, sum);
		if (YEARS.some((y) => Math.abs(diff[y] ?? 0) > 1))
			node.children = [
				...kept,
				{
					id: `${node.id}/less-non-spending`,
					kind: 'other',
					name: 'Less: funded by reimbursements / nongovernmental cost funds / interim loans',
					amounts: diff,
					extra: { adjustment: true, residual: true }
				}
			];
	}
	return node;
}
