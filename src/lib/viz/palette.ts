/**
 * Atlas city tints: the pastel shades a street atlas gives neighbouring cities.
 * Fixed order, never cycled. Light tints carry ink labels (>= 9:1); night tints carry
 * light labels (>= 4.5:1). Entities beyond slot 7 fold into a neutral "unincorporated"
 * tone and rely on direct labels. No red/blue pair sits next to each other at the top
 * of the order, so the largest agencies never read as a partisan split.
 */
export const CATEGORICAL = {
	light: ['#f6e07a', '#b8dca6', '#a6d0ee', '#f4b8a0', '#e3bfdf', '#f6cd93', '#c8c2ec', '#f1a8b4'],
	dark: ['#7a6a1e', '#3f6e3a', '#2d6185', '#84503d', '#70496d', '#80602a', '#504c86', '#83404f']
};
export const OTHER = { light: '#d5dcd8', dark: '#3a4652' };
/** Casing: the dark outline an atlas draws around every shaded block. */
export const CASING = { light: '#15191c', dark: '#0b1016' };
export const INK = {
	light: {
		primary: '#15191c',
		secondary: '#3f4a4f',
		muted: '#5f6b70',
		grid: '#c9d3cd',
		surface: '#f3f6f4'
	},
	dark: {
		primary: '#e8edef',
		secondary: '#c2ccd0',
		muted: '#93a1a6',
		grid: '#2a3541',
		surface: '#0f151c'
	}
};
export type Mode = 'light' | 'dark';

const NIGHT = new Set([...CATEGORICAL.dark, OTHER.dark]);
/** Text color to place on top of a tint. */
export const inkOn = (hex: string) =>
	NIGHT.has(hex.toLowerCase()) ? INK.dark.primary : INK.light.primary;

/**
 * Stable color assignment: rank ids by a fixed key (budget-year all-funds size),
 * independent of the year/fund toggles so color follows the entity, not its rank.
 */
export function colorMap(items: { id: string; key: number }[], mode: Mode): Map<string, string> {
	const sorted = [...items].sort((a, b) => b.key - a.key);
	const pal = CATEGORICAL[mode];
	const m = new Map<string, string>();
	sorted.forEach((it, i) => m.set(it.id, i < pal.length ? pal[i] : OTHER[mode]));
	return m;
}
