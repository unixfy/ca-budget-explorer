/**
 * Plain-language presentation of official source citations (SourceRef).
 * Data files keep the ETL's technical labels and API URLs; this is the one place
 * that decides how a citation reads and where it links for a lay visitor.
 *
 * URL patterns used here are the ones the ETL itself reads and writes
 * (scripts/etl/lib/ebudget.ts, scripts/etl/sources-catalog.ts):
 *   API      https://ebudget.ca.gov/api/{prefix}/{pit}/{fy}/{path}
 *   Web      https://ebudget.ca.gov/{prefix}/{pit}/{fy}/BudgetDetail | BudgetSummary
 *   PDFs     https://ebudget.ca.gov/{fy}/pdf/{Enacted/|Revised/|}GovernorsBudget/{agency}/{org}[FCS].pdf
 *            https://ebudget.ca.gov/{fy}/pdf/{...}BudgetSummary/BS_SCH{n}.pdf
 */
import type { SourceRef } from './data/schema';

export interface PlainSource {
	/** What a visitor reads, e.g. "Enacted Budget detail: department spending by fund". */
	label: string;
	/** Where the link goes: a human-readable page or PDF wherever one is derivable. */
	url: string;
	page?: number;
	/** True when `url` is still machine-readable data (JSON) rather than a document. */
	isData: boolean;
	/** The exact machine-readable endpoint, when `url` was swapped for a readable page. */
	dataUrl?: string;
}

const EB = 'https://ebudget.ca.gov';
const PUB: Record<string, string> = {
	p: 'Governor’s Budget',
	m: 'May Revision',
	e: 'Enacted Budget'
};
/** PDF folder name -> point in time (Governor's Budget PDFs sit at the root). */
const FOLDER_PIT: Record<string, string> = { '': 'p', Enacted: 'e', Revised: 'm' };

/** What each ebudget API endpoint family holds, in plain words. */
function apiWhat(path: string): { what: string; org?: string; summary?: boolean } {
	const segs = path.replace(/\.json$/, '').split('/');
	const code = /^\d{4}$/.test(segs[segs.length - 1] ?? '') ? segs[segs.length - 1] : undefined;
	switch (segs[0]) {
		case 'rwaCntl':
			return segs[1] === 'capOutlay'
				? { what: 'building projects by fund', org: code }
				: { what: 'department spending by fund', org: code };
		case 'statistics':
			return { what: code ? 'agency totals' : 'statewide and agency totals' };
		case 'fcsCntl':
			return segs[1] === 'fundIndex'
				? { what: 'list of state funds' }
				: { what: 'fund condition statements', org: code };
		case 'orgProgram':
			return { what: 'department programs', org: code };
		case 'orgProject':
			return { what: 'department projects', org: code };
		case 'orgStoryCntl':
			return { what: 'department description', org: code };
		case 'org':
			return segs[1] === 'deptIndex'
				? { what: 'list of departments' }
				: { what: 'department profile', org: code };
		case 'sankey':
			return { what: 'General Fund overview', summary: true };
		case 'budgetSummaryChapter':
			return { what: 'list of chapters', summary: true };
		case 'appInfo':
			return { what: 'publication details' };
		default:
			return { what: 'budget detail data' };
	}
}

/** The section named after "—" in an ETL label, without a trailing "(Enacted)"-style note. */
function section(label: string): string | undefined {
	const m = label.match(/—\s*(.+?)\s*(?:\([^)]*\))?\s*$/);
	if (m) return m[1];
	const k = label.match(
		/^(Detailed Expenditures by Program|Detail of Appropriations and Adjustments|Expenditures by Category|Fund Condition Statements?|Summary of Projects)/i
	);
	return k?.[1];
}

export function plainSource(ref: SourceRef): PlainSource {
	const url = ref.url.replace(/#.*$/, '');
	const base = { url: ref.url, page: ref.page, isData: false };
	if (!url.startsWith(EB)) return { ...base, label: ref.label };
	const rest = url.slice(EB.length);

	// JSON API -> the publication's own readable page on ebudget.ca.gov
	let m = rest.match(/^\/api\/([a-z]+)\/([pme])\/([\d-]+)\/(.+)$/);
	if (m) {
		const [, prefix, pit, fy, path] = m;
		const w = apiWhat(path);
		const pub = PUB[pit] ?? 'Budget';
		return {
			label: `${pub} ${w.summary ? 'summary' : 'detail'}: ${w.what}${w.org ? ` (dept. ${w.org})` : ''}`,
			url: `${EB}/${prefix}/${pit}/${fy}/${w.summary ? 'BudgetSummary' : 'BudgetDetail'}`,
			isData: false,
			dataUrl: ref.url
		};
	}

	// ebudget web pages
	m = rest.match(/^\/[a-z]+\/([pme])\/[\d-]+\/(BudgetDetail|BudgetSummary)/);
	if (m)
		return {
			...base,
			label: `${PUB[m[1]] ?? 'Budget'} ${m[2] === 'BudgetDetail' ? 'detail' : 'summary'} (ebudget.ca.gov)`
		};

	// PDFs
	m = rest.match(/^\/([\d-]+)\/pdf\/(?:([A-Za-z]+)\/)?(GovernorsBudget|BudgetSummary)\/?(.*)$/);
	if (m) {
		const [, fy, folder = '', series, file] = m;
		const pit = FOLDER_PIT[folder];
		const pub = pit ? PUB[pit] : 'Budget';
		if (series === 'BudgetSummary') {
			const s = file.match(/^BS_SCH(\w+)\.pdf$/);
			if (s) {
				const t = section(ref.label);
				return { ...base, label: `${pub} Summary Schedule ${s[1]}${t ? `: ${t}` : ''}` };
			}
			return { ...base, label: ref.label };
		}
		const d = file.match(/^\d{4}\/(\d{4})(FCS)?\.pdf$/);
		if (d) {
			// "9658 Budget Stabilization Account — Fund Condition Statement": keep the fund's name
			const named = ref.label.match(/^\d{4} (.+?) — /)?.[1];
			if (d[2] && named && !/fund condition statements|department budget detail/i.test(named))
				return { ...base, label: `${pub} fund condition statement: ${named} (PDF)` };
			const t = section(ref.label);
			const sub = t && !/^fund condition statements?$/i.test(t) ? `: ${t}` : '';
			return {
				...base,
				label: d[2]
					? `${pub} fund condition statements for dept. ${d[1]} (PDF)${sub}`
					: `${pub} detail for dept. ${d[1]} (PDF)${sub}`
			};
		}
		// a folder of department PDFs: point at the publication's detail page instead
		if (pit && !file) {
			const prefix = Number(fy.slice(0, 4)) >= 2026 ? 'budget' : 'publication';
			return {
				...base,
				label: `${pub} department budget detail (ebudget.ca.gov)`,
				url: `${EB}/${prefix}/${pit}/${fy}/BudgetDetail`
			};
		}
	}

	if (rest.startsWith('/api/'))
		return { ...base, label: 'Budget data (ebudget.ca.gov, machine-readable)', isData: true };
	return { ...base, label: ref.label };
}

export const sourceHref = (s: PlainSource) => (s.page ? `${s.url}#page=${s.page}` : s.url);
