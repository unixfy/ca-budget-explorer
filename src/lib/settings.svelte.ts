/** Global UI settings (runes), persisted to localStorage. Client-only app (ssr = false). */
import type { FundFilter, YearKey } from './format';
import type { Mode } from './viz/palette';

type Theme = 'light' | 'dark' | 'system';
const KEY = 'cabx:settings';
/**
 * Version of the saved settings. Saves before v2 were written automatically on every visit,
 * so their fund value is not a choice the visitor made; v2 only keeps the fund once chosen.
 */
const VERSION = 2;
/** Oldest first: a compare year must come before the year shown. */
const ORDER: YearKey[] = ['py', 'cy', 'by'];

class Settings {
	year = $state<YearKey>('by');
	/**
	 * Default: DOF's headline "state funds" (General + special + bond).
	 * 'all' = state + federal spending funds. See FundFilter.
	 */
	fund = $state<FundFilter>('state');
	theme = $state<Theme>('system');
	/** OS-level prefers-color-scheme: dark */
	#osDark = $state(false);
	reducedMotion = $state(false);
	/** Compare year as saved (may be later than or equal to `year`). */
	#compare = $state<YearKey>('cy');

	mode: Mode = $derived(this.theme === 'system' ? (this.#osDark ? 'dark' : 'light') : this.theme);

	/**
	 * Compare year for deltas: the saved compare year when it comes before the year shown,
	 * otherwise the year just before it. Never equal to `year` unless there is no earlier
	 * year (`hasCompare` is then false and deltas are hidden).
	 */
	get compare(): YearKey {
		const y = ORDER.indexOf(this.year);
		if (ORDER.indexOf(this.#compare) < y) return this.#compare;
		return ORDER[Math.max(0, y - 1)];
	}
	set compare(v: YearKey) {
		this.#compare = v;
	}
	/** False when the year shown has no earlier year to compare against. */
	get hasCompare(): boolean {
		return this.compare !== this.year;
	}

	init() {
		if (typeof window === 'undefined') return;
		try {
			const s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
			if (s.year) this.year = s.year;
			// pre-v2 saves recorded the old 'all' default, not a choice: keep the new default
			if (s.fund && s.v >= VERSION) this.fund = s.fund;
			if (s.theme) this.theme = s.theme;
			if (s.compare) this.#compare = s.compare;
		} catch {
			/* ignore */
		}
		const dark = matchMedia('(prefers-color-scheme: dark)');
		const rm = matchMedia('(prefers-reduced-motion: reduce)');
		this.#osDark = dark.matches;
		this.reducedMotion = rm.matches;
		dark.addEventListener('change', (e) => (this.#osDark = e.matches));
		rm.addEventListener('change', (e) => (this.reducedMotion = e.matches));
	}

	persist() {
		try {
			localStorage.setItem(
				KEY,
				JSON.stringify({
					v: VERSION,
					year: this.year,
					fund: this.fund,
					theme: this.theme,
					compare: this.#compare
				})
			);
		} catch {
			/* ignore */
		}
	}
}

export const settings = new Settings();

let webgl: boolean | undefined;
/** Whether WebGL is available (memoised). */
export function hasWebGL(): boolean {
	if (webgl !== undefined) return webgl;
	try {
		const c = document.createElement('canvas');
		webgl = !!(c.getContext('webgl2') || c.getContext('webgl'));
	} catch {
		webgl = false;
	}
	return webgl;
}
