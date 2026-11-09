/**
 * Shared helpers for the tree visualizations: plain-language explanations of DOF
 * line-item kinds, spatial arrow-key navigation for roving focus, and a guarded
 * localStorage.
 */
import type { NodeKind } from '#lib/data/schema.ts';

/** One-sentence, plain explanation of each budget level, for headers and tooltips. */
export const KIND_HELP: Partial<Record<NodeKind, string>> = {
	agency: 'A group of related state departments.',
	subagency: 'A group of departments within an agency.',
	department: 'A state department, board or commission.',
	program: 'A main area of work within a department.',
	subprogram: 'A smaller part of a program.',
	element: 'A finer split of a program, the next level of detail the budget publishes.',
	component: 'The finest split of a program the budget publishes.',
	fundType: 'A group of funds: the General Fund, special funds, bond funds or federal funds.',
	fund: 'A separate account the money is paid from, such as the General Fund or a fund set up for one purpose.',
	item: 'A numbered line in the Budget Act that allows a set amount to be spent from one fund.',
	category: 'A group of similar spending.',
	object: 'A specific type of cost, such as salaries, rent or grants.',
	revenueCategory: 'A group of related taxes or other revenue.',
	revenueSource: 'A specific tax, fee or other source of money.',
	project: 'A specific building or land project.'
};

/** Kinds whose label is budget jargon a lay visitor needs explained where it appears. */
export const JARGON_KINDS = new Set<NodeKind>([
	'subprogram',
	'element',
	'component',
	'fundType',
	'fund',
	'item',
	'category',
	'object'
]);

export interface Box {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

/**
 * Index of the nearest box in the arrow-key direction from `from`, or `from` if none.
 * Distance favours boxes that overlap along the cross axis.
 */
export function nearestInDirection(boxes: Box[], from: number, key: string): number {
	const a = boxes[from];
	if (!a) return from;
	const cx = (a.x0 + a.x1) / 2;
	const cy = (a.y0 + a.y1) / 2;
	let best = from;
	let bestD = Infinity;
	boxes.forEach((b, i) => {
		if (i === from) return;
		const bx = (b.x0 + b.x1) / 2;
		const by = (b.y0 + b.y1) / 2;
		let main: number;
		let cross: number;
		if (key === 'ArrowRight') [main, cross] = [b.x0 - a.x1 + 1, by - cy];
		else if (key === 'ArrowLeft') [main, cross] = [a.x0 - b.x1 + 1, by - cy];
		else if (key === 'ArrowDown') [main, cross] = [b.y0 - a.y1 + 1, bx - cx];
		else if (key === 'ArrowUp') [main, cross] = [a.y0 - b.y1 + 1, bx - cx];
		else return;
		if (main <= 0) return;
		const overlap =
			key === 'ArrowLeft' || key === 'ArrowRight'
				? Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
				: Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
		const d = main + Math.abs(cross) * (overlap > 0 ? 0.25 : 2);
		if (d < bestD) {
			bestD = d;
			best = i;
		}
	});
	return best;
}

/** localStorage that never throws (private mode, blocked storage, SSR). */
export const safeStorage = {
	get(key: string): string | null {
		try {
			return globalThis.localStorage?.getItem(key) ?? null;
		} catch {
			return null;
		}
	},
	set(key: string, value: string) {
		try {
			globalThis.localStorage?.setItem(key, value);
		} catch {
			/* storage unavailable: the choice just isn't remembered */
		}
	}
};
